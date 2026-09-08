"""Alpha is validated against arithmetic, not against a remembered constant.

The first version of `reliability.py` used raw value frequencies where Krippendorff's
coincidence matrix is required — the two differ whenever units have different rater counts, and
three of this corpus's runs have one rater while one has four. It produced plausible numbers.
What caught it was checking against a closed form that can be derived rather than looked up.
"""

from __future__ import annotations

import random
from collections import Counter

from adhd_analysis.reliability import (
    ceiling_rate,
    distinct_values,
    krippendorff_alpha,
    percent_agreement,
    within_one,
)


def test_matches_the_closed_form_for_two_raters_and_no_missing_cells():
    """For two raters and complete data, nominal alpha has an exact closed form.

        alpha = 1 - (1 - Po)/(1 - Pe) * (2N - 1)/(2N)

    with Po the observed match rate and Pe the sum of squared marginal proportions. Derived from
    the coincidence definition, so it tests the implementation rather than a memory of a paper.
    """
    rng = random.Random(7)
    for _ in range(25):
        n_units = rng.randint(5, 60)
        a = [rng.choice([0, 1, 2, 3]) for _ in range(n_units)]
        b = [v if rng.random() < 0.7 else rng.choice([0, 1, 2, 3]) for v in a]

        ratings = {}
        for u, (x, y) in enumerate(zip(a, b)):
            ratings[(str(u), 1)] = float(x)
            ratings[(str(u), 2)] = float(y)

        po = sum(x == y for x, y in zip(a, b)) / n_units
        marks = Counter(a) + Counter(b)
        n = 2 * n_units
        pe = sum((c / n) ** 2 for c in marks.values())
        expected = 1 - (1 - po) / (1 - pe) * (2 * n_units - 1) / (2 * n_units)

        assert abs(krippendorff_alpha(ratings, "nominal") - expected) < 1e-9


def test_perfect_agreement_is_one_and_a_constant_is_undefined():
    perfect = {(str(u), r): float(u % 4) for u in range(20) for r in (1, 2)}
    assert krippendorff_alpha(perfect, "ordinal") == 1.0

    # Not 1.0. Every rater giving every unit the same mark means there is no variance to explain,
    # and calling that perfect reliability is how a dimension pinned at its ceiling gets reported
    # as the best-defined one in the rubric.
    constant = {(str(u), r): 3.0 for u in range(20) for r in (1, 2)}
    assert krippendorff_alpha(constant, "ordinal") is None


def test_systematic_disagreement_goes_below_zero():
    """Alpha's whole advantage over a percentage: it can say "worse than chance"."""
    ratings = {}
    for u in range(30):
        ratings[(str(u), 1)] = 0.0
        ratings[(str(u), 2)] = 3.0
    assert krippendorff_alpha(ratings, "ordinal") < 0


def test_units_rated_once_contribute_nothing():
    """A unit one person judged says nothing about whether two people agree."""
    paired = {(str(u), r): float(u % 3) for u in range(10) for r in (1, 2)}
    with_singles = dict(paired)
    for u in range(100, 130):
        with_singles[(str(u), 1)] = float(u % 4)
    assert krippendorff_alpha(paired, "ordinal") == krippendorff_alpha(with_singles, "ordinal")


def test_ordinal_and_interval_differ_because_a_rank_is_not_a_number():
    """The ordinal metric weights a gap by how many observations lie in it.

    A gap nothing falls into costs less than a gap many do. If ordinal and interval agreed on
    this data the ordinal path would be doing nothing.
    """
    ratings = {}
    for u in range(20):
        ratings[(str(u), 1)] = 0.0 if u % 2 else 3.0
        ratings[(str(u), 2)] = 1.0 if u % 2 else 3.0
    assert krippendorff_alpha(ratings, "ordinal") != krippendorff_alpha(ratings, "interval")


def test_percent_agreement_is_high_where_alpha_is_zero():
    """The confound this module exists to expose, in miniature.

    Nineteen units where both raters say 3 and one where they differ: 95% agreement, and alpha
    at or below zero because chance alone explains it.
    """
    ratings = {}
    for u in range(19):
        ratings[(str(u), 1)] = 3.0
        ratings[(str(u), 2)] = 3.0
    ratings[("19", 1)] = 2.0
    ratings[("19", 2)] = 3.0

    pct, pairs = percent_agreement(ratings)
    assert pairs == 20
    assert pct == 0.95
    assert krippendorff_alpha(ratings, "ordinal") <= 0.0
    assert ceiling_rate(ratings, 3.0) > 0.95
    assert distinct_values(ratings) == 2


def test_within_one_is_not_agreement():
    """100% within one point over a two-value scale is arithmetic, not reliability."""
    ratings = {}
    for u in range(20):
        ratings[(str(u), 1)] = 2.0
        ratings[(str(u), 2)] = 3.0 if u % 2 else 2.0
    assert within_one(ratings) == 1.0
    assert percent_agreement(ratings)[0] < 1.0
