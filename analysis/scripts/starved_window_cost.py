#!/usr/bin/env python3
"""What the non-overlapping scoring window cost the transformer, measured on a real model.

E6 records that `Transformer.logprob_terms` used to walk non-overlapping windows, starving one position
in every `context`, while `KneserNey` slides continuously and starves none. The fix was justified
structurally rather than by a measurement, because a toy reverses the direction depending on whether
its period divides the context. This produces the number on a trained model and the real held-out set.

    python scripts/starved_window_cost.py models/e6-cellB.tf.gz
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adhd_analysis.text.budget import Budget  # noqa: E402
from adhd_analysis.text.corpora import Library  # noqa: E402
from adhd_analysis.text.evaluate import FrozenSplit, evaluate  # noqa: E402
from adhd_analysis.text.tokenize import BOS, EOS, UNK  # noqa: E402
from adhd_analysis.text.transformer import Transformer  # noqa: E402


def starved_terms(model: Transformer, ids) -> list[tuple[float, bool]]:
    """The implementation as it was: non-overlapping windows, each scoring its own tokens."""
    c = model.config
    unk = model.vocab.stoi[UNK]
    seq = [model.vocab.stoi[BOS]] + list(ids) + [model.vocab.stoi[EOS]]
    out: list[tuple[float, bool]] = []
    for start in range(0, len(seq) - 1, c.context):
        window = seq[start : start + c.context + 1]
        if len(window) < 2:
            break
        logits, _ = model.forward(np.array([window[:-1]], dtype=np.int64))
        lp = logits[0] - logits[0].max(axis=-1, keepdims=True)
        lp = lp - np.log(np.exp(lp).sum(axis=-1, keepdims=True))
        for t, target in enumerate(window[1:]):
            out.append((float(lp[t, target]), target != unk))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("model", type=Path)
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--held-out-file", default="heldout.json")
    ap.add_argument("--max-seconds", type=float, default=5400.0)
    ap.add_argument("--max-rss-mb", type=int, default=8000)
    args = ap.parse_args(argv)

    base = Library.load(args.manifest)
    rows = []
    for label in ("overlapping", "starved"):
        model = Transformer.load(args.model)
        if label == "starved":
            model.logprob_terms = lambda ids, m=model: starved_terms(m, ids)  # type: ignore[method-assign]
        b = Budget(max_tokens=10**9, max_seconds=args.max_seconds, max_rss_mb=args.max_rss_mb)
        out = evaluate(model, FrozenSplit.load(base, args.held_out_file, side="heldout"), b)
        rows.append((label, out))
        print(f"{label:12} {out}")

    (_, a), (_, s) = rows
    if a.truncated or s.truncated:
        print("\na truncated score cannot price anything", file=sys.stderr)
        return 2
    print(f"\nthe starved window cost {s.perplexity / a.perplexity:.4f}x "
          f"({s.perplexity:.2f} starved against {a.perplexity:.2f} overlapping)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
