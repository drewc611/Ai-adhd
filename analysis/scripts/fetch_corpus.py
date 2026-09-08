"""The one file in this repository that reaches the network, and the only one that may.

`analysis/adhd_analysis/` imports no networking module and a test enforces that. This script sits
outside the package, is never imported by it, and does exactly one thing: put text on disk. The
trainer then reads local files like it always did.

The distinction is not cosmetic. D10 banned network in a scheduled job because that is how a
repository acquires an inference client without anyone deciding to — a job that can fetch is a job
that can fetch weights. So the ban moved rather than lifted: this fetcher refuses any response
that is not `text/plain`, refuses any URL outside a pinned allowlist of hosts, and refuses a
filename with a model or archive extension. `test/boundary.test.ts` pins all three.

Why RFCs. The artifacts being scored are engineering arguments: a position, its cost, what it
forecloses, what would falsify it. That is the RFC genre almost exactly — design rationale,
trade-offs, security considerations, the paragraph explaining why the obvious approach was not
taken. A background model trained on novels would report that a branch artifact reads unlike a
Victorian novel, which is true and useless. T1 is about consensus in technical argument, so the
background has to be technical argument.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

#: Hosts this script may talk to. Not a convenience — the allowlist is the mechanism. Adding one
#: is a decision that belongs in docs/DECISIONS.md, not in a flag.
ALLOWED_HOSTS = {"www.rfc-editor.org"}

#: Extensions a text corpus never has. A fetcher that will happily write a `.safetensors` into the
#: corpus directory is the exact hole the network ban existed to close.
REFUSED_SUFFIXES = {
    ".bin", ".pt", ".pth", ".ckpt", ".safetensors", ".onnx", ".gguf", ".ggml", ".h5", ".pb",
    ".tar", ".zip", ".whl", ".so", ".dylib", ".dll", ".exe",
}

INDEX_URL = "https://www.rfc-editor.org/rfc-index.txt"
RFC_URL = "https://www.rfc-editor.org/rfc/rfc{n}.txt"
USER_AGENT = "adhd-corpus-fetch/1 (+https://github.com/drewc611/Ai-adhd)"


class FetchRefused(RuntimeError):
    """Raised for anything the allowlist, the content type or the extension rules reject."""


@dataclass
class Fetched:
    files: int
    bytes: int
    skipped: int
    failed: int


def _check_url(url: str) -> None:
    from urllib.parse import urlparse

    u = urlparse(url)
    if u.scheme != "https":
        raise FetchRefused(f"{url}: not https")
    if u.hostname not in ALLOWED_HOSTS:
        raise FetchRefused(f"{url}: host is not on the allowlist ({', '.join(sorted(ALLOWED_HOSTS))})")
    if Path(u.path).suffix.lower() in REFUSED_SUFFIXES:
        raise FetchRefused(f"{url}: refused extension; this fetches text, not binaries or archives")


def get(url: str, timeout: float = 60.0) -> bytes:
    _check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - scheme and host checked above
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "text/plain":
            raise FetchRefused(f"{url}: content type {ctype!r}, expected text/plain")
        return r.read()


def rfc_numbers(limit: int, spread: bool) -> list[int]:
    """Published RFC numbers, from the index.

    Spread rather than the first N. Early RFCs are two pages of teletype conventions and modern
    ones are eighty pages of argued protocol design; taking the first N would train a model of
    1970s memo style and call it technical prose.
    """
    text = get(INDEX_URL).decode("utf-8", errors="replace")
    nums = sorted({int(m) for m in re.findall(r"^(\d{4}) ", text, re.MULTILINE)})
    if not nums:
        raise FetchRefused("the RFC index parsed to zero entries; its format has changed")
    if limit >= len(nums) or not spread:
        return nums[:limit]
    step = len(nums) / limit
    return [nums[int(i * step)] for i in range(limit)]


def fetch(out: Path, limit: int, delay: float, max_bytes: int, spread: bool = True) -> Fetched:
    out.mkdir(parents=True, exist_ok=True)
    total = sum(p.stat().st_size for p in out.glob("*.txt"))
    files = skipped = failed = 0

    for n in rfc_numbers(limit, spread):
        if total >= max_bytes:
            print(f"byte ceiling reached at {total:,}", file=sys.stderr)
            break
        dest = out / f"rfc{n}.txt"
        if dest.exists() and dest.stat().st_size > 0:
            skipped += 1
            continue
        try:
            body = get(RFC_URL.format(n=n))
        except FetchRefused:
            raise
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            # A withdrawn or never-published number is a 404 and is expected. A run that aborted on
            # the first gap would fetch nothing, since the index contains numbers with no document.
            failed += 1
            print(f"rfc{n}: {e}", file=sys.stderr)
            time.sleep(delay)
            continue
        dest.write_bytes(body)
        total += len(body)
        files += 1
        time.sleep(delay)

    digest = hashlib.sha256()
    for p in sorted(out.glob("*.txt")):
        digest.update(p.name.encode())
        digest.update(hashlib.sha256(p.read_bytes()).digest())
    (out / "MANIFEST.sha256").write_text(f"{digest.hexdigest()}  {len(list(out.glob('*.txt')))} files\n")
    return Fetched(files=files, bytes=total, skipped=skipped, failed=failed)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="fetch_corpus",
        description="Download RFC plain text into a local corpus directory. Text only, allowlisted host only.",
    )
    ap.add_argument("--out", default="corpora/rfc")
    ap.add_argument("--limit", type=int, default=600, help="how many RFCs, spread across the published range")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between requests; do not lower it")
    ap.add_argument("--max-bytes", type=int, default=256 * 1024 * 1024)
    ap.add_argument("--no-spread", action="store_true", help="take the lowest numbers instead of a spread")
    args = ap.parse_args(argv)

    r = fetch(Path(args.out), args.limit, args.delay, args.max_bytes, spread=not args.no_spread)
    print(f"fetched {r.files}, cached {r.skipped}, missing {r.failed}, {r.bytes:,} bytes in {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
