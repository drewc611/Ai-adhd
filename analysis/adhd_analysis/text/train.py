"""Two passes over a document library, producing one sealed model and a training record.

Pass one counts word types to fix the vocabulary. Pass two counts n-grams over ids. Two passes
and not one because a single-pass trainer has to keep every string it has seen, and on a document
library the string table is larger than the n-gram table it was trying to avoid building.

Both passes read files in sorted order under the same ceilings, so a budget that stops pass one
halfway through a directory stops pass two at the same place. The vocabulary therefore always
covers the data the counts were taken from. Getting this wrong produces a model whose `<unk>` rate
climbs through training and whose perplexity looks better the less of the corpus it read.
"""

from __future__ import annotations

import json
import platform
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .budget import Budget
from .corpora import Library
from .ngram import KneserNey, count_ngrams
from .tokenize import Vocab, sentences, tokens


@dataclass
class TrainingRecord:
    model_path: Path
    order: int
    vocab_size: int
    documents: int
    sentences: int
    tokens_seen: int
    ngrams: int
    oov_rate: float
    #: How much of that OOV rate is the `max_vocab` ceiling rather than `min_count`. Nonzero means
    #: the vocabulary was capped, which changes the OOV rate and makes perplexity incomparable with
    #: a run whose vocabulary was not — the same failure mode as a truncated n-gram table, and
    #: previously invisible because both causes landed in one number.
    vocab_truncated_types: int
    vocab_truncated_tokens: int
    discounts: list[tuple[float, float, float]]
    budget_pass1: dict
    budget_pass2: dict
    sources: list[dict]
    seconds: float

    def to_dict(self) -> dict:
        return {
            "model": str(self.model_path),
            "order": self.order,
            "vocab_size": self.vocab_size,
            "documents": self.documents,
            "sentences": self.sentences,
            "tokens_seen": self.tokens_seen,
            "ngrams": self.ngrams,
            "oov_rate": round(self.oov_rate, 5),
            "vocab_truncated": {
                "types": self.vocab_truncated_types,
                "tokens": self.vocab_truncated_tokens,
            },
            "discounts": [[round(x, 4) for x in d] for d in self.discounts],
            "budget": {"vocabulary": self.budget_pass1, "counts": self.budget_pass2},
            "sources": self.sources,
            "seconds": round(self.seconds, 2),
            "python": sys.version.split()[0],
            "platform": platform.platform(),
        }


def _sentence_tokens(library: Library, budget: Budget) -> Iterator[list[str]]:
    for _name, doc in library.documents():
        for s in sentences(doc):
            ts = tokens(s)
            if not ts:
                continue
            budget.spend(len(ts))
            yield ts
            if not budget.allows():
                return


def train(
    library: Library,
    out: str | Path,
    order: int = 4,
    min_count: int = 2,
    max_vocab: int | None = 200_000,
    budget: Budget | None = None,
) -> TrainingRecord:
    if order < 2:
        raise ValueError("Kneser-Ney needs at least a bigram: the lower orders are what it smooths with")
    started = time.monotonic()
    b1 = budget or Budget.weekly()
    b2 = b1.restart()

    freq: Counter[str] = Counter()
    n_sentences = 0
    for ts in _sentence_tokens(library, b1):
        freq.update(ts)
        n_sentences += 1
    if not freq:
        raise ValueError("the corpus produced no tokens; check the paths in the manifest")
    vocab = Vocab.build(freq, min_count=min_count, max_size=max_vocab)

    def ids() -> Iterator[list[int]]:
        for ts in _sentence_tokens(library, b2):
            yield vocab.encode(ts)

    top, meta = count_ngrams(ids(), order, b2, vocab)
    model = KneserNey(order=order, vocab=vocab, counts=[{} for _ in range(order - 1)] + [top], meta=meta)
    model.seal()

    oov = vocab.dropped_tokens / max(sum(freq.values()), 1)
    model.meta.update(
        {
            "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "order": order,
            "min_count": min_count,
            "oov_rate": round(oov, 5),
            "vocab_truncated": {"types": vocab.truncated_types, "tokens": vocab.truncated_tokens},
            "sources": library.describe(),
            "budget": {"vocabulary": b1.report(), "counts": b2.report()},
        }
    )
    path = model.save(out)

    return TrainingRecord(
        model_path=path,
        order=order,
        vocab_size=len(vocab),
        documents=sum(s["files"] for s in model.meta["sources"]),
        sentences=n_sentences,
        tokens_seen=b2.tokens,
        ngrams=sum(len(t) for t in model.counts),
        oov_rate=oov,
        vocab_truncated_types=vocab.truncated_types,
        vocab_truncated_tokens=vocab.truncated_tokens,
        discounts=model.discounts,
        budget_pass1=b1.report(),
        budget_pass2=b2.report(),
        sources=model.meta["sources"],
        seconds=time.monotonic() - started,
    )


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(
        prog="adhd_analysis.text.train",
        description="Train a Kneser-Ney background model on the document library in corpora.yaml. No weights are downloaded and no model is called.",
    )
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--out", default="models/background.kn.gz")
    ap.add_argument("--order", type=int, default=4)
    ap.add_argument("--min-count", type=int, default=2)
    ap.add_argument("--max-vocab", type=int, default=200_000)
    ap.add_argument("--max-tokens", type=int, default=None)
    ap.add_argument("--max-seconds", type=float, default=None)
    ap.add_argument("--max-ngrams", type=int, default=None)
    ap.add_argument("--max-rss-mb", type=int, default=None)
    ap.add_argument("--record", default=None, help="write the training record here as JSON")
    args = ap.parse_args(argv)

    b = Budget.weekly()
    for attr, val in [
        ("max_tokens", args.max_tokens),
        ("max_seconds", args.max_seconds),
        ("max_ngrams", args.max_ngrams),
        ("max_rss_mb", args.max_rss_mb),
    ]:
        if val is not None:
            setattr(b, attr, val)

    library = Library.load(args.manifest)
    rec = train(library, args.out, order=args.order, min_count=args.min_count, max_vocab=args.max_vocab, budget=b)
    payload = rec.to_dict()
    if args.record:
        Path(args.record).parent.mkdir(parents=True, exist_ok=True)
        Path(args.record).write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
