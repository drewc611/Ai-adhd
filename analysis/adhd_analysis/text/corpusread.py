"""Reading a document library into tokens, under a ceiling.

One function, in its own module because the alternative is worse: it belongs to neither trainer, and
putting it in `corpora.py` would make the corpus loader depend on the tokenizer and the budget, which
it currently does not and has no other reason to.
"""

from __future__ import annotations

from typing import Iterator

from .budget import Budget
from .corpora import Library
from .tokenize import sentences, tokens


def sentence_tokens(library: Library, budget: Budget) -> Iterator[list[str]]:
    """Every sentence of every document as a token list, spending tokens against `budget`.

    Lived in both trainers byte-identically. It is not a shape anyone has to guess at — it is how this
    repository reads a corpus, and both model classes read it the same way — so it sits here rather
    than in whichever trainer was written first.

    The budget is spent before the yield and checked after it, so a caller that stops consuming still
    gets charged for what it read, and the generator stops at the ceiling rather than one document
    past it.
    """
    for _name, doc in library.documents():
        for s in sentences(doc):
            ts = tokens(s)
            if not ts:
                continue
            budget.spend(len(ts))
            yield ts
            if not budget.allows():
                return
