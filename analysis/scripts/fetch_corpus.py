"""The one file in this repository that reaches the network, and the only one that may.

`analysis/adhd_analysis/` imports no networking module and a test enforces that. This script sits
outside the package, is never imported by it, and does exactly one thing: put text on disk. The
trainer then reads local files like it always did.

The distinction is not cosmetic. D10 banned network in a scheduled job because that is how a
repository acquires an inference client without anyone deciding to — a job that can fetch is a job
that can fetch weights. So the ban moved rather than lifted, and the capability is small enough to
check: https only, an allowlist of **URL prefixes** rather than hosts, `text/plain` only, and a
refusal list of the extensions weights arrive in. `test/boundary.test.ts` pins all of it.

Two sources, `rust-rfcs` and `k8s-keps`, are a second, narrower exception to the `text/plain` rule
(D50): their filenames carry a slug no numeric template determines, so the only way to enumerate
them is GitHub's tree API, which answers JSON. `get_json()` is the only function that accepts it,
it is checked against the same URL allowlist as everything else, and the two tree endpoints are
scoped to one repository each — the same prefix-not-host boundary as every raw-content source
below. The document content itself is still fetched through `get()`, still `text/plain` only.

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
import json
import posixpath
import re
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

#: Largest single response this will hold. The per-source `--max-bytes` ceiling is checked between
#: documents, so without this one response of any size at all is read into memory in one call.
MAX_DOCUMENT_BYTES = 16 * 1024 * 1024


class FetchRefused(RuntimeError):
    """Raised for anything the prefix allowlist, the content type or the extension rules reject."""


class TreeTruncated(RuntimeError):
    """Raised when GitHub's tree API reports `truncated: true` on a listing this fetcher read.

    A truncated listing is a partial corpus wearing the name of a complete one. D10's manifest
    fails loudly on a missing path rather than training on the remainder; a truncated tree gets
    the same treatment rather than silently enumerating whatever fit in one response.
    """


@dataclass(frozen=True)
class Source:
    """One corpus: where it lives, what it is licensed under, and how to enumerate it.

    Enumerated by probing a numeric template and accepting the 404s. That is how the RFC fetcher
    already worked and it needs no directory listing, no API token and no request budget beyond
    the probes themselves. `TreeSource` below is the other shape, for a filename a number alone
    does not determine.
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
    #: A body containing this is a forwarding stub, not a document, and is never written to disk.
    #:
    #: Ethereum split application-layer standards out into `ethereum/ERCs` and left a 130-byte
    #: file behind at every moved number: four lines of front matter and a URL. Those are not
    #: documents. 225 of them were sitting in this repository's EIP corpus, 43% of its file count,
    #: and they are worse than absent — identical boilerplate repeated 225 times is exactly the
    #: template text that teaches a background model to find engineering prose predictable.
    #:
    #: A cached stub is deleted rather than counted as a cache hit, which costs one wasted request
    #: per stub on the run after a cleanup. That is the price of not hard-coding a list of moved
    #: numbers that drifts every time upstream moves another one.
    stub_marker: str = ""


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
        stub_marker="This file was moved to https://github.com/ethereum/ercs",
        notes=(
            "CC0 1.0 Universal: a public domain dedication, the freest terms of any source here. "
            "Application-layer standards moved to `ethereum/ERCs` and left forwarding stubs behind; "
            "those are refused here and the real text comes from the `erc` source. "
            "Numbers are sparse across the whole range, measured 2026-09-08 at 17% assigned in "
            "1-200, 0% in 200-600, 21% in 600-1200, 8% in 1200-2000, 0% in 2000-4000, 4% above. "
            "So probing yields roughly one document in ten and no `highest` fixes that: reaching N "
            "documents costs about 10N requests. The `missing` count in the output is that yield, "
            "not a fault."
        ),
    ),
    "erc": Source(
        name="erc",
        licence="CC0-1.0",
        licence_url="https://github.com/ethereum/ERCs/blob/master/LICENSE.md",
        prefixes=("https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/",),
        template="https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-{n}.md",
        highest=8000,
        filename="erc{n:05d}.md",
        notes=(
            "Where the EIP corpus's forwarding stubs point. Same process, same CC0 dedication, read "
            "from `ethereum/ERCs`'s own LICENSE.md, and no overlap with `eip`: a number lives in "
            "one repository or the other, and the one it left holds a stub this fetcher refuses. "
            "Numbers are sparse for the same reason EIP numbers are, so expect the same yield."
        ),
    ),
}

@dataclass(frozen=True)
class TreeSource:
    """A corpus enumerated by GitHub's tree API rather than a numeric template.

    `rust-rfcs` and `k8s-keps` carry a slug the number does not determine
    (`text/0002-rfc-process.md`, `keps/sig-node/1234-some-feature/README.md`), so there is no
    template to probe. `recursive=1` lists the whole repository in one request, which is why the
    60-unauthenticated-requests-an-hour ceiling that rules out per-directory listing is not a
    constraint here: one API request plus one raw-content request per matched document, the same
    shape as every numeric source above it. D50 is the decision to widen the fetcher this far.
    """

    name: str
    licence: str
    licence_url: str
    #: The tree listing endpoint, `?recursive=1` and all. Fetched once per run, via `get_json()`.
    tree_url: str
    #: Every URL this source may fetch starts with one of these: the tree endpoint's own directory
    #: and the raw-content directory the matched paths are read from. Same prefix-not-host shape
    #: as `Source.prefixes` — one repository each, not `api.github.com` or
    #: `raw.githubusercontent.com` bare.
    prefixes: tuple[str, ...]
    #: Where a matched path's content is actually read from. Always one of `prefixes`.
    raw_prefix: str
    #: Matches a document path in the tree listing. Named group `n` is the number tree_candidates
    #: sorts and spreads by; anything not matching this is not a document this source wants.
    path_pattern: re.Pattern[str]
    notes: str = ""

    def filename(self, path: str) -> str:
        """A path has slashes; a corpus directory should not have subdirectories."""
        return path.replace("/", "__")


#: Corpora enumerated by GitHub's tree API rather than a numeric template, because their filenames
#: carry a slug the number does not determine: `text/0002-rfc-process.md`,
#: `keps/sig-node/1234-some-feature/README.md`. `recursive=1` lists the whole repository in one
#: request, so the 60-unauthenticated-requests-an-hour ceiling that rules out per-directory
#: listing is not a constraint here: fetching an entire corpus costs one API request plus one raw
#: request per document, the same shape as every numeric source above.
#:
#: Verified 2026-09-29 by reading each project's own licence file, not from memory.
TREE_SOURCES: dict[str, TreeSource] = {
    "rust-rfcs": TreeSource(
        name="rust-rfcs",
        licence="MIT OR Apache-2.0",
        licence_url="https://github.com/rust-lang/rfcs/blob/main/LICENSE-MIT",
        tree_url="https://api.github.com/repos/rust-lang/rfcs/git/trees/main?recursive=1",
        prefixes=(
            "https://api.github.com/repos/rust-lang/rfcs/git/trees/",
            "https://raw.githubusercontent.com/rust-lang/rfcs/main/",
        ),
        raw_prefix="https://raw.githubusercontent.com/rust-lang/rfcs/main/",
        path_pattern=re.compile(r"^text/(?P<n>\d{4})-[^/]+\.md$"),
        notes=(
            "Dual-licensed MIT OR Apache-2.0, read from the repository's own LICENSE-MIT. Better "
            "provenance than the IETF RFCs already in the corpus, and the same genre: a numbered "
            "design proposal with a rationale section, written to be argued with."
        ),
    ),
    "k8s-keps": TreeSource(
        name="k8s-keps",
        licence="Apache-2.0",
        licence_url="https://github.com/kubernetes/enhancements/blob/master/LICENSE",
        tree_url="https://api.github.com/repos/kubernetes/enhancements/git/trees/master?recursive=1",
        prefixes=(
            "https://api.github.com/repos/kubernetes/enhancements/git/trees/",
            "https://raw.githubusercontent.com/kubernetes/enhancements/master/",
        ),
        raw_prefix="https://raw.githubusercontent.com/kubernetes/enhancements/master/",
        path_pattern=re.compile(r"^keps/sig-[a-z0-9-]+/(?P<n>\d+)-[^/]+/README\.md$"),
        notes=(
            "Apache-2.0, read from the repository's own LICENSE. Same enumeration shape as "
            "rust-rfcs: one tree listing, then one raw fetch per matched KEP's README."
        ),
    ),
}

#: Bitcoin BIPs are numerically enumerable and reachable, so the plumbing above would work. They are
#: absent for a licensing reason instead: `bitcoin/bips` has no repository licence file at all —
#: LICENSE, LICENSE.md and COPYING are all 404 — and each BIP carries its own `License:` header.
#: Those headers are not uniform and some are not free. Fetching the series would mean either
#: reading a licence per document at fetch time or asserting terms this repository has not read, and
#: the second is how a corpus acquires text nobody checked. Recorded, not fetched.
UNLICENSED_AT_SOURCE = {
    "bitcoin-bips": ("no repository licence; per-document `License:` headers, not uniform",
                     "https://github.com/bitcoin/bips"),
}


def allowed_prefixes() -> tuple[str, ...]:
    return tuple(p for s in SOURCES.values() for p in s.prefixes) + tuple(
        p for s in TREE_SOURCES.values() for p in s.prefixes
    )


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


class CheckedRedirects(urllib.request.HTTPRedirectHandler):
    """Re-run the allowlist on every hop, because the check before the request only covers the first.

    `urllib.request.urlopen` follows redirects with a handler whose only scheme guard is
    `('http', 'https', 'ftp', '')` — verified against the installed stdlib rather than remembered. So
    an allowlisted host answering 302 sends this fetcher wherever it likes, over plain http if it
    prefers, and both the https-only rule and the prefix allowlist are gone after one hop. Neither
    the docstring at the top of this file nor `test/boundary.test.ts` covered the hop, because both
    were written about the call and not about the exchange.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102 - stdlib signature
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


#: Built once. `build_opener` with a handler instance replaces the default of the same class, so
#: this is the redirect handler for every request below rather than an extra one.
_OPENER = urllib.request.build_opener(CheckedRedirects())


def get(url: str, timeout: float = 60.0) -> bytes:
    _check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with _OPENER.open(req, timeout=timeout) as r:  # noqa: S310 - scheme and prefix checked on every hop
        # Where the response actually came from, which after a redirect is not where it was asked
        # for. Checked again here: a handler is a moving part, and this is one line.
        _check_url(r.url)
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "text/plain":
            raise FetchRefused(f"{url}: content type {ctype!r}, expected text/plain")
        body = r.read(MAX_DOCUMENT_BYTES + 1)
        if len(body) > MAX_DOCUMENT_BYTES:
            raise FetchRefused(f"{url}: over {MAX_DOCUMENT_BYTES:,} bytes; this fetches documents, not archives")
        return body


def get_json(url: str, timeout: float = 60.0) -> dict:
    """The one place this fetcher accepts anything but `text/plain`, and it accepts exactly one thing.

    Same allowlist, same redirect re-check, same size ceiling as `get()` — only the expected
    content type differs, which is why this is a second small function next to `get()` rather than
    a parameter that changes what `get()` accepts. A document fetch that quietly started accepting
    JSON would accept it from every source, not just the two that need it.
    """
    _check_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
    with _OPENER.open(req, timeout=timeout) as r:  # noqa: S310 - scheme and prefix checked on every hop
        _check_url(r.url)
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "application/json":
            raise FetchRefused(f"{url}: content type {ctype!r}, expected application/json")
        body = r.read(MAX_DOCUMENT_BYTES + 1)
        if len(body) > MAX_DOCUMENT_BYTES:
            raise FetchRefused(f"{url}: over {MAX_DOCUMENT_BYTES:,} bytes; this fetches a listing, not an archive")
        return json.loads(body)


@dataclass
class Fetched:
    source: str
    files: int = 0
    bytes: int = 0
    skipped: int = 0
    missing: int = 0
    stubs: int = 0
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


def tree_candidates(source: TreeSource, tree: dict, limit: int, spread: bool) -> list[str]:
    """Which matched paths to fetch, sorted by the number embedded in each one.

    Same spread-across-the-range reasoning as `candidates()`: the earliest numbers in either
    series are short procedural documents, so limiting a large listing to the first N would train
    on nothing but those. Unmatched tree entries (directories, and every file that is not a
    document this source wants) are dropped before the spread runs, not after.
    """
    matched: list[tuple[int, str]] = []
    for entry in tree.get("tree", []):
        if entry.get("type") != "blob":
            continue
        m = source.path_pattern.match(entry.get("path", ""))
        if m:
            matched.append((int(m.group("n")), entry["path"]))
    matched.sort()

    if limit >= len(matched) or not spread:
        return [path for _, path in matched[:limit]]
    step = len(matched) / limit
    picked = sorted({min(len(matched) - 1, int(i * step)) for i in range(1, limit + 1)})
    return [matched[i][1] for i in picked]


def sweep_stubs(source: Source, out: Path) -> int:
    """Delete every cached forwarding stub in this source's directory. Costs no request.

    A sweep rather than a check inside the probe loop, because whether a stub gets removed should
    not depend on whether this run's spread happened to land on its number. The first version did it
    in the loop and left 214 of 225 in place.
    """
    if not source.stub_marker or not out.is_dir():
        return 0
    removed = 0
    for path in out.glob("*"):
        if not path.is_file() or path.name == "MANIFEST.sha256":
            continue
        # Stubs are ~130 bytes. The size check is what keeps this from reading a 141KB document off
        # disk for every file in a 5,000-file corpus on every run.
        if path.stat().st_size <= 4096 and source.stub_marker in path.read_text(errors="replace"):
            path.unlink()
            removed += 1
    return removed


def fetch_source(source: Source, out: Path, limit: int, delay: float, max_bytes: int, spread: bool = True) -> Fetched:
    out.mkdir(parents=True, exist_ok=True)
    result = Fetched(source=source.name)
    result.stubs = sweep_stubs(source, out)
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
        if source.stub_marker and source.stub_marker in body.decode("utf-8", errors="replace"):
            result.stubs += 1
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


def fetch_tree_source(source: TreeSource, out: Path, limit: int, delay: float, max_bytes: int, spread: bool = True) -> Fetched:
    """`fetch_source`'s shape, for a source enumerated by one tree listing instead of N probes.

    One `get_json()` call, then `get()` per matched document — the document fetch is the same
    `text/plain`-only function every numeric source uses, so nothing about how a document's
    content is checked changes for these two sources. Only how the list of documents is obtained
    does.
    """
    out.mkdir(parents=True, exist_ok=True)
    result = Fetched(source=source.name)
    total = sum(p.stat().st_size for p in out.glob("*") if p.is_file() and p.name != "MANIFEST.sha256")

    tree = get_json(source.tree_url)
    if tree.get("truncated"):
        raise TreeTruncated(
            f"{source.name}: GitHub's tree listing was truncated; a partial listing is not a corpus "
            "this fetcher will train on silently"
        )

    for path in tree_candidates(source, tree, limit, spread):
        if total >= max_bytes:
            print(f"{source.name}: byte ceiling reached at {total:,}", file=sys.stderr)
            break
        dest = out / source.filename(path)
        if dest.exists() and dest.stat().st_size > 0:
            result.skipped += 1
            continue
        try:
            body = get(source.raw_prefix + path)
        except FetchRefused as e:
            result.refused.append(str(e))
            raise
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            # A path the tree listing just named should exist; this is the network being the
            # network, not an expected gap the way a probed number's 404 is.
            result.missing += 1
            print(f"{source.name} {path}: {e}", file=sys.stderr)
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
        epilog="licences: " + "; ".join(f"{s.name}={s.licence}" for s in list(SOURCES.values()) + list(TREE_SOURCES.values())),
    )
    all_names = sorted(set(SOURCES) | set(TREE_SOURCES))
    ap.add_argument("--source", action="append", choices=all_names, help="repeatable; default is all")
    ap.add_argument("--out", default="corpora", help="parent directory; each source gets a subdirectory")
    ap.add_argument("--limit", type=int, default=600, help="documents per source, spread across its range")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between requests; do not lower it")
    ap.add_argument("--max-bytes", type=int, default=256 * 1024 * 1024, help="per source")
    ap.add_argument("--no-spread", action="store_true", help="take the lowest numbers instead of a spread")
    ap.add_argument("--licences", action="store_true", help="print every source's licence and exit")
    args = ap.parse_args(argv)

    if args.licences:
        for s in list(SOURCES.values()) + list(TREE_SOURCES.values()):
            print(f"{s.name:12} {s.licence:52} {s.licence_url}")
            if s.notes:
                print(f"{'':12} {s.notes}")
        for name, (why, url) in sorted(UNLICENSED_AT_SOURCE.items()):
            print(f"{name:12} {why:52} {url}  (refused: licence not verifiable per repository)")
        return 0

    chosen = args.source or all_names
    for name in chosen:
        out = Path(args.out) / name
        if name in SOURCES:
            r = fetch_source(SOURCES[name], out, args.limit, args.delay, args.max_bytes, spread=not args.no_spread)
        else:
            r = fetch_tree_source(TREE_SOURCES[name], out, args.limit, args.delay, args.max_bytes, spread=not args.no_spread)
        stubs = f", stubs {r.stubs}" if r.stubs else ""
        licence = SOURCES.get(name, TREE_SOURCES.get(name)).licence  # type: ignore[union-attr]
        print(
            f"{r.source}: fetched {r.files}, cached {r.skipped}, missing {r.missing}{stubs}, "
            f"{r.bytes:,} bytes  [{licence}]"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
