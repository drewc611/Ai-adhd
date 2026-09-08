"""How much the nine rubric dimensions actually separate outcomes.

This is the small model, and it is a **measurement instrument, not a component**. Nothing in
`src/` imports it, it never runs during a run, and it makes no decision — D2 says the reasoning
is done by isolated subagents and a model that scored or clustered anything here would be an
inference client in a lab coat. What it does is put a number on a question the repository has
been answering in prose.

The question, stated precisely, matters:

**Pass A does not prune. A fired trap does.** `docs/BACKLOG.md` item 24 records that correction,
made while building `learn --sensitivity`. What pass A decides is which survivor represents its
cluster and goes to deepen. So a model predicting `pruned` from the nine dimensions is *not*
modelling the mechanism — it is asking whether the blind score carries information about an
outcome it does not drive. Both answers are worth having:

  - **It separates them well** → pass A and the trap sweep are measuring overlapping things, and
    the architecture is running two checks that agree. That is a redundancy finding.
  - **It does not** → the two are independent, which is what a critic pass and a detector sweep
    are supposed to be.

Every number here is cross-validated leave-one-run-out, never in-sample. Thirty-five artifacts
across seven runs is not enough to fit anything predictive, and an in-sample accuracy on 35
points with 9 features would be near-perfect and meaningless. Grouping by run is not a detail:
artifacts within one run share a problem, a critic and a frame set, so a random split would leak
and report a score several points too high.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import LeaveOneGroupOut, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .corpus import Corpus


@dataclass
class Design:
    """The modelling matrix, with the row provenance kept so nothing is silently pooled."""

    X: np.ndarray
    y: np.ndarray
    groups: np.ndarray
    feature_names: list[str]
    frames: list[str]
    runs: list[str]

    def __len__(self) -> int:
        return len(self.y)


def build_design(corpus: Corpus, rater: int = 1) -> Design:
    """One row per scored artifact: nine blind dimension scores, the outcome, and its run.

    Joined through the blind map, because pass A is blind: the scores are held under a letter
    and only the map says which frame that letter was. Frame ids are forwarded, so a run that
    wrote `END_USER` lands on `SUPPLICANT` rather than becoming a tenth frame.
    """
    dims = [d.id for d in corpus.dimensions]
    rows: list[list[float]] = []
    y: list[int] = []
    groups: list[str] = []
    frames: list[str] = []
    runs: list[str] = []

    for art in corpus.artifacts:
        bm = corpus.blind_maps.get(art.run)
        if not bm:
            continue
        letters = [L for L, f in bm.items() if f == art.frame]
        if not letters:
            continue
        letter = letters[0]
        row = [corpus.scores.get((art.run, rater, letter, d)) for d in dims]
        if any(v is None for v in row):
            continue
        rows.append([float(v) for v in row])  # type: ignore[arg-type]
        y.append(1 if art.status == "pruned" else 0)
        groups.append(art.run)
        frames.append(art.frame)
        runs.append(art.run)

    return Design(np.array(rows), np.array(y), np.array(groups), dims, frames, runs)


@dataclass
class SignalResult:
    n: int
    runs: int
    positives: int
    baseline_accuracy: float
    model_accuracy: float
    #: Accuracy of the always-majority baseline is what "no signal" looks like here.
    lift: float
    coefficients: dict[str, float]
    fold_accuracies: list[float]
    text: str


def prune_signal(corpus: Corpus, rater: int = 1) -> SignalResult:
    """Leave-one-run-out accuracy predicting `pruned` from the nine blind dimensions."""
    d = build_design(corpus, rater=rater)
    n = len(d)
    logo = LeaveOneGroupOut()

    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))
    pred = cross_val_predict(model, d.X, d.y, groups=d.groups, cv=logo)
    acc = float((pred == d.y).mean())

    dummy = DummyClassifier(strategy="most_frequent")
    base_pred = cross_val_predict(dummy, d.X, d.y, groups=d.groups, cv=logo)
    base = float((base_pred == d.y).mean())

    folds: list[float] = []
    for train, test in logo.split(d.X, d.y, d.groups):
        if len(set(d.y[train])) < 2:
            continue  # a fold whose training half has one class teaches nothing
        m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000))
        m.fit(d.X[train], d.y[train])
        folds.append(float((m.predict(d.X[test]) == d.y[test]).mean()))

    full = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(d.X, d.y)
    coefs = dict(zip(d.feature_names, full[-1].coef_[0].tolist()))

    lines = [
        f"prune signal in the blind pass A scores: {n} artifacts over {len(set(d.groups.tolist()))} runs, "
        f"{int(d.y.sum())} pruned",
        "",
        f"  leave-one-run-out accuracy   {acc:.0%}",
        f"  always-majority baseline     {base:.0%}",
        f"  lift over baseline           {acc - base:+.0%}",
        "",
        "Pass A does not prune; a fired trap does. This asks whether the blind score carries",
        "information about an outcome it does not drive — separation would mean the critic pass",
        "and the detector sweep are measuring overlapping things.",
        "",
        "coefficients on standardised scores, fit on everything (direction only, not a prediction):",
    ]
    for name, c in sorted(coefs.items(), key=lambda kv: -abs(kv[1])):
        lines.append(f"  {name:20} {c:+.3f}  {'higher score -> more likely pruned' if c > 0 else 'higher score -> less likely pruned'}")
    lines.append("")
    lines.append(
        f"At n={n} with 9 features this is descriptive. It is reported cross-validated and grouped by "
        "run because an in-sample number here would be near-perfect and would mean nothing."
    )

    return SignalResult(
        n=n,
        runs=len(set(d.groups.tolist())),
        positives=int(d.y.sum()),
        baseline_accuracy=base,
        model_accuracy=acc,
        lift=acc - base,
        coefficients=coefs,
        fold_accuracies=folds,
        text="\n".join(lines),
    )
