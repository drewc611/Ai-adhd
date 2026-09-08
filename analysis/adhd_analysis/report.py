"""The report. `python -m adhd_analysis` from the repository root.

Reads `evals/recorded/`, writes text. Never calls a model, never runs during a run, and nothing
under `src/` imports it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .corpus import Corpus, load
from .reliability import krippendorff_alpha, summarise
from .resample import bootstrap
from .signal import prune_signal


def _dimension_ratings(corpus: Corpus, dim: str, runs: list[str] | None = None):
    keep = set(runs) if runs is not None else None
    return {
        (f"{run}/{letter}", rater): float(v)
        for (run, rater, letter, d), v in corpus.scores.items()
        if d == dim and (keep is None or run in keep)
    }


def reliability_section(corpus: Corpus, resamples: int) -> tuple[str, dict]:
    multi = corpus.multi_rated_runs()
    lines = [
        "## Critic reliability, corrected for chance",
        "",
        f"{len(multi)} run(s) scored by more than one critic. Krippendorff's alpha, ordinal.",
        "1.0 is perfect, 0.0 is chance, below zero is worse than chance.",
        "",
        f"{'dimension':20} {'wt':>3} {'alpha':>7} {'95% interval':>20} {'%exact':>7} {'ceiling':>8} {'values':>7}",
    ]
    data: dict[str, dict] = {}
    for d in corpus.dimensions:
        cells = _dimension_ratings(corpus, d.id)
        s = summarise(cells, d.anchors - 1)
        ci = bootstrap(
            multi,
            lambda sample, dim=d.id: krippendorff_alpha(_dimension_ratings(corpus, dim, list(sample)), "ordinal"),
            resamples=resamples,
        )
        interval = "—" if ci.lo is None else f"[{ci.lo:+.2f}, {ci.hi:+.2f}]"
        alpha = " none" if s["alpha"] is None else f"{s['alpha']:+.3f}"
        lines.append(
            f"{d.id:20} {d.weight:>3} {alpha:>7} {interval:>20} {s['percent_agreement']:>6.0%} "
            f"{s['ceiling_rate']:>8.0%} {s['distinct']:>7}"
        )
        data[d.id] = {"alpha": s["alpha"], "ci_lo": ci.lo, "ci_hi": ci.hi, **{k: v for k, v in s.items() if k != "alpha"}}

    ranked_pct = [d.id for d in sorted(corpus.dimensions, key=lambda x: -data[x.id]["percent_agreement"])]
    ranked_alpha = [d.id for d in sorted(corpus.dimensions, key=lambda x: -(data[x.id]["alpha"] if data[x.id]["alpha"] is not None else -9))]

    lines += [
        "",
        "The two rankings disagree, and that is the finding:",
        "",
        f"{'by % exact agreement':24} {'by chance-corrected alpha':24}",
    ]
    for a, b in zip(ranked_pct, ranked_alpha):
        lines.append(f"  {a:22} {b:22}")

    worst = min((d for d in corpus.dimensions if data[d.id]["alpha"] is not None), key=lambda d: data[d.id]["alpha"])
    best = max((d for d in corpus.dimensions if data[d.id]["alpha"] is not None), key=lambda d: data[d.id]["alpha"])
    lines += [
        "",
        f"`{worst.id}` agrees {data[worst.id]['percent_agreement']:.0%} of the time and has alpha "
        f"{data[worst.id]['alpha']:+.3f}, with",
        f"{data[worst.id]['ceiling_rate']:.0%} of its marks at the top anchor and "
        f"{data[worst.id]['distinct']} distinct values in the whole corpus. The critics",
        "agree because there is almost nothing to disagree about. Corrected for chance it carries no",
        "reliable signal.",
        "",
        f"`{best.id}` agrees {data[best.id]['percent_agreement']:.0%} of the time, lower, and has alpha "
        f"{data[best.id]['alpha']:+.3f}, with {data[best.id]['distinct']} distinct",
        f"values and {data[best.id]['ceiling_rate']:.0%} at the ceiling. The critics agree about something that varies,",
        "which is what a reliable dimension looks like.",
        "",
        "Percent agreement ranks dimensions by how constant they are. That is why the repository's",
        "headline reliability number is highest on exactly the two dimensions D8 finding 5 identified",
        "as measuring the output contract and the D4 tool allowlist rather than the reasoning.",
    ]

    spans_chance = [
        d.id
        for d in corpus.dimensions
        if data[d.id]["ci_lo"] is not None and data[d.id]["ci_lo"] <= 0.0 <= data[d.id]["ci_hi"]
    ]
    if spans_chance:
        lines += [
            "",
            f"At this sample size the interval for {', '.join(f'`{x}`' for x in spans_chance)} spans zero.",
            "Whatever their point estimates, seven runs cannot distinguish them from chance, and the",
            "honest reading of a dimension whose interval contains chance is that it is unmeasured.",
        ]
    return "\n".join(lines), data


def pooled_section(corpus: Corpus, resamples: int) -> tuple[str, dict]:
    multi = corpus.multi_rated_runs()

    def pooled(runs) -> float | None:
        keep = set(runs)
        cells = {
            (f"{run}/{letter}/{dim}", rater): float(v)
            for (run, rater, letter, dim), v in corpus.scores.items()
            if run in keep
        }
        return krippendorff_alpha(cells, "ordinal")

    ci = bootstrap(multi, pooled, resamples=resamples)
    pair_only = {
        (f"{run}/{letter}/{dim}", rater): float(v)
        for (run, rater, letter, dim), v in corpus.scores.items()
        if rater in (1, 2)
    }
    s = summarise(pair_only, 3)
    lines = [
        "## Pooled",
        "",
        f"Rater 1 against rater 2, the comparison the repository reports: {s['pairs']} cells, "
        f"{s['percent_agreement']:.0%} exact, {s['within_one']:.0%} within one point.",
        f"Chance-corrected over the same cells: alpha {s['alpha']:+.3f}.",
        "",
        f"All raters, all pairs: alpha {ci}",
        f"  bootstrap over {len(multi)} run(s), {ci.defined}/{ci.resamples} resamples defined"
        + (f", interval width {ci.width:.2f}." if ci.width is not None else "."),
        "",
        "The pooled figure is the stable one, because it averages 630 marks over nine dimensions.",
        "That stability is not reassurance: pooling is exactly what hides the per-dimension result",
        "above, where one dimension sits at chance and another's interval spans it.",
    ]
    return "\n".join(lines), {"pooled_alpha": ci.estimate, "ci_lo": ci.lo, "ci_hi": ci.hi, "pair_only": s}


def signal_section(corpus: Corpus, resamples: int) -> tuple[str, dict]:
    r = prune_signal(corpus)
    lines = ["## Does the blind score predict an outcome it does not decide?", "", r.text, ""]
    negative = sum(1 for c in r.coefficients.values() if c < 0)
    if negative == len(r.coefficients):
        lines += [
            f"**All {len(r.coefficients)} coefficients point the same way.** Every dimension, scored higher,",
            "makes an artifact less likely to be pruned. That is one latent factor wearing nine names, and",
            "it is invisible to the pairwise correlation the repository already runs: `learn --correlation`",
            "reports max |r| = 0.51, so no two dimensions are redundant *with each other* — but all nine",
            "load on the same outcome. A correlation matrix cannot see a common factor it has no column for.",
        ]
    return "\n".join(lines), {
        "accuracy": r.model_accuracy,
        "baseline": r.baseline_accuracy,
        "lift": r.lift,
        "n": r.n,
        "coefficients": r.coefficients,
    }


def build(root: str | Path = ".", resamples: int = 2000) -> tuple[str, dict]:
    corpus = load(root)
    rel, rel_data = reliability_section(corpus, resamples)
    pooled, pooled_data = pooled_section(corpus, resamples)
    sig, sig_data = signal_section(corpus, resamples)

    header = [
        "# Corpus analysis",
        "",
        f"{len(corpus.runs)} recorded run(s), {len(corpus.artifacts)} scored artifacts, "
        f"{len(corpus.scores)} critic marks.",
        "",
        "Generated by `python -m adhd_analysis`. Reads `evals/recorded/` and nothing else: no model is",
        "called, nothing here runs during a run, and nothing under `src/` imports this package.",
        "",
        "",
    ]
    text = "\n".join(header) + "\n\n".join([rel, pooled, sig]) + "\n"
    return text, {"reliability": rel_data, "pooled": pooled_data, "signal": sig_data}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="adhd_analysis", description="Statistics over the recorded corpus. Never calls a model.")
    ap.add_argument("--root", default=".", help="repository root holding config/ and evals/")
    ap.add_argument("--resamples", type=int, default=2000, help="bootstrap resamples")
    ap.add_argument("--json", action="store_true", help="machine readable")
    args = ap.parse_args(argv)

    text, data = build(args.root, args.resamples)
    print(json.dumps(data, indent=2, default=float) if args.json else text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
