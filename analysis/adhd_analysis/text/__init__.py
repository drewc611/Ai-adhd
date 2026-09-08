"""The text package: tokenise, read a document library, train, and score on held-out text.

`train` and `evaluate` are deliberately absent from these re-exports. Both are `python -m` entry
points, and importing them here makes the interpreter load the module once as a package attribute
and again as `__main__`, which it warns about and which would run module-level work twice if any
were ever added. Import them by path.
"""

from .budget import Budget, BudgetExceeded
from .corpora import CorpusError, Library, Source
from .ngram import KneserNey
from .tokenize import Vocab, sentences, tokens

__all__ = ["Budget", "BudgetExceeded", "CorpusError", "KneserNey", "Library", "Source", "Vocab", "sentences", "tokens"]
