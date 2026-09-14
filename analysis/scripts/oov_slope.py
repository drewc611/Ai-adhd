#!/usr/bin/env python3
"""Measure what a percentage point of out-of-vocabulary is worth, and derive a threshold from it.

`comparable_heldout` refuses two all-targets perplexities whose held-out OOV rates differ by more
than a fixed gap, because every OOV target is charged as a prediction of `<unk>` and `<unk>` is among
the most frequent symbols a closed-vocabulary model holds. The model that knows fewer words is asked
an easier question on a larger share of the same text.

That gap was a round number. This script is what replaces it: score several models that differ in
nothing but their vocabulary cap, read perplexity against OOV rate, and fit the slope.

Two readings per model, because the interesting quantity is confounded and the decomposition is not:

  all targets          the measurement the threshold governs. Mixes the `<unk>` discount with the
                       contexts a larger vocabulary returns to the model. Net slope, and the right
                       one for the threshold, because that is exactly the difference being guarded.
  in-vocabulary only   drops OOV targets from the sum. Isolates modelling ability, at the cost of
                       each model summing over its own target set — which is why `comparable_heldout`
                       refuses those comparisons outright. Reported as a decomposition, never a rank.

    python scripts/oov_slope.py models/e8-v0.kn.gz models/e8-v1.kn.gz \
        models/e8-v2.kn.gz models/e8-v3.kn.gz --record records/e8-slope.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adhd_analysis.text.budget import Budget  # noqa: E402
from adhd_analysis.text.corpora import Library  # noqa: E402
from adhd_analysis.text.evaluate import (  # noqa: E402
    OOV_FLOOR_GAP,
    OOV_RELATIVE_BUDGET,
    FrozenSplit,
    evaluate,
)
from adhd_analysis.text.ngram import KneserNey  # noqa: E402


def fit(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Ordinary least squares slope, intercept and r-squared. Four points do not justify a library."""
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        raise ValueError("every point has the same OOV rate, so there is no slope to fit")
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    r2 = 1.0 - ss_res / ss_tot if ss_tot else 1.0
    return slope, intercept, r2


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("models", nargs="+", type=Path)
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--held-out-file", default="heldout.json")
    ap.add_argument("--max-seconds", type=float, default=3600.0)
    ap.add_argument("--max-tokens", type=int, default=200_000_000)
    ap.add_argument("--max-rss-mb", type=int, default=13_200)
    # Both defaults come from `evaluate.py` rather than being repeated here. The threshold this script
    # derives and the threshold the code enforces are one number, and two copies of a number are two
    # numbers eventually.
    ap.add_argument(
        "--relative-budget",
        type=float,
        default=OOV_RELATIVE_BUDGET,
        help="the share of a perplexity the OOV gap alone may account for before two models are "
        f"refused. The derived threshold is the gap whose fitted effect reaches this. Default "
        f"{OOV_RELATIVE_BUDGET}.",
    )
    ap.add_argument(
        "--floor-gap",
        type=float,
        default=OOV_FLOOR_GAP,
        help="an OOV gap the derived threshold must not refuse, as a fraction. Default "
        f"{OOV_FLOOR_GAP}, which is E4's sound comparison of min_count 2 against 3 at 0.63%% and "
        "0.85%% OOV.",
    )
    ap.add_argument("--record", default=None, type=Path)
    args = ap.parse_args(argv)

    base = Library.load(args.manifest)
    points = []
    for path in args.models:
        started = time.monotonic()
        model = KneserNey.load(path)
        loaded = time.monotonic() - started
        row: dict = {"model": path.name, "vocab_size": len(model.vocab), "load_seconds": round(loaded, 1)}
        for label, flag in (("all_targets", False), ("in_vocabulary_only", True)):
            # A fresh budget and a fresh split per reading. Sharing either scores the second reading on
            # whatever the first left behind.
            b = Budget(max_tokens=args.max_tokens, max_seconds=args.max_seconds, max_rss_mb=args.max_rss_mb)
            held = FrozenSplit.load(base, args.held_out_file, side="heldout")
            out = evaluate(model, held, b, in_vocabulary_only=flag)
            if out.truncated:
                print(f"{path.name} {label}: TRUNCATED ({out.truncated})", file=sys.stderr)
                return 2
            row[label] = {
                "perplexity": round(out.perplexity, 4),
                "oov_rate": round(out.oov_rate, 6),
                "tokens": out.tokens,
                "in_vocabulary": out.in_vocabulary,
                "documents": out.documents,
                "fingerprint": out.fingerprint,
            }
            print(
                f"{path.name:20} {len(model.vocab):>7,} types  {label:<19} "
                f"ppl {out.perplexity:>8.2f}  oov {out.oov_rate:>7.3%}",
                file=sys.stderr,
            )
        points.append(row)
        del model

    prints = set(p["all_targets"]["fingerprint"] for p in points)
    if len(prints) != 1:
        print(f"refusing to fit: the cells were scored on different text {prints}", file=sys.stderr)
        return 2

    # Percentage points, not fractions, so the slope reads in the units the threshold is written in.
    xs = [p["all_targets"]["oov_rate"] * 100 for p in points]
    ys = [p["all_targets"]["perplexity"] for p in points]
    slope, intercept, r2 = fit(xs, ys)

    pairwise = []
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            dx = xs[j] - xs[i]
            if abs(dx) < 1e-9:
                continue
            pairwise.append(
                {
                    "a": points[i]["model"],
                    "b": points[j]["model"],
                    "d_oov_points": round(dx, 4),
                    "d_perplexity": round(ys[j] - ys[i], 4),
                    "slope": round((ys[j] - ys[i]) / dx, 3),
                }
            )
    mags = sorted(abs(p["slope"]) for p in pairwise)
    spread = mags[-1] / mags[0] if mags and mags[0] > 0 else float("inf")

    # The threshold. Read at the *best-scoring* cell's perplexity, which is the conservative end: the
    # same absolute slope is a larger share of a smaller number, so this asks the gap to be worth less.
    base_ppl = min(ys)
    worst = max(mags) if mags else abs(slope)
    derived = args.relative_budget * base_ppl / worst / 100 if worst else None
    floored = derived is not None and derived < args.floor_gap
    threshold = args.floor_gap if floored else derived

    out = {
        "points": points,
        "fit": {
            "slope_perplexity_per_oov_point": round(slope, 3),
            "intercept": round(intercept, 3),
            "r_squared": round(r2, 5),
            "pairwise": pairwise,
            "pairwise_spread": round(spread, 3) if mags else None,
            "linear": spread <= 2.0 if mags else None,
        },
        "threshold": {
            "relative_budget": args.relative_budget,
            "read_at_perplexity": round(base_ppl, 4),
            "worst_pairwise_slope": round(worst, 3),
            "derived_gap": round(derived, 6) if derived is not None else None,
            "floor_gap": args.floor_gap,
            "floor_bound": floored,
            "threshold_gap": round(threshold, 6) if threshold is not None else None,
        },
    }
    if args.record:
        args.record.parent.mkdir(parents=True, exist_ok=True)
        args.record.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
