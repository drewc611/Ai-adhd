"""Error bars, by resampling.

Every headline number in this repository is a point estimate over seven runs: 79% critic
agreement, a 3.0x cost ratio, per-frame prune rates out of two or three appearances, an
orthogonality rate of 2 in 3. `docs/EXPERIMENTS.md` already says these are single-sample noise
and `docs/RETIREMENT.md` refuses to act on one of them for exactly that reason — but neither
says *how* uncertain, because nothing computed it.

That is what resampling is for. It needs no distributional assumption, which matters here
because none of these quantities is normal and n is far too small to pretend otherwise. What it
gives back is usually a very wide interval, and a very wide interval is the correct answer at
this sample size rather than a disappointing one.

Two rules the functions here follow:

  - **Resample the unit of independence, not the row.** Cells within one run share a critic, a
    problem and a frame set, so resampling cells would treat 225 correlated observations as 225
    independent ones and produce an interval several times too narrow. Runs are the unit.
  - **Report the interval with the estimate, always.** A function here never returns a point
    estimate alone, because the entire reason the module exists is that this repository has
    been quoting them.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable, Sequence, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class Interval:
    """A point estimate with a percentile interval and the resample count behind it."""

    estimate: float | None
    lo: float | None
    hi: float | None
    level: float
    resamples: int
    #: How many resamples produced a defined statistic. Fewer than asked for is informative:
    #: it means many resamples of this corpus contain no variation to measure.
    defined: int

    def __str__(self) -> str:
        if self.estimate is None:
            return "undefined"
        if self.lo is None or self.hi is None:
            return f"{self.estimate:+.3f} (no interval: {self.defined}/{self.resamples} resamples defined)"
        return f"{self.estimate:+.3f} [{self.lo:+.3f}, {self.hi:+.3f}]"

    @property
    def width(self) -> float | None:
        return None if self.lo is None or self.hi is None else self.hi - self.lo

    def spans(self, value: float) -> bool | None:
        """Does the interval contain this value? None when there is no interval."""
        if self.lo is None or self.hi is None:
            return None
        return self.lo <= value <= self.hi


def bootstrap(
    groups: Sequence[T],
    statistic: Callable[[Sequence[T]], float | None],
    resamples: int = 2000,
    level: float = 0.95,
    seed: int = 1,
) -> Interval:
    """Percentile bootstrap over whole groups.

    `groups` is the unit of independence — runs, here, not cells. `statistic` may return None
    when a resample has nothing to measure, which happens often at this size: a resample that
    draws the same run seven times has one problem, one frame set and frequently one distinct
    score. Those are dropped and counted rather than silently treated as zero.

    Percentile rather than BCa. BCa's bias correction is estimated from the jackknife, and with
    seven groups the jackknife has seven points — the correction would be noisier than the thing
    it corrects.
    """
    if not groups:
        return Interval(None, None, None, level, resamples, 0)
    point = statistic(groups)
    rng = random.Random(seed)
    n = len(groups)
    draws: list[float] = []
    for _ in range(resamples):
        sample = [groups[rng.randrange(n)] for _ in range(n)]
        v = statistic(sample)
        if v is not None:
            draws.append(v)
    if len(draws) < 20:
        return Interval(point, None, None, level, resamples, len(draws))
    draws.sort()
    tail = (1.0 - level) / 2.0
    lo = draws[max(0, int(tail * len(draws)) - 1)]
    hi = draws[min(len(draws) - 1, int((1.0 - tail) * len(draws)))]
    return Interval(point, lo, hi, level, resamples, len(draws))


def permutation_test(
    a: Sequence[float],
    b: Sequence[float],
    statistic: Callable[[Sequence[float], Sequence[float]], float] | None = None,
    resamples: int = 10000,
    seed: int = 1,
) -> tuple[float, float]:
    """Two-sided permutation test. Returns (observed statistic, p).

    Exact under the null by construction, which is the reason to prefer it here: a t-test on
    nine or sixteen observations is asking a distributional question the data cannot answer.

    The p-value uses the (r+1)/(n+1) convention, so it is never reported as zero. At this size
    zero would be a claim the corpus cannot support — with 16 and 19 observations the smallest
    honest p is bounded by how many distinct permutations exist.
    """
    if statistic is None:

        def statistic(x: Sequence[float], y: Sequence[float]) -> float:
            return (sum(x) / len(x)) - (sum(y) / len(y))

    observed = statistic(a, b)
    pool = list(a) + list(b)
    na = len(a)
    rng = random.Random(seed)
    extreme = 0
    for _ in range(resamples):
        rng.shuffle(pool)
        if abs(statistic(pool[:na], pool[na:])) >= abs(observed):
            extreme += 1
    return observed, (extreme + 1) / (resamples + 1)
