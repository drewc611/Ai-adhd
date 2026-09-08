"""The compute ceiling, enforced rather than intended.

Training over a document library has no natural stopping point: the corpus is as large as
whatever directory it was pointed at, and an n-gram table grows with the number of distinct
contexts, not with the number of documents. Both are unbounded from inside the trainer. A weekly
job with no ceiling is a weekly job that eventually takes the runner down, and it fails on the
week the corpus grew rather than the week the code changed, which makes it look like flake.

So the ceiling is a first-class object that the trainer asks permission from, rather than a
timeout wrapped around it. The difference matters: a timeout kills the process and loses the
work, while a refused `Budget.allows()` stops the read and seals the model that exists, with the
reason recorded in its metadata. A model trained to its token ceiling is a legitimate model of a
truncated corpus. A model killed at 6000 seconds is nothing.
"""

from __future__ import annotations

import resource
import sys
import time
from dataclasses import dataclass, field


_NGRAM_CEILING = "distinct n-gram ceiling"


class BudgetExceeded(RuntimeError):
    """Raised only by `Budget.require`, for the callers that cannot degrade."""


@dataclass
class Budget:
    max_tokens: int = 50_000_000
    max_seconds: float = 1800.0
    max_ngrams: int = 20_000_000
    max_rss_mb: int = 6144
    #: How often to actually read the clock and the resident set. `getrusage` is a syscall and
    #: `time.monotonic` is not free either; at one check per token both dominate the training loop.
    check_every: int = 20_000

    started: float = field(default_factory=time.monotonic)
    tokens: int = 0
    _checks: int = 0
    _since_check: int = 0
    _stopped: str | None = None
    _peak_rss_mb: int = 0

    def spend(self, tokens: int) -> None:
        self.tokens += tokens
        self._since_check += tokens

    @property
    def elapsed(self) -> float:
        return time.monotonic() - self.started

    @property
    def stopped_because(self) -> str | None:
        return self._stopped

    def rss_mb(self) -> int:
        # ru_maxrss is kilobytes on Linux and bytes on macOS, and nothing in the stdlib reports
        # which. Getting this wrong is a factor of 1024 in the direction that never trips.
        raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        mb = raw // (1024 * 1024) if sys.platform == "darwin" else raw // 1024
        self._peak_rss_mb = max(self._peak_rss_mb, mb)
        return mb

    def allows(self, ngrams: int = 0) -> bool:
        """False once any ceiling is reached. Sets `stopped_because` on the first refusal.

        Cheap on the common path: the expensive checks run once per `check_every` tokens, and the
        token ceiling itself is a comparison, so a caller in a tight loop pays one integer compare.
        """
        if self._stopped is not None:
            return False
        if self.tokens >= self.max_tokens:
            self._stopped = f"token ceiling: {self.tokens:,} >= {self.max_tokens:,}"
            return False
        if ngrams and ngrams >= self.max_ngrams:
            self._stopped = f"{_NGRAM_CEILING}: {ngrams:,} >= {self.max_ngrams:,}"
            return False
        if self._since_check < self.check_every:
            return True

        self._since_check = 0
        self._checks += 1
        if self.elapsed >= self.max_seconds:
            self._stopped = f"wall clock: {self.elapsed:.0f}s >= {self.max_seconds:.0f}s"
            return False
        rss = self.rss_mb()
        if rss >= self.max_rss_mb:
            self._stopped = f"resident set: {rss}MB >= {self.max_rss_mb}MB"
            return False
        return True

    def relieve(self) -> bool:
        """Clear a size refusal the caller has actually resolved by pruning. Returns whether it did.

        Only the n-gram ceiling is clearable, and the check is on the stored reason rather than on
        the caller's good intentions. Clearing a wall-clock refusal would let `check_every` tokens
        of work through before the next check re-derived it, which turns the hard ceiling into a
        suggestion that leaks one batch at a time.
        """
        if self._stopped is not None and self._stopped.startswith(_NGRAM_CEILING):
            self._stopped = None
            return True
        return False

    def restart(self) -> Budget:
        """Same ceilings, fresh counters. Training reads the corpus twice — once for the
        vocabulary, once for the n-grams — and each pass gets the full ceiling, because a
        vocabulary pass that consumed the token budget would leave nothing to count."""
        return Budget(
            max_tokens=self.max_tokens,
            max_seconds=self.max_seconds,
            max_ngrams=self.max_ngrams,
            max_rss_mb=self.max_rss_mb,
            check_every=self.check_every,
        )

    def require(self, what: str) -> None:
        if not self.allows():
            raise BudgetExceeded(f"{what} refused: {self._stopped}")

    def report(self) -> dict:
        return {
            "tokens": self.tokens,
            "seconds": round(self.elapsed, 2),
            "peak_rss_mb": max(self._peak_rss_mb, self.rss_mb()),
            "checks": self._checks,
            "stopped_because": self._stopped,
            "ceilings": {
                "max_tokens": self.max_tokens,
                "max_seconds": self.max_seconds,
                "max_ngrams": self.max_ngrams,
                "max_rss_mb": self.max_rss_mb,
            },
        }

    @classmethod
    def weekly(cls) -> Budget:
        """What a scheduled run gets: under a GitHub runner's 7GB and well under its 6h limit."""
        return cls(max_tokens=40_000_000, max_seconds=1500.0, max_ngrams=12_000_000, max_rss_mb=5120)

    @classmethod
    def smoke(cls) -> Budget:
        """What a test gets. Small enough that exceeding it is the fast path, not the slow one."""
        return cls(max_tokens=200_000, max_seconds=60.0, max_ngrams=400_000, max_rss_mb=2048, check_every=1000)
