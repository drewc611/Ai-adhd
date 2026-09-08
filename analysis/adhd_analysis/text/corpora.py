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

    def documents(self) -> Iterator[str]:
        for p in self.files():
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
                )
            )
        if not sources:
            raise CorpusError(f"{manifest} has corpora but all are disabled")
        return cls(sources)
