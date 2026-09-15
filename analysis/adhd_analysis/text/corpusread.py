"""Reading a document library into tokens, under a ceiling.

One function, in its own module because the alternative is worse: it belongs to neither trainer, and
putting it in `corpora.py` would make the corpus loader depend on the tokenizer and the budget, which
it currently does not and has no other reason to.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator

from .budget import Budget
from .corpora import Library
from .tokenize import sentences, tokens

if TYPE_CHECKING:  # pragma: no cover - typing only
    from hashlib import _Hash


def sentence_tokens(
    library: Library, budget: Budget, digest: "_Hash | None" = None
) -> Iterator[list[str]]:
    """Every sentence of every document as a token list, spending tokens against `budget`.

    Lived in both trainers byte-identically. It is not a shape anyone has to guess at — it is how this
    repository reads a corpus, and both model classes read it the same way — so it sits here rather
    than in whichever trainer was written first.

    The budget is spent before the yield and checked after it, so a caller that stops consuming still
    gets charged for what it read, and the generator stops at the ceiling rather than one document
    past it.

    `digest`, if given, is updated with every token actually yielded, in order. Pass a fresh
    `hashlib.sha256()` and read it after the loop to get the identity of the text this read consumed.

    Over the *token stream* and not over document content, which is the stronger of the two and
    deliberately so. `HeldOut.fingerprint` hashes document content, and `comparable_heldout` carries a
    comment about the hole that leaves: a tokenizer change makes two perplexities incomparable while
    the content fingerprint agrees, and that happened — fixing the ASCII word class moved the shipped
    baseline from 25.65 to 25.82 on an unchanged fingerprint. A digest over tokens cannot miss it.

    It also stops exactly where the budget stopped, partway through a document, which is the property a
    per-document digest cannot have. Two models that both report reading 20,000,139 tokens read the
    same 20,000,139 tokens if and only if this matches.

    Where it *cannot* stop: inside a sentence. The budget is spent before the yield and checked after
    it, and `sentences()` splits on newlines rather than on sentence punctuation, so a document written
    as one long line is a single sentence that no ceiling can cut.
    """
    for _name, doc in library.documents():
        for s in sentences(doc):
            ts = tokens(s)
            if not ts:
                continue
            if digest is not None:
                # A separator, so that ["ab", "c"] and ["a", "bc"] are different reads. Without one
                # the digest would be blind to exactly the tokenizer change it exists to catch.
                digest.update("\x1f".join(ts).encode("utf-8"))
                digest.update(b"\x1e")
            budget.spend(len(ts))
            yield ts
            if not budget.allows():
                return
