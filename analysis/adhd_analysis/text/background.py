"""What a background model has to be, so that anything taking one takes any of them.

Three classes train here — modified Kneser-Ney, a decoder-only transformer, and an LSTM — and all
three are written from scratch with no download and no key, which is what keeps them inside D2.
Until now only the n-gram could be *used*: `genericity.py` was typed and written against
`KneserNey`, so the transformer D20 added could be trained and then handed to nothing.

This is the surface, and it is small on purpose. A model that answers these four questions can be
the background model for the T1 genericity measure, and adding a fifth method here is a decision
about every class at once.
"""

from __future__ import annotations

from typing import Iterable, Protocol

from .tokenize import Vocab


class BackgroundModel(Protocol):
    """A trained language model that can say how surprising a piece of prose is.

    Static typing only. It carries data members, so `issubclass` against it raises rather than
    answering; `test_every_model_class_satisfies_the_background_protocol` checks the methods
    directly instead of asking `typing` a question it cannot answer.
    """

    vocab: Vocab
    meta: dict

    def logprob_terms(self, ids: Iterable[int]) -> list[tuple[float, bool]]:
        """Per-position natural-log probability, and whether that position's target is a real word."""

    def surprisal(self, ids: list[int]) -> list[float]:
        """Per-token surprisal in bits, excluding the end-of-sequence target."""

    def describe(self) -> str:
        """One line naming the model class and its shape, for a report that takes any of them."""
