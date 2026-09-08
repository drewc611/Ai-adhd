"""The corpus loader, and the findings pinned so a corpus change has to confront them."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from adhd_analysis.corpus import load
from adhd_analysis.reliability import krippendorff_alpha, summarise
from adhd_analysis.resample import Interval, bootstrap, permutation_test
from adhd_analysis.signal import build_design, prune_signal

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def corpus():
    return load(ROOT)


def test_the_loader_reproduces_the_number_the_typescript_reports(corpus):
    """79% exact over 225 cells, 100% within one point.

    The repository computes that in `src/learn.ts`. Reproducing it in Python from the same files
    is what makes everything else here trustworthy: a loader that quietly dropped a rater or
    mis-joined a blind letter would produce a different figure and no error.
    """
    pair_only = {
        (f"{run}/{letter}/{dim}", rater): float(v)
        for (run, rater, letter, dim), v in corpus.scores.items()
        if rater in (1, 2)
    }
    s = summarise(pair_only, 3)
    assert s["pairs"] == 225
    assert round(s["percent_agreement"], 2) == 0.79
    assert s["within_one"] == 1.0


def test_frame_ids_are_forwarded_so_a_rename_is_not_a_tenth_frame(corpus):
    frames = {a.frame for a in corpus.artifacts}
    assert "SUPPLICANT" in frames
    assert "END_USER" not in frames, "a run that wrote the old id was counted as a separate frame"
    for m in corpus.blind_maps.values():
        assert "END_USER" not in m.values()


def test_negative_controls_are_not_loaded_as_runs(corpus):
    """A control is a hand-written answer with no plan and no score, not a run."""
    assert not any(a.run.endswith("-linear-cot") for a in corpus.artifacts)
    assert len(corpus.runs) == 7


def test_foreclosure_agrees_almost_always_and_measures_nothing(corpus):
    """The finding. If this ever fails, the rubric changed and the finding needs rewriting.

    96% exact agreement, alpha at or below zero, two distinct values in the whole corpus. The
    critics agree because there is nothing to disagree about.
    """
    cells = {
        (f"{run}/{letter}", rater): float(v)
        for (run, rater, letter, dim), v in corpus.scores.items()
        if dim == "foreclosure"
    }
    s = summarise(cells, 3)
    assert s["percent_agreement"] > 0.9
    assert s["alpha"] is not None and s["alpha"] <= 0.05
    assert s["distinct"] == 2
    assert s["ceiling_rate"] > 0.9


def test_the_two_rankings_invert(corpus):
    """Percent agreement ranks dimensions by how constant they are.

    `foreclosure` is near the top by percentage and last by alpha; `reversibility` is near the
    bottom by percentage and first by alpha. Any one of those could move with a new run — that
    the two orderings disagree at all is the durable part.
    """
    rows = {}
    for d in corpus.dimensions:
        cells = {
            (f"{run}/{letter}", rater): float(v)
            for (run, rater, letter, dim), v in corpus.scores.items()
            if dim == d.id
        }
        rows[d.id] = summarise(cells, d.anchors - 1)

    by_pct = sorted(rows, key=lambda k: -rows[k]["percent_agreement"])
    by_alpha = sorted(rows, key=lambda k: -(rows[k]["alpha"] if rows[k]["alpha"] is not None else -9))
    assert by_pct != by_alpha

    assert by_pct.index("foreclosure") < 3, "foreclosure is no longer near the top by percentage"
    assert by_alpha.index("foreclosure") == len(by_alpha) - 1, "foreclosure is no longer last by alpha"
    assert by_alpha.index("reversibility") == 0, "reversibility is no longer the most reliable dimension"
    assert by_pct.index("reversibility") > by_alpha.index("reversibility")


def test_every_dimension_pushes_the_same_way_on_the_outcome(corpus):
    """One latent factor, not nine dimensions.

    `learn --correlation` reports max |r| = 0.51, so no two dimensions are redundant with each
    other. All nine still load the same direction on whether an artifact is pruned, which a
    pairwise correlation matrix has no column for.
    """
    r = prune_signal(corpus)
    assert len(r.coefficients) == 9
    assert all(c < 0 for c in r.coefficients.values()), r.coefficients
    assert r.model_accuracy > r.baseline_accuracy


def test_the_signal_model_is_grouped_by_run_and_never_scored_in_sample(corpus):
    """Artifacts in one run share a problem, a critic and a frame set.

    A random split would leak across those and report a score several points too high, which at
    n=35 with 9 features would look like a result.
    """
    d = build_design(corpus)
    assert len(d) == 35
    assert len(set(d.groups.tolist())) == 7
    for run in set(d.groups.tolist()):
        assert (d.groups == run).sum() >= 4, "a run contributes several artifacts, so folds must group by run"


def test_bootstrap_resamples_runs_and_reports_when_it_cannot(corpus):
    multi = corpus.multi_rated_runs()
    assert len(multi) == 5

    def alpha_over(runs):
        keep = set(runs)
        cells = {
            (f"{run}/{letter}", rater): float(v)
            for (run, rater, letter, dim), v in corpus.scores.items()
            if dim == "reversibility" and run in keep
        }
        return krippendorff_alpha(cells, "ordinal")

    ci = bootstrap(multi, alpha_over, resamples=200, seed=3)
    assert ci.estimate is not None
    assert ci.lo is not None and ci.hi is not None
    assert ci.lo <= ci.estimate <= ci.hi
    assert ci.width is not None and ci.width > 0
    assert ci.defined <= ci.resamples

    # A statistic that is never defined gets no interval rather than a fabricated one. When the
    # point estimate is undefined too, "undefined" is the whole of what can be said.
    empty = bootstrap(multi, lambda _runs: None, resamples=50)
    assert empty.lo is None and empty.hi is None and empty.defined == 0
    assert str(empty) == "undefined"

    # An estimate that exists but whose resamples mostly do not gets the estimate and a reason.
    once = bootstrap(multi, lambda runs: 0.5 if len(set(runs)) == len(multi) else None, resamples=50)
    assert once.estimate == 0.5 and once.lo is None
    assert "no interval" in str(once)


def test_bootstrap_of_nothing_is_undefined_not_zero():
    ci = bootstrap([], lambda _s: 1.0, resamples=10)
    assert ci == Interval(None, None, None, 0.95, 10, 0)
    assert str(ci) == "undefined"


def test_permutation_p_is_never_zero():
    """At sixteen and nineteen observations, a reported p of zero would be a claim the corpus
    cannot support. The (r+1)/(n+1) convention bounds it by the resample count."""
    a = [1.0] * 16
    b = [9.0] * 19
    observed, p = permutation_test(a, b, resamples=500, seed=1)
    assert observed != 0
    assert p > 0
    assert p <= 1

    same = [1.0, 2.0, 3.0, 4.0] * 4
    _obs, p_same = permutation_test(same[:8], same[8:], resamples=500, seed=1)
    assert p_same > 0.2, "identical distributions should not look significant"


def test_the_readme_badge_states_the_number_pytest_collects(request):
    """The badge says how many Python tests there are, and pytest is the only thing that knows.

    Counting `def test_` from the TypeScript side gives 38, because one test is parametrised into
    six cases. Both numbers are true about different things, and the one a reader can check by
    running `pytest` is this one, so this is the side that owns the badge.
    """
    readme = (ROOT / "README.md").read_text()
    m = re.search(r"/badge/python%20tests-(\d+)-", readme)
    assert m, "the README has no python tests badge"
    assert int(m.group(1)) == request.session.testscollected, "the badge has drifted from the suite"
