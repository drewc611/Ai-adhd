# Provenance

Where the training text comes from, what each source permits, and why this repository's position is
clean. Every licence below was read from the project's own licence file on **2026-09-08**, not
recalled — the commands that read them are in this file so anyone can repeat the check.

## What is this repository's, and what is not

**Ours.** `config/`, `prompts/`, `src/`, `analysis/`, `evals/`, `agents/`, `skills/`, `docs/`.
Copyright (c) 2026 drewc611, MIT. That is the product: the frame library, the isolation contract,
the trap detectors, the statistics. None of it is derived from any corpus below.

**Not ours, and not redistributed.** The corpora. `analysis/scripts/fetch_corpus.py` downloads them
to `analysis/corpora/`, which is gitignored. The model trained from them lands in
`analysis/models/`, also gitignored. Neither is committed, neither is in the npm tarball, and
neither is in a release artifact — the weekly workflow uploads the model as a 90-day Actions
artifact for the repository's own use and publishes it nowhere.

That distinction is the whole of the licensing position, and it is worth stating plainly rather
than leaving implied: **the question here is use, not distribution.** Counting word frequencies in
documents you fetched and read is a different act from publishing those documents, and this
repository does only the first. A reader who wants the corpus runs the fetcher and gets it from the
source, under the source's own terms, with the source's own attribution intact.

## The sources

| source | licence | terms | verified from |
|---|---|---|---|
| `eip` — Ethereum EIPs | **CC0-1.0** | public domain dedication | [`ethereum/EIPs/LICENSE.md`](https://github.com/ethereum/EIPs/blob/master/LICENSE.md) |
| `erc` — Ethereum ERCs | **CC0-1.0** | public domain dedication | [`ethereum/ERCs/LICENSE.md`](https://github.com/ethereum/ERCs/blob/master/LICENSE.md) |
| `pep` — Python PEPs | **public domain and CC0-1.0** | dual, mandatory for every PEP | [PEP 1 §15](https://peps.python.org/pep-0001/#pep-header-preamble) |
| `rfc` — IETF RFCs | IETF Trust copyright, BCP 78 | freely readable and redistributable in full; **derivatives restricted** | [RFC 5378](https://www.rfc-editor.org/rfc/rfc5378.txt), [TLP](https://trustee.ietf.org/documents/trust-legal-provisions/) |

```
cd analysis && python scripts/fetch_corpus.py --licences
```

That prints the same table from the code, so the code and this document cannot drift apart without
one of them being obviously wrong.

### 43% of the EIP corpus was a forwarding stub

Found while looking for more text, and it is a correction to a number this repository has published.
The `eip` corpus held 529 files. 225 of them were 128 to 132 bytes:

```
---
eip: 20
category: ERC
status: Moved
---

This file was moved to https://github.com/ethereum/ercs/blob/master/ERCS/erc-20.md
```

Ethereum moved application-layer standards into `ethereum/ERCs` and left one of those at each
vacated number. So the real EIP count was 304 documents, and 225 documents' worth of text — ERC-20,
ERC-721, ERC-1155, the most-argued documents in the series — was in a repository the fetcher had
never been pointed at.

Two consequences, and the second is the one that matters. The count was wrong, which is a
correction. And 225 copies of identical four-line boilerplate were in the training text of a model
whose entire job is to say how predictable a document is. That is not a neutral absence of text; it
is a small pile of the most template-like prose available, teaching the background model that
engineering documents are repetitive. `fetch_corpus.py` refuses a stub now, deletes a cached one
rather than counting it as a valid cache hit, and the `erc` source takes the real text from where it
went. The two series share a number space and cannot overlap: a number lives in one repository or
the other, and the one it left holds a stub.

### Yield, because the numbers are sparse

Enumeration probes a numeric template and accepts the 404s, which needs no directory listing, no API
token and no rate-limit budget. What it costs is requests against unassigned numbers, and that cost
is not the same per source. Measured 2026-09-08:

- **PEPs**: 384 documents from 500 probes, about 77%.
- **EIPs**: about one in ten. Assigned numbers are sparse across the entire range — 17% in 1–200,
  0% in 200–600, 21% in 600–1200, 8% in 1200–2000, 0% in 2000–4000, 4% above — so no upper bound
  makes uniform probing efficient, and reaching N documents costs roughly 10N requests. The
  `missing` count in the fetcher's output is that yield rather than a fault.

### Why these and not others

Every source is a numbered design proposal with a rationale section, written to be argued with.
That is the genre the artifacts being scored belong to: a position, its cost, what it forecloses,
what would falsify it. A model trained on public-domain novels would faithfully report that a branch
artifact reads unlike a Victorian novel — true, and useless.

### The IETF RFCs are the least free source here, and were the first one added

Worth saying because it is the opposite of how it should have gone. RFCs are IETF Trust copyright
under BCP 78: free to read and to redistribute whole, restricted for derivative works. The EIPs and
PEPs added afterwards are CC0 and public domain, which is strictly better provenance for the same
genre.

The RFC corpus stays, because the position above holds for it — nothing is redistributed and nothing
derived from it is published. If that ever stops being true, the RFCs are the source to drop first,
and the model can be retrained on the CC0 sources alone with no licensing question at all.

## Verified but not implemented

Two more corpora in the same genre, licences read and correct, enumeration not written:

| source | licence | verified from |
|---|---|---|
| Rust RFCs | **MIT OR Apache-2.0** | [`rust-lang/rfcs/LICENSE-MIT`](https://github.com/rust-lang/rfcs/blob/master/LICENSE-MIT) |
| Kubernetes KEPs | **Apache-2.0** | [`kubernetes/enhancements/LICENSE`](https://github.com/kubernetes/enhancements/blob/master/LICENSE) |

Both need a directory listing, because the filename carries a slug the number does not determine:
`text/0002-rfc-process.md`, `keps/sig-node/1234-some-feature/README.md`. Listing means GitHub's tree
API at 60 unauthenticated requests an hour, and that call could not be exercised from the
environment the rest of the fetcher was tested in. An enumeration path nobody has run is one that
fails on somebody else's machine, so these are recorded rather than guessed at.

Adding them means allowing `api.github.com` and accepting a JSON response, which is a change to the
network boundary D10 built rather than another entry in a table. It is the owner's call and it is
recorded in `docs/BACKLOG.md` rather than taken.

## Refused for a licensing reason, not a plumbing one

Worth separating from the section above, because the two look alike in a table and are not alike.

**Bitcoin BIPs.** Numerically enumerable at
`raw.githubusercontent.com/bitcoin/bips/master/bip-{n:04d}.mediawiki`, reachable, `text/plain`, same
genre. The plumbing already in this file would fetch them. They are absent because `bitcoin/bips`
has no repository licence file — `LICENSE`, `LICENSE.md` and `COPYING` are all 404, checked
2026-09-08 — and each BIP carries its own `License:` header instead. Those headers are not uniform
and not all of them are free. Fetching the series would mean reading a licence per document at fetch
time, or asserting terms this repository has not read. The second is how a corpus acquires text
nobody checked, so the series is recorded in `UNLICENSED_AT_SOURCE` and not fetched.

The XMPP XEPs were looked at and dropped for a duller reason: the source form is XML, and a
word-frequency model trained on it learns tag names.

## How the fetcher is constrained

The one file in this repository that reaches the network, and the only one that may:

- **https only.**
- **An allowlist of URL prefixes, not hosts.** `raw.githubusercontent.com` serves every public
  repository on GitHub; allowing the host would allow all of them. Allowing
  `https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/` allows the EIPs and nothing else.
  That is tighter than the single-host version it replaced, not looser.
- **The prefix check runs on a decoded, normalised path**, and any `..` segment is refused. A raw
  `startswith` passes `.../peps/main/peps/../../../evil/repo/main/x.md`, and `%2e%2e` passes a check
  that forgot to decode. Both were found by testing the allowlist against its own bypasses rather
  than against the URLs it was written for, and both are now test cases.
- **`text/plain` only**, checked on the response header.
- **A refusal list of the extensions weights arrive in** — `.safetensors`, `.gguf`, `.ckpt`, `.pt`,
  `.onnx`, `.bin`, plus archives and shared objects.
- **A byte ceiling per source**, and a request delay that should not be lowered.

`analysis/adhd_analysis/` imports no networking module at all, and `test/boundary.test.ts` asserts
the list of network-reaching files in `analysis/` is exactly one entry long. Adding a second is a
test failure rather than a review comment.

## Attribution

Third-party dependencies are listed with their licences in `NOTICE`, read from installed package
metadata rather than transcribed.
