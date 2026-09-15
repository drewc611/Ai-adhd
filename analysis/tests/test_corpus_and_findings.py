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
    assert len(corpus.runs) == 11, "E10's two fixture-014 runs are the tenth and eleventh; the four -linear-cot controls are still excluded"
    # Fixture 014 dispatches seven branches, every other fixture five, so the corpus is no longer a
    # multiple of five artifacts. Anything that divides by five is wrong from here on.
    assert len([a for a in corpus.artifacts if a.run.startswith("014-")]) == 14


def test_the_ninth_run_is_a_replicate_and_the_corpus_cannot_tell(corpus):
    """Backlog 99, pinned so the gap is visible from the analysis side too.

    `001-seed3-repeat` is `001-seed3` at the same seed with byte-identical briefs. For reliability
    work that is exactly what is wanted -- more scorings of the same pack -- and every function in
    this package treats it correctly. For any *rate over runs* it is one draw counted twice, and
    nothing here knows the difference. This test exists so the next person to compute a per-frame
    rate over `corpus.runs` finds the caveat rather than the number.

    What makes the pair a replicate is the frame set and the problem, not the prose: the branches
    are separate model samples and their positions differ, which is the whole reason the pair was
    run.
    """
    assert "001-seed3" in corpus.runs and "001-seed3-repeat" in corpus.runs
    frames = lambda run: {a.frame for a in corpus.artifacts if a.run == run}
    assert frames("001-seed3") == frames("001-seed3-repeat"), (
        "a replicate that dispatched a different frame set is not a replicate"
    )
    assert len(frames("001-seed3")) == 5
    words = lambda run: {a.frame: a.words for a in corpus.artifacts if a.run == run}
    first, second = words("001-seed3"), words("001-seed3-repeat")
    assert any(first[f] != second[f] for f in first), (
        "every artifact reproduced to the word, which would mean the pair is one sample and not two"
    )
    # And the finding the pair exists to carry: the trap sweep did not reproduce.
    fired = lambda run: sorted(t for a in corpus.artifacts if a.run == run for t in a.fired)
    assert fired("001-seed3-repeat") == [], "the repeat fired no detector on any frame"
    assert len(fired("001-seed3")) >= 2, "001-seed3 fired at least twice on the same pack"


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


def test_unfence_matches_the_shared_cases_the_typescript_side_asserts_against():
    """Backlog 96. Two loaders, two CI jobs, nothing comparing them, and they disagreed.

    This side used rfind, which cuts at a backtick run anywhere in the body rather than at a
    closing fence on its own line, so the first fenced recording broke the whole Python suite
    while every TypeScript test stayed green. evals/artifact-loader-cases.json is the contract
    both sides now assert against, and its expectations are hand-written rather than captured
    from either implementation, so "both agree" cannot mean "both are wrong in the same way".
    """
    import json
    from pathlib import Path

    from adhd_analysis.corpus import unfence

    root = Path(__file__).resolve().parents[2]
    doc = json.loads((root / "evals" / "artifact-loader-cases.json").read_text())
    assert len(doc["cases"]) >= 9, "the shared case file has been thinned"
    for case in doc["cases"]:
        assert unfence(case["text"]) == case["unfenced"], f"unfence disagrees with the shared case: {case['name']}"

    names = [c["name"] for c in doc["cases"]]
    assert any("not at line start" in n for n in names), "the case that caught the rfind divergence is gone"
    assert any("seed 3 failure" in n for n in names), "the case that carries D37's failure is gone"


def test_the_two_ceiling_dimensions_are_not_the_same_case(corpus):
    """D39. Item 60 named two "ceiling dimensions" and assumed one answer covered both.

    foreclosure and reasoning_carries sit at almost the same ceiling — 0.943 against 0.947 — and
    are nothing alike underneath. foreclosure's interval contains zero, so 96% agreement told you
    nothing guessing would not have. reasoning_carries reaches alpha 0.678 on an interval that
    excludes zero, which puts it above committal, substance, falsifiability and actor_coverage.
    The ceiling rate is the one statistic that cannot tell prevention from dead weight, and it was
    doing all the work in the original framing.

    If this fails, the corpus has moved and D39 needs rereading rather than the numbers nudging.
    """
    from adhd_analysis.report import reliability_section

    _, table = reliability_section(corpus, resamples=200)
    fore = table["foreclosure"]
    reas = table["reasoning_carries"]

    # Both at the ceiling, which is what made them look alike.
    assert fore["ceiling_rate"] > 0.9 and reas["ceiling_rate"] > 0.9

    # And separated by the statistic that matters.
    assert fore["ci_hi"] <= 0.0 + 1e-9, "foreclosure's interval no longer reaches zero"
    assert reas["ci_lo"] > 0.3, "reasoning_carries' interval now approaches chance; D39 rests on it not doing that"
    assert reas["alpha"] > fore["alpha"] + 0.5

    # reasoning_carries is mid-pack rather than worst, which is the whole finding.
    ranked = sorted(table.items(), key=lambda kv: kv[1]["alpha"])
    order = [name for name, _ in ranked]
    assert order[0] == "foreclosure", f"foreclosure is no longer the worst dimension: {order}"
    assert order.index("reasoning_carries") >= 4, f"reasoning_carries is no longer mid-pack: {order}"

    # committal is the one that now carries foreclosure's problem, and is backlog 98.
    assert table["committal"]["ci_lo"] < 0.0 < table["committal"]["ci_hi"], "committal's interval no longer spans chance"
