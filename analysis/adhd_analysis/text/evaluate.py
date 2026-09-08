"""Held-out perplexity, and the split that makes it mean anything.

The trainer reports vocabulary size, n-gram count and how long it took. None of those say whether
the model got better, and all of them go up when it gets worse: a model that memorises its corpus
has the largest table and the best training-set perplexity available. So "we trained on more text"
was, until this module, a claim with no way to be wrong.

Two things have to be true for a held-out number to be worth quoting, and both are easy to lose:

  - **The vocabulary comes from the training half only.** Building it over everything and then
    evaluating on part of it hands the model every word it is about to be tested on, and the OOV
    rate drops to zero for a reason that has nothing to do with the model. `SplitLibrary` is a
    `Library` that yields one half, so `train()` never sees the other one.
  - **The split is deterministic and stated.** Every Nth document, over files globbed in sorted
    order. A random split needs its seed recorded to be reproducible, and a stride does not — and
    the stride is over *documents*, never sentences, because two sentences from one RFC share a
    topic, an author and a vocabulary, and splitting inside a document leaks all three.

Perplexity is reported over in-vocabulary tokens with the OOV rate beside it, for the reason
`genericity.py` gives at length: `<unk>` is common in the training data by construction, so a
model can lower its perplexity by knowing fewer words.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .budget import Budget
from .corpora import Library
from .ngram import KneserNey
from .tokenize import sentences, tokens
from .train import TrainingRecord, train


class SplitLibrary:
    """A `Library` restricted to one side of a deterministic document split.

    Duck-typed rather than a subclass: `train()` needs `documents()` and `describe()` and nothing
    else, and inheriting would drag in `Library.sources` semantics that no longer hold once half
    the documents are gone.
    """

    def __init__(self, base: Library, *, every: int, side: str) -> None:
        if every < 2:
            raise ValueError("a stride below 2 leaves one side empty")
        if side not in ("train", "heldout"):
            raise ValueError(f"side must be train or heldout, not {side}")
        self.base = base
        self.every = every
        self.side = side

    def documents(self) -> Iterator[tuple[str, str]]:
        for i, (name, doc) in enumerate(self.base.documents()):
            held = i % self.every == 0
            if held == (self.side == "heldout"):
                yield name, doc

    def describe(self) -> list[dict]:
        return [{**d, "split": self.side, "every": self.every} for d in self.base.describe()]


@dataclass
class HeldOut:
    documents: int
    sentences: int
    tokens: int
    in_vocabulary: int
    oov_rate: float
    perplexity: float

    def __str__(self) -> str:
        return f"perplexity {self.perplexity:8.1f}  OOV {self.oov_rate:5.1%}  over {self.tokens:,} tokens"


def evaluate(model: KneserNey, held: SplitLibrary, budget: Budget | None = None) -> HeldOut:
    """Perplexity of a trained model on documents it never saw.

    The model is asked to predict every token including the ones that map to `<unk>`; excluding
    them would score a model on the easy half of its own test set. What is excluded from the OOV
    rate's denominator is nothing — it is the honest fraction, reported so a perplexity that
    improved because the vocabulary shrank is visible as such.
    """
    b = budget or Budget.weekly()
    docs = n_sentences = n_tokens = in_vocab = 0
    total_logprob = 0.0
    predictions = 0

    for _name, doc in held.documents():
        docs += 1
        for s in sentences(doc):
            ts = tokens(s)
            if not ts:
                continue
            n_sentences += 1
            n_tokens += len(ts)
            in_vocab += sum(1 for t in ts if t in model.vocab.stoi)
            b.spend(len(ts))
            lp, n = model.logprob(model.vocab.encode(ts))
            total_logprob += lp
            predictions += n
            if not b.allows():
                break
        if not b.allows():
            break

    return HeldOut(
        documents=docs,
        sentences=n_sentences,
        tokens=n_tokens,
        in_vocabulary=in_vocab,
        oov_rate=1.0 - (in_vocab / n_tokens if n_tokens else 0.0),
        perplexity=math.exp(-total_logprob / predictions) if predictions else float("inf"),
    )


@dataclass
class OrderResult:
    order: int
    record: TrainingRecord
    held: HeldOut
    #: Why the evaluation stopped early, or None. A truncated evaluation is not a worse score, it
    #: is a score of different text, and the two are indistinguishable in the number alone.
    truncated: str | None = None


def compare_orders(
    library: Library,
    orders: list[int],
    out_dir: str,
    *,
    every: int = 20,
    min_count: int = 2,
    budget: Budget | None = None,
) -> list[OrderResult]:
    """Train each order on the same half and score it on the same other half.

    The order is a modelling decision the repository had been making by assertion — `4` appears in
    the trainer's default and in the governor's arithmetic because a 4-gram is the usual choice,
    not because anything here measured it. This measures it.

    Every order gets its own budget from the same ceilings, because sharing one would give the
    first order the whole corpus and the last one whatever was left, and the comparison would be
    between corpus sizes wearing order labels.
    """
    base = budget or Budget.weekly()
    train_half = SplitLibrary(library, every=every, side="train")
    held_half = SplitLibrary(library, every=every, side="heldout")

    out: list[OrderResult] = []
    for order in sorted(orders):
        rec = train(train_half, Path(out_dir) / f"order{order}.kn.gz", order=order, min_count=min_count, budget=base.restart())
        model = KneserNey.load(rec.model_path, budget=base.restart())
        # Scoring is deeper per token at a higher order, so a wall-clock ceiling shared with
        # training truncates order 5's evaluation and not order 3's. The first real run of this
        # function did exactly that and produced a table where the orders had identical
        # vocabularies and different OOV rates, which is impossible on one held-out set and was the
        # only visible sign that they had been scored on different text.
        scoring = base.restart()
        scoring.max_seconds = base.max_seconds * 4
        held = evaluate(model, held_half, scoring)
        out.append(OrderResult(order=order, record=rec, held=held, truncated=scoring.stopped_because))
        del model
    return out


def comparable(results: list[OrderResult]) -> str | None:
    """Why these results cannot be ranked, or None if they can.

    Two orders scored on different amounts of held-out text are two numbers about two corpora. The
    smaller one is not better and the larger one is not worse; there is no relationship to read.
    """
    if len({r.held.tokens for r in results}) > 1:
        sizes = ", ".join(f"order {r.order}: {r.held.tokens:,}" for r in results)
        return f"the orders were scored on different held-out text ({sizes})"
    cut = [r for r in results if r.truncated]
    if cut:
        return f"evaluation was truncated: {'; '.join(f'order {r.order} ({r.truncated})' for r in cut)}"
    return None


def report(results: list[OrderResult]) -> str:
    lines = [
        "## Held-out perplexity by order",
        "",
        "Trained on 19 documents in 20, scored on the twentieth. The vocabulary comes from the",
        "training half only, so the OOV column is the real one rather than an artefact of the split.",
        "",
        f"{'order':>5} {'vocab':>9} {'n-grams':>12} {'train tok':>11} {'perplexity':>11} {'OOV':>7} {'secs':>6}",
    ]
    for r in results:
        lines.append(
            f"{r.order:>5} {r.record.vocab_size:>9,} {r.record.ngrams:>12,} {r.record.tokens_seen:>11,} "
            f"{r.held.perplexity:>11.1f} {r.held.oov_rate:>6.1%} {r.record.seconds:>6.0f}"
        )

    why = comparable(results)
    if why:
        lines += [
            "",
            f"**These rows cannot be ranked: {why}.**",
            "The perplexity column is a number about each order's own slice of the held-out set, and",
            "no ordering of it means anything. Re-run with a ceiling that lets every order finish.",
        ]
        return "\n".join(lines) + "\n"

    best = min(results, key=lambda r: r.held.perplexity)
    lines += ["", f"Best held-out perplexity at order {best.order}: {best.held.perplexity:.1f}."]

    # The cost of the last increment, which is the number that decides whether to keep going. An
    # order that halves perplexity earns its table; one that shaves 2% for 3x the memory does not,
    # and the governor's ceiling is spent on it either way.
    ordered = sorted(results, key=lambda r: r.order)
    for prev, cur in zip(ordered, ordered[1:]):
        gain = (prev.held.perplexity - cur.held.perplexity) / prev.held.perplexity
        growth = cur.record.ngrams / max(prev.record.ngrams, 1)
        lines.append(f"  order {prev.order} -> {cur.order}: perplexity {gain:+.1%}, table x{growth:.2f}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json

    ap = argparse.ArgumentParser(
        prog="adhd_analysis.text.evaluate",
        description="Train several orders on the same split and score them on held-out documents. Never calls a model.",
    )
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--orders", default="3,4,5")
    ap.add_argument("--out", default="models/orders")
    ap.add_argument("--every", type=int, default=20, help="hold out every Nth document")
    ap.add_argument("--min-count", type=int, default=2)
    ap.add_argument("--max-seconds", type=float, default=None)
    ap.add_argument("--max-rss-mb", type=int, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    b = Budget.weekly()
    if args.max_seconds is not None:
        b.max_seconds = args.max_seconds
    if args.max_rss_mb is not None:
        b.max_rss_mb = args.max_rss_mb

    results = compare_orders(
        Library.load(args.manifest),
        [int(x) for x in args.orders.split(",")],
        args.out,
        every=args.every,
        min_count=args.min_count,
        budget=b,
    )
    if args.json:
        print(json.dumps([{"order": r.order, **r.record.to_dict(), "heldout": vars(r.held)} for r in results], indent=2, default=float))
    else:
        print(report(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
