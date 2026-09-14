"""Reading a library of documents off disk, as a stream.

The trainer must never hold a corpus in memory. A `documents()` generator yielding one document's
text at a time is the whole interface, because it is the only shape that lets `Budget` stop the
read halfway through a 40GB directory and leave the trainer with a sealed model of what it saw.

Corpora are declared in `analysis/corpora.yaml` rather than passed on a command line. A weekly
job that takes a path argument trains on whatever the argument said that week; a job that reads a
checked-in manifest trains on something a diff can show changing.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import yaml

TEXT_SUFFIXES = {".txt", ".md", ".rst", ".markdown", ".text", ".org", ".tex"}
CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".yaml", ".yml", ".toml", ".json", ".sql", ".sh"}


class CorpusError(RuntimeError):
    """A manifest that names a path which is not there. Loud, because a silently empty corpus
    trains a model on nothing and reports a perplexity that looks like a result."""


@dataclass
class Source:
    name: str
    path: Path
    include: list[str] = field(default_factory=lambda: ["**/*"])
    exclude: list[str] = field(default_factory=list)
    #: JSONL corpora (the shape most public text dumps ship in) need to know which key holds text.
    jsonl_field: str | None = None
    max_bytes_per_file: int = 32 * 1024 * 1024
    required: bool = True
    #: True when a commit to this repository can change this source's text.
    #:
    #: `cut_heldout.py` has excluded these from the frozen evaluation set since it was written, on the
    #: reasoning that a frozen set fixes which documents are scored and cannot fix what they say. It
    #: then concluded they were fine to train on, because a test set and a training set are different
    #: jobs. **E8 measured that conclusion wrong.** Writing E8's result up moved a retrain of its own
    #: four cells by up to 4,807 n-grams and 27 types, gave each cell a different corpus digest, and
    #: made `comparable_training` refuse all six pairs — so a mutable source makes a training read
    #: unrepeatable, and a training read is what every published figure rests on. D25 has the table,
    #: D26 the decision.
    #:
    #: A field on the source rather than a set of names in two scripts, because it is a fact about the
    #: corpus and `corpora.yaml` is where facts about the corpus live.
    mutable: bool = False

    def files(self) -> Iterator[Path]:
        if not self.path.exists():
            if self.required:
                raise CorpusError(f"corpus '{self.name}' points at {self.path}, which does not exist")
            return
        seen: set[Path] = set()
        for pattern in self.include:
            for p in sorted(self.path.glob(pattern)):
                if not p.is_file() or p in seen:
                    continue
                rel = p.relative_to(self.path).as_posix()
                if any(p.match(x) or rel.startswith(x.rstrip("*/")) for x in self.exclude):
                    continue
                if p.suffix not in TEXT_SUFFIXES and p.suffix not in CODE_SUFFIXES and p.suffix not in {".gz", ".jsonl"}:
                    continue
                seen.add(p)
                yield p

    def identified(self) -> Iterator[tuple[str, str]]:
        """`(document id, text)`, where the id is the file's path relative to this source.

        A frozen evaluation set has to name documents in a way that survives the corpus growing
        around them. Position cannot: a stride over the library selects different documents the
        moment anything is added, which is exactly why a held-out perplexity stops being comparable
        to last week's. A name does not move. `rfc9110.txt` is `rfc9110.txt` whatever arrives beside
        it, so the training half can keep growing while the test set stays put.

        One file usually holds one document. A JSONL source holds many, so the id carries the record
        index after a `#` — without it a frozen set could name only the whole file.
        """
        for p in self.files():
            rel = p.relative_to(self.path).as_posix()
            docs = list(self._read(p))
            if len(docs) == 1:
                yield rel, docs[0]
            else:
                for i, doc in enumerate(docs):
                    yield f"{rel}#{i}", doc

    def documents(self) -> Iterator[str]:
        for p in self.files():
            yield from self._read(p)

    def _read(self, p: Path) -> Iterator[str]:
        """Every document in one file. Both public iterators go through here so they cannot diverge."""
        try:
            if p.suffix == ".gz":
                with gzip.open(p, "rt", encoding="utf-8", errors="replace") as fh:
                    yield from _lines_or_whole(fh.read(self.max_bytes_per_file), self.jsonl_field, p)
            else:
                if p.stat().st_size > self.max_bytes_per_file:
                    # Truncating mid-file is fine for a background language model and is not
                    # fine for anything that needs whole documents. Nothing here does.
                    text = p.read_text(encoding="utf-8", errors="replace")[: self.max_bytes_per_file]
                else:
                    text = p.read_text(encoding="utf-8", errors="replace")
                yield from _lines_or_whole(text, self.jsonl_field, p)
        except (OSError, UnicodeError) as e:
            raise CorpusError(f"corpus '{self.name}' could not read {p}: {e}") from e


def _lines_or_whole(text: str, jsonl_field: str | None, where: Path) -> Iterator[str]:
    if jsonl_field is None:
        yield text
        return
    for i, line in enumerate(text.splitlines()):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue  # a truncated final line is expected when max_bytes_per_file bit
        v = obj.get(jsonl_field)
        if isinstance(v, str) and v:
            yield v
        elif i == 0:
            raise CorpusError(f"{where}: no string field '{jsonl_field}' on the first record")


@dataclass
class Library:
    sources: list[Source]

    def documents(self) -> Iterator[tuple[str, str]]:
        for s in self.sources:
            for doc in s.documents():
                yield s.name, doc

    def identified(self) -> Iterator[tuple[str, str, str]]:
        """`(source, document id, text)`. What a frozen evaluation set is written in terms of."""
        for s in self.sources:
            for ident, doc in s.identified():
                yield s.name, ident, doc

    def describe(self) -> list[dict]:
        out = []
        for s in self.sources:
            files = list(s.files())
            out.append(
                {
                    "name": s.name,
                    "path": str(s.path),
                    "files": len(files),
                    "bytes": sum(f.stat().st_size for f in files),
                }
            )
        return out

    def mutable_names(self) -> set[str]:
        """The sources a commit to this repository can rewrite."""
        return {s.name for s in self.sources if s.mutable}

    def stable(self) -> Library:
        """This library without the sources a commit can rewrite.

        What every measurement reads. A run over mutable text cannot be repeated — see `Source.mutable`
        and D26 — and a figure that cannot be re-derived is a figure nobody can check.

        Returns a library with no sources rather than raising when everything is mutable, because the
        caller that cares (a trainer) gives a better error than this can: it knows whether the corpus
        it wanted was missing or excluded.
        """
        return Library([s for s in self.sources if not s.mutable])

    @classmethod
    def load(cls, manifest: str | Path, root: str | Path | None = None) -> Library:
        manifest = Path(manifest)
        if not manifest.exists():
            raise CorpusError(f"no corpus manifest at {manifest}")
        base = Path(root) if root is not None else manifest.parent
        raw = yaml.safe_load(manifest.read_text()) or {}
        entries = raw.get("corpora") or []
        if not entries:
            raise CorpusError(f"{manifest} declares no corpora")
        sources = []
        for e in entries:
            if not e.get("enabled", True):
                continue
            p = Path(e["path"])
            sources.append(
                Source(
                    name=e["name"],
                    path=p if p.is_absolute() else (base / p).resolve(),
                    include=e.get("include", ["**/*"]),
                    exclude=e.get("exclude", []),
                    jsonl_field=e.get("jsonl_field"),
                    max_bytes_per_file=int(e.get("max_bytes_per_file", 32 * 1024 * 1024)),
                    required=bool(e.get("required", True)),
                    mutable=bool(e.get("mutable", False)),
                )
            )
        if not sources:
            raise CorpusError(f"{manifest} has corpora but all are disabled")
        return cls(sources)
