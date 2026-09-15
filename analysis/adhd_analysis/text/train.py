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

import hashlib
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
from .corpusread import sentence_tokens
from .selection import add_library_arguments, training_library
from .ngram import KneserNey, count_ngrams
from .tokenize import Vocab


@dataclass
class TrainingRecord:
    model_path: Path
    order: int
    vocab_size: int
    #: The count below which a type is dropped. On the record because it is what decides the
    #: vocabulary, and therefore the OOV rate printed two fields down: a record that reports 0.39%
    #: OOV without saying whether the threshold was 2 or 3 cannot explain its own number. It was in
    #: the model's meta and not here, so reading the record meant opening the model.
    min_count: int
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
    #: How many times the counting pass dropped every count-1 n-gram to stay under `max_ngrams`.
    #:
    #: Zero means the table is every n-gram the corpus produced; nonzero means the tail was cut, and
    #: the tail is most of the table. Backlog 76 exists to price that, and the record could not
    #: answer its own question: `ngrams` alone cannot distinguish a small model from a pruned one,
    #: and the two b76 cells differ by 24M n-grams with nothing on either record saying why. It was
    #: in the model's meta and not here, the same gap `min_count` had.
    prunes: int
    #: Which side of which split this trained on, or None for the whole manifest. On the record as
    #: well as in the model's meta, because the record is what a person reads.
    split: dict | None
    #: Identity of the token stream this model was actually trained on.
    #:
    #: `HeldOut.fingerprint` has done this job for the scoring side since D16. The training side had
    #: nothing, and the gap is not theoretical: this repository's own `docs/` and `README.md` are
    #: sources in `corpora.yaml`, so **writing a registration changes the corpus the registration is
    #: about.** E8 found it by arithmetic that came out 51 types short — committing the E8 registration
    #: moved the training read from 20,000,029 tokens to 20,000,139 and the type count from 71,883 to
    #: 71,934, which invalidated the plan to reuse E6's cell A' and cost a retrain.
    #:
    #: Over tokens rather than document content, which is deliberately stronger than the held-out
    #: fingerprint: a tokenizer change is invisible to a content digest and moved the shipped baseline
    #: from 25.65 to 25.82 without it noticing.
    corpus_fingerprint: str
    #: The same digest taken over the vocabulary pass. This module's docstring promises that both
    #: passes read the same text under the same ceilings — "the vocabulary therefore always covers the
    #: data the counts were taken from" — and until now nothing checked it. Unequal means the promise
    #: broke on this run, which produces a model whose `<unk>` rate climbs through training.
    vocabulary_fingerprint: str
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
            "min_count": self.min_count,
            "documents": self.documents,
            "sentences": self.sentences,
            "tokens_seen": self.tokens_seen,
            "ngrams": self.ngrams,
            "oov_rate": round(self.oov_rate, 5),
            "vocab_truncated": {
                "types": self.vocab_truncated_types,
                "tokens": self.vocab_truncated_tokens,
            },
            "prunes": self.prunes,
            "split": self.split,
            "corpus_fingerprint": self.corpus_fingerprint,
            "vocabulary_fingerprint": self.vocabulary_fingerprint,
            "vocabulary_covers_counts": self.corpus_fingerprint == self.vocabulary_fingerprint,
            "discounts": [[round(x, 4) for x in d] for d in self.discounts],
            "budget": {"vocabulary": self.budget_pass1, "counts": self.budget_pass2},
            "sources": self.sources,
            "seconds": round(self.seconds, 2),
            "python": sys.version.split()[0],
            "platform": platform.platform(),
        }




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

    # One digest per pass. Both are cheap — a sha256 update per sentence against a read that already
    # tokenizes every one of them — and the pair is what turns this module's docstring into a check.
    d1, d2 = hashlib.sha256(), hashlib.sha256()

    freq: Counter[str] = Counter()
    n_sentences = 0
    for ts in sentence_tokens(library, b1, d1):
        freq.update(ts)
        n_sentences += 1
    if not freq:
        raise ValueError("the corpus produced no tokens; check the paths in the manifest")
    vocab = Vocab.build(freq, min_count=min_count, max_size=max_vocab)

    def ids() -> Iterator[list[int]]:
        for ts in sentence_tokens(library, b2, d2):
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
            # Truncated to 16 hex characters, matching `FrozenSplit`'s fingerprint, because these are
            # read by people in tables and 64 characters of hex is not.
            "corpus_fingerprint": d2.hexdigest()[:16],
            "vocabulary_fingerprint": d1.hexdigest()[:16],
            # Which side of which split this trained on, or None for the whole manifest. Recorded
            # so `evaluate` can refuse to score a model on text it trained on. D13 wrote that
            # failure mode down — "building it over everything hands the model every word it is
            # about to be tested on, and the OOV rate collapses for a reason unrelated to the
            # model" — built `SplitLibrary` to prevent it, and then two headline figures came from a
            # path that trained on the whole manifest and scored a slice of it anyway. A rule a
            # document states and no code enforces is a rule that holds until someone is in a hurry.
            "split": (
                {"frozen": library.fingerprint, "side": library.side}
                if hasattr(library, "fingerprint") and hasattr(library, "side")
                else {"every": library.every, "side": library.side}
                if hasattr(library, "every") and hasattr(library, "side")
                else None
            ),
            "sources": library.describe(),
            "budget": {"vocabulary": b1.report(), "counts": b2.report()},
        }
    )
    path = model.save(out)

    return TrainingRecord(
        model_path=path,
        order=order,
        vocab_size=len(vocab),
        min_count=min_count,
        documents=sum(s["files"] for s in model.meta["sources"]),
        sentences=n_sentences,
        tokens_seen=b2.tokens,
        ngrams=sum(len(t) for t in model.counts),
        oov_rate=oov,
        vocab_truncated_types=vocab.truncated_types,
        vocab_truncated_tokens=vocab.truncated_tokens,
        prunes=int(model.meta.get("prunes", 0)),
        split=model.meta["split"],
        corpus_fingerprint=model.meta["corpus_fingerprint"],
        vocabulary_fingerprint=model.meta["vocabulary_fingerprint"],
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
    add_library_arguments(ap)
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

    library = training_library(args)
    rec = train(library, args.out, order=args.order, min_count=args.min_count, max_vocab=args.max_vocab, budget=b)
    payload = rec.to_dict()
    if args.record:
        Path(args.record).parent.mkdir(parents=True, exist_ok=True)
        Path(args.record).write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
