"""The one file in this repository that reaches the network, and the only one that may.

`analysis/adhd_analysis/` imports no networking module and a test enforces that. This script sits
outside the package, is never imported by it, and does exactly one thing: put text on disk. The
trainer then reads local files like it always did.

The distinction is not cosmetic. D10 banned network in a scheduled job because that is how a
repository acquires an inference client without anyone deciding to — a job that can fetch is a job
that can fetch weights. So the ban moved rather than lifted, and the capability is small enough to
check: https only, an allowlist of **URL prefixes** rather than hosts, `text/plain` only, and a
refusal list of the extensions weights arrive in. `test/boundary.test.ts` pins all of it.

Prefixes rather than hosts because `raw.githubusercontent.com` serves every public repository on
GitHub. Allowing the host would allow all of them; allowing
`https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/` allows the EIPs and nothing else.
That is a tighter boundary than the single-host version it replaces, not a looser one.

## Why these corpora

The artifacts being scored are engineering arguments with a fixed shape: a position, its cost, what
it forecloses, what would falsify it. Every source here is that genre — a numbered design proposal
with a rationale section, written to be argued with. A model trained on novels would faithfully
report that a branch artifact reads unlike a Victorian novel.

Licences were read from the projects' own licence files rather than remembered, and each is
recorded on the source below so a reader does not have to take this docstring's word for it.
"""

from __future__ import annotations

import argparse
import hashlib
import posixpath
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

#: Extensions a text corpus never has. A fetcher that will happily write a `.safetensors` into the
#: corpus directory is the exact hole the network ban existed to close.
REFUSED_SUFFIXES = {
    ".bin", ".pt", ".pth", ".ckpt", ".safetensors", ".onnx", ".gguf", ".ggml", ".h5", ".pb",
    ".tar", ".zip", ".whl", ".so", ".dylib", ".dll", ".exe",
}

USER_AGENT = "adhd-corpus-fetch/2 (+https://github.com/drewc611/Ai-adhd)"


class FetchRefused(RuntimeError):
    """Raised for anything the prefix allowlist, the content type or the extension rules reject."""


@dataclass(frozen=True)
class Source:
    """One corpus: where it lives, what it is licensed under, and how to enumerate it.

    `numbers` sources are enumerated by probing a numeric template and accepting the 404s. That is
    how the RFC fetcher already worked and it needs no directory listing, no API token and no rate
    limit budget — which matters, because the alternative is GitHub's tree API at 60 unauthenticated
    requests an hour and a response this repository cannot verify from every environment.
    """

    name: str
    #: SPDX identifier where one applies, or a precise description where none does.
    licence: str
    licence_url: str
    #: Every URL this source may fetch starts with one of these. https, and checked before connecting.
    prefixes: tuple[str, ...]
    #: `{n}` is the number; `{n:04d}` zero-pads. Formatted against each candidate.
    template: str
    #: Highest number to probe. Gaps are expected and counted, not fatal.
    highest: int
    #: What the local filename should be, so a mixed corpus stays legible on disk.
    filename: str
    notes: str = ""


#: Verified 2026-09-08 by reading each project's own licence file, not from memory.
SOURCES: dict[str, Source] = {
    "rfc": Source(
        name="rfc",
        licence="IETF Trust copyright under BCP 78 (not a free licence)",
        licence_url="https://trustee.ietf.org/documents/trust-legal-provisions/",
        prefixes=("https://www.rfc-editor.org/rfc/",),
        template="https://www.rfc-editor.org/rfc/rfc{n}.txt",
        highest=9900,
        filename="rfc{n}.txt",
        notes=(
            "Freely readable and redistributable in full; derivative works are restricted. This "
            "repository redistributes none of it — the corpus is gitignored and fetched locally, "
            "and the trained model is gitignored too. See docs/PROVENANCE.md."
        ),
    ),
    "pep": Source(
        name="pep",
        licence="public domain and CC0-1.0",
        licence_url="https://peps.python.org/pep-0001/#pep-header-preamble",
        prefixes=("https://raw.githubusercontent.com/python/peps/main/peps/",),
        template="https://raw.githubusercontent.com/python/peps/main/peps/pep-{n:04d}.rst",
        highest=800,
        filename="pep{n:04d}.rst",
        notes="PEP 1 requires every PEP to be dual-licensed public domain and CC0-1.0.",
    ),
    "eip": Source(
        name="eip",
        licence="CC0-1.0",
        licence_url="https://github.com/ethereum/EIPs/blob/master/LICENSE.md",
        prefixes=("https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/",),
        template="https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-{n}.md",
        highest=8000,
        filename="eip{n:05d}.md",
        notes=(
            "CC0 1.0 Universal: a public domain dedication, the freest terms of any source here. "
            "Numbers are sparse across the whole range, measured 2026-09-08 at 17% assigned in "
            "1-200, 0% in 200-600, 21% in 600-1200, 8% in 1200-2000, 0% in 2000-4000, 4% above. "
            "So probing yields roughly one document in ten and no `highest` fixes that: reaching N "
            "documents costs about 10N requests. The `missing` count in the output is that yield, "
            "not a fault."
        ),
    ),
}

#: Corpora whose licences were verified and whose enumeration this script does not implement.
#:
#: Both need a directory listing, because their filenames carry a slug that cannot be derived from
#: the number: `text/0002-rfc-process.md`, `keps/sig-node/1234-some-feature/README.md`. Listing
#: means GitHub's tree API, which is 60 unauthenticated requests an hour and which this repository
#: could not verify from the environment the rest of this file was tested in. Shipping an
#: enumeration path nobody has run is how a fetcher fails on someone else's machine, so these are
#: recorded rather than guessed at. The licences are read from the projects' own files and are
#: correct; only the plumbing is missing.
UNIMPLEMENTED = {
    "rust-rfcs": ("MIT OR Apache-2.0", "https://github.com/rust-lang/rfcs/blob/master/LICENSE-MIT"),
    "k8s-keps": ("Apache-2.0", "https://github.com/kubernetes/enhancements/blob/master/LICENSE"),
}


def allowed_prefixes() -> tuple[str, ...]:
    return tuple(p for s in SOURCES.values() for p in s.prefixes)


def _check_url(url: str) -> None:
    """Everything refusable from the URL alone, so a refusal costs no request.

    The prefix comparison runs on a decoded, normalised path, and a `..` segment is refused
    outright. A raw `startswith` is not enough: `.../python/peps/main/peps/../../../evil/repo/main/x.md` starts
    with an allowlisted prefix and resolves outside it, and whether the server collapses the
    segments is the server's decision rather than this allowlist's. Found by testing the allowlist
    against its own bypass rather than against the URLs it was written for.
    """
    if not url.startswith("https://"):
        raise FetchRefused(f"{url}: not https")

    scheme_host, _, rest = url[len("https://"):].partition("/")
    # Decoded before the segment check, because `%2e%2e` is `..` to every server that will receive
    # this URL and was not to the first version of this check.
    path = urllib.parse.unquote(rest.split("?")[0].split("#")[0])
    if any(seg == ".." for seg in path.split("/")):
        raise FetchRefused(f"{url}: path traversal")
    normalised = f"https://{scheme_host}/{posixpath.normpath('/' + path).lstrip('/')}"
    if not any(normalised.startswith(p) for p in allowed_prefixes()):
        raise FetchRefused(f"{url}: no allowlisted prefix matches; the allowlist is {allowed_prefixes()}")
    if Path(path).suffix.lower() in REFUSED_SUFFIXES:
        raise FetchRefused(f"{url}: refused extension; this fetches text, not binaries or archives")


def get(url: str, timeout: float = 60.0) -> bytes:
    _check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - scheme and prefix checked above
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "text/plain":
            raise FetchRefused(f"{url}: content type {ctype!r}, expected text/plain")
        return r.read()


@dataclass
class Fetched:
    source: str
    files: int = 0
    bytes: int = 0
    skipped: int = 0
    missing: int = 0
    refused: list[str] = field(default_factory=list)


def candidates(source: Source, limit: int, spread: bool) -> list[int]:
    """Which numbers to probe.

    Spread rather than the first N. The early documents in every one of these series are short
    procedural memos and the later ones are long argued designs; taking the lowest numbers would
    train a model of 1970s teletype conventions and call it technical prose.
    """
    if limit >= source.highest or not spread:
        return list(range(1, min(limit, source.highest) + 1))
    step = source.highest / limit
    return sorted({max(1, int(i * step)) for i in range(1, limit + 1)})


def fetch_source(source: Source, out: Path, limit: int, delay: float, max_bytes: int, spread: bool = True) -> Fetched:
    out.mkdir(parents=True, exist_ok=True)
    result = Fetched(source=source.name)
    total = sum(p.stat().st_size for p in out.glob("*") if p.is_file() and p.name != "MANIFEST.sha256")

    for n in candidates(source, limit, spread):
        if total >= max_bytes:
            print(f"{source.name}: byte ceiling reached at {total:,}", file=sys.stderr)
            break
        dest = out / source.filename.format(n=n)
        if dest.exists() and dest.stat().st_size > 0:
            result.skipped += 1
            continue
        try:
            body = get(source.template.format(n=n))
        except FetchRefused as e:
            # A refusal is a boundary decision, not a transient failure. Recorded and re-raised:
            # a fetcher that shrugged one off would be a fetcher whose allowlist is advisory.
            result.refused.append(str(e))
            raise
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            # A withdrawn or never-assigned number is a 404 and is expected: every one of these
            # series has gaps, and a run that aborted on the first would fetch nothing.
            result.missing += 1
            print(f"{source.name} {n}: {e}", file=sys.stderr)
            time.sleep(delay)
            continue
        dest.write_bytes(body)
        total += len(body)
        result.files += 1
        result.bytes = total
        time.sleep(delay)

    digest = hashlib.sha256()
    files = sorted(p for p in out.glob("*") if p.is_file() and p.name != "MANIFEST.sha256")
    for p in files:
        digest.update(p.name.encode())
        digest.update(hashlib.sha256(p.read_bytes()).digest())
    (out / "MANIFEST.sha256").write_text(
        f"{digest.hexdigest()}  {len(files)} files  {source.name}  {source.licence}\n"
    )
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="fetch_corpus",
        description="Download openly licensed design-proposal text into local corpus directories. "
        "Text only, allowlisted URL prefixes only, nothing redistributed by this repository.",
        epilog="licences: " + "; ".join(f"{s.name}={s.licence}" for s in SOURCES.values()),
    )
    ap.add_argument("--source", action="append", choices=sorted(SOURCES), help="repeatable; default is all")
    ap.add_argument("--out", default="corpora", help="parent directory; each source gets a subdirectory")
    ap.add_argument("--limit", type=int, default=600, help="documents per source, spread across its range")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between requests; do not lower it")
    ap.add_argument("--max-bytes", type=int, default=256 * 1024 * 1024, help="per source")
    ap.add_argument("--no-spread", action="store_true", help="take the lowest numbers instead of a spread")
    ap.add_argument("--licences", action="store_true", help="print every source's licence and exit")
    args = ap.parse_args(argv)

    if args.licences:
        for s in SOURCES.values():
            print(f"{s.name:12} {s.licence:52} {s.licence_url}")
            if s.notes:
                print(f"{'':12} {s.notes}")
        for name, (lic, url) in sorted(UNIMPLEMENTED.items()):
            print(f"{name:12} {lic:52} {url}  (licence verified, enumeration not implemented)")
        return 0

    chosen = [SOURCES[n] for n in (args.source or sorted(SOURCES))]
    for s in chosen:
        r = fetch_source(s, Path(args.out) / s.name, args.limit, args.delay, args.max_bytes, spread=not args.no_spread)
        print(f"{r.source}: fetched {r.files}, cached {r.skipped}, missing {r.missing}, {r.bytes:,} bytes  [{s.licence}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
