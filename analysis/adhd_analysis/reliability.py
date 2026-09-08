"""Inter-rater reliability, corrected for chance.

The repository currently reports critic agreement as **percent exact match**: 79% over 225
cells, 100% within one point. That number is not wrong, but it is not reliability, and the
difference matters here more than it usually would.

Percent agreement counts agreements that chance would have produced anyway. When a dimension
almost always takes the same value, two raters guessing at random would still agree most of the
time — so a high percentage says the dimension is nearly constant, not that the raters
understood it. D8 finding 5 already established that `foreclosure` scores its maximum 91% of
the time and `reasoning_carries` 94%, and the learning loop separately noticed that **the two
dimensions the critics agree on most are the two pinned at the ceiling**. Percent agreement
cannot tell those two facts apart. A chance-corrected coefficient can.

Krippendorff's alpha is the right one for this corpus: it handles more than two raters (one
pack has four), missing cells (three runs have one rater), and ordinal data, which the anchors
are — 0 to 3 is ordered, and being off by three is worse than being off by one.

    alpha = 1 - Do/De

`Do` is observed disagreement, `De` the disagreement expected if the same marks were shuffled at
random. 1 is perfect, 0 is chance, and **negative is worse than chance** — systematic
disagreement, a real possibility here and one a percentage cannot express.

Implemented rather than imported, because a number this repository would quote about itself
should have its arithmetic in the repository. The tests check it against Krippendorff's own
published worked example, which is how the first version of this file was caught: it used raw
value frequencies where the coincidence matrix is required, and reproduced none of the
published figures.
"""

from __future__ import annotations

import itertools
from collections import Counter, defaultdict
from typing import Iterable, Literal

Metric = Literal["nominal", "ordinal", "interval"]

#: (unit, rater) -> value. A unit is the thing being rated; missing pairs are simply absent.
Ratings = dict[tuple[str, int], float]


def _coincidence(by_unit: dict[str, list[float]]) -> tuple[dict[tuple[float, float], float], dict[float, float], float]:
    """The coincidence matrix, its row sums, and its total.

    The row sums are not raw value frequencies, and that distinction is the reason this is
    written out rather than counted directly: each unit contributes its pairs weighted by
    1/(m_u - 1), so a unit three raters scored contributes differently from one two raters
    scored. Using raw frequencies gives nominal alpha 0.675 where Krippendorff publishes 0.743.
    """
    o: dict[tuple[float, float], float] = {}
    for values in by_unit.values():
        m = len(values)
        if m < 2:
            continue  # a unit one rater judged says nothing about whether raters agree
        counts: Counter[float] = Counter(values)
        for c in counts:
            for k in counts:
                pairs = counts[c] * (counts[c] - 1) if c == k else counts[c] * counts[k]
                if pairs:
                    o[(c, k)] = o.get((c, k), 0.0) + pairs / (m - 1)
    n_c: dict[float, float] = {}
    for (c, _k), v in o.items():
        n_c[c] = n_c.get(c, 0.0) + v
    return o, n_c, sum(n_c.values())


def _delta(metric: Metric, n_c: dict[float, float]):
    """Squared difference between two values, by metric.

    Ordinal is the one worth explaining. It is not `(a - b) ** 2` on the raw scores: the distance
    between two ranks depends on how many observations lie between them, so a gap no artifact
    ever falls into costs less than a gap many do. That is the property a raw difference lacks,
    and it is why an ordinal scale is not an interval one.
    """
    if metric == "nominal":
        return lambda a, b: 0.0 if a == b else 1.0
    if metric == "interval":
        return lambda a, b: float((a - b) ** 2)

    order = sorted(n_c)

    def ordinal(a: float, b: float) -> float:
        lo, hi = (a, b) if a <= b else (b, a)
        span = sum(n_c[g] for g in order if lo <= g <= hi) - (n_c[lo] + n_c[hi]) / 2.0
        return float(span**2)

    return ordinal


def krippendorff_alpha(ratings: Ratings, metric: Metric = "ordinal") -> float | None:
    """Alpha over units rated by two or more raters. None when nothing is comparable."""
    by_unit: dict[str, list[float]] = defaultdict(list)
    for (unit, _rater), value in ratings.items():
        by_unit[unit].append(float(value))

    o, n_c, n = _coincidence(by_unit)
    if n < 2 or len(n_c) < 2:
        # One distinct value everywhere: no disagreement and no variance to explain, so alpha is
        # undefined rather than perfect. A constant is not a measurement.
        return None

    delta = _delta(metric, n_c)
    values = sorted(n_c)
    observed = sum(o.get((c, k), 0.0) * delta(c, k) for c in values for k in values if c != k)
    expected = sum(n_c[c] * n_c[k] * delta(c, k) for c in values for k in values if c != k) / (n - 1)
    if expected == 0:
        return None
    return 1.0 - observed / expected


def percent_agreement(ratings: Ratings) -> tuple[float, int]:
    """Exact-match rate over rater pairs, and how many pairs. What the repo reports today."""
    by_unit: dict[str, list[float]] = defaultdict(list)
    for (unit, _rater), value in ratings.items():
        by_unit[unit].append(float(value))
    agree = pairs = 0
    for vs in by_unit.values():
        for a, b in itertools.combinations(vs, 2):
            pairs += 1
            agree += a == b
    return (agree / pairs if pairs else 0.0), pairs


def within_one(ratings: Ratings) -> float:
    """Share of rater pairs within one anchor point. The repo's other headline number."""
    by_unit: dict[str, list[float]] = defaultdict(list)
    for (unit, _rater), value in ratings.items():
        by_unit[unit].append(float(value))
    close = pairs = 0
    for vs in by_unit.values():
        for a, b in itertools.combinations(vs, 2):
            pairs += 1
            close += abs(a - b) <= 1
    return close / pairs if pairs else 0.0


def ceiling_rate(ratings: Ratings, top: float) -> float:
    """Share of marks at the maximum anchor. What percent agreement is confounded by."""
    vals = list(ratings.values())
    return sum(1 for v in vals if v == top) / len(vals) if vals else 0.0


def distinct_values(ratings: Ratings) -> int:
    return len({float(v) for v in ratings.values()})


def summarise(ratings: Ratings, top: float, metric: Metric = "ordinal") -> dict[str, float | int | None]:
    pa, pairs = percent_agreement(ratings)
    return {
        "alpha": krippendorff_alpha(ratings, metric),
        "percent_agreement": pa,
        "within_one": within_one(ratings),
        "pairs": pairs,
        "ceiling_rate": ceiling_rate(ratings, top),
        "distinct": distinct_values(ratings),
        "marks": len(ratings),
    }


def as_ratings(cells: Iterable[tuple[str, int, float]]) -> Ratings:
    """(unit, rater, value) triples into the mapping alpha wants."""
    return {(unit, rater): value for unit, rater, value in cells}
