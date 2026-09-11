#!/usr/bin/env python3
"""Score one or more trained models on the frozen held-out set, and refuse to rank what cannot be ranked.

Both model classes go through here. `Transformer` duck-types `KneserNey` where `evaluate` touches it,
so the only thing this script decides is which loader to call, and it decides that from the file's own
header rather than from a flag — a `--kind` flag is a flag someone eventually passes wrongly, and the
file already knows what it is.

Ranking is `comparable_heldout`'s job, not this script's. A pair it refuses is printed as refused.
Every reason it gives is a mistake this repository has actually published or nearly published: a
truncated score next to a finished one, a tokenizer change, a different held-out set, and a vocabulary
difference that hands the smaller vocabulary a discount on all targets.

    python scripts/score_heldout.py models/e6-cellA.kn.gz models/e6-cellB.tf.gz
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adhd_analysis.text.budget import Budget  # noqa: E402
from adhd_analysis.text.corpora import Library  # noqa: E402
from adhd_analysis.text.evaluate import FrozenSplit, comparable_heldout, evaluate  # noqa: E402
from adhd_analysis.text.ngram import KneserNey  # noqa: E402
from adhd_analysis.text.transformer import Transformer  # noqa: E402


def load(path: Path):
    """Dispatch on the file's own format header."""
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        fmt = json.loads(fh.readline()).get("format", "")
    if fmt == "adhd-tf-1":
        return Transformer.load(path), "transformer"
    return KneserNey.load(path), "kneser-ney"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("models", nargs="+", type=Path)
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--held-out-file", default="heldout.json")
    ap.add_argument("--max-seconds", type=float, default=3600.0)
    ap.add_argument("--max-tokens", type=int, default=200_000_000)
    # 13,200MB, not 12,000. The shipped 148,353-type model is 10.6GB resident once loaded, so a 12GB
    # ceiling leaves 1.4GB for scoring and binds after about 20,000 of 3.4M tokens. It did: the first
    # run of this script reported 65.8 with `TRUNCATED` beside it. The cgroup on this machine kills at
    # 13,943MB, so this is close to the largest ceiling that is still a ceiling rather than a crash.
    ap.add_argument("--max-rss-mb", type=int, default=13_200)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    base = Library.load(args.manifest)
    scored: list[tuple[str, str, object]] = []
    for path in args.models:
        model, kind = load(path)
        held = FrozenSplit.load(base, args.held_out_file, side="heldout")
        # A fresh budget per model. Sharing one scores the second model on whatever the first left,
        # which is how `compare_orders` once reported a truncated 37.55 beside a complete 25.65.
        b = Budget(max_tokens=args.max_tokens, max_seconds=args.max_seconds, max_rss_mb=args.max_rss_mb)
        out = evaluate(model, held, b)
        scored.append((path.name, kind, out))
        if not args.json:
            print(f"{path.name:28} {kind:11} {out}")

    refusals = []
    for (na, _ka, a), (nb, _kb, bb) in combinations(scored, 2):
        why = comparable_heldout(a, bb)
        if why:
            refusals.append({"a": na, "b": nb, "why": why})
        elif not args.json:
            ratio = bb.perplexity / a.perplexity
            print(f"  {na} vs {nb}: {ratio:.3f}x")
    if args.json:
        print(json.dumps({
            "scored": [{"model": n, "kind": k, **vars(o)} for n, k, o in scored],
            "refusals": refusals,
        }, indent=2))
    elif refusals:
        print("\nnot comparable:")
        for r in refusals:
            print(f"  {r['a']} vs {r['b']}: {r['why']}")

    # Non-zero on a truncated score. The `TRUNCATED` label is enough for a person reading the output
    # and not enough for a script feeding a document: a truncated perplexity is over a prefix of the
    # set, and the exit code is the only part of this a pipeline reads.
    cut = [n for n, _k, o in scored if o.truncated]
    if cut:
        print(f"\nrefusing to exit clean: {', '.join(cut)} scored over a prefix, not the set", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
