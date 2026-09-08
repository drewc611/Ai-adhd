"""Word tokenisation and a vocabulary with a closed `<unk>`.

Deliberately not subword. A byte-pair vocabulary would give better perplexity and would make the
resulting numbers unreadable: the whole use for this model is to say which *words* in a branch
artifact are predictable from a background corpus, and a model whose units are `##ability` cannot
answer that without a detokenisation step that reintroduces the ambiguity it removed.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Iterator

BOS = "<s>"
EOS = "</s>"
UNK = "<unk>"

# Words, contractions, decimals and standalone punctuation, in that precedence. Markdown fences,
# URLs and code identifiers all fall through to the word branch rather than being special-cased:
# a corpus of technical documents is mostly those, and stripping them would model a language
# nobody writes.
_TOKEN = re.compile(
    r"""
    [A-Za-z][A-Za-z0-9_]*(?:'[A-Za-z]+)?   # words, snake_case, don't
  | \d+(?:[.,]\d+)*%?                       # 3.14  1,000  99%
  | [^\sA-Za-z0-9]                          # one punctuation mark
    """,
    re.VERBOSE,
)

_SENTENCE = re.compile(r"(?<=[.!?])[\s\"')\]]+(?=[A-Z(\[\"'])|\n{2,}")


def tokens(text: str, *, fold: bool = True) -> list[str]:
    out = _TOKEN.findall(text)
    return [t.lower() for t in out] if fold else out


def sentences(text: str) -> Iterator[str]:
    """Split on terminal punctuation followed by a capital, or on a blank line.

    Markdown makes the blank-line rule do most of the work, and that is fine: a heading and its
    paragraph are separate contexts, and joining them would let a heading's words predict the
    paragraph's across a boundary no writer intended.
    """
    for part in _SENTENCE.split(text):
        if part and part.strip():
            yield part.strip()


@dataclass
class Vocab:
    """Ids are assigned by descending frequency, so the common path stays in cache.

    `min_count` is the only lever. Below 2 the tail of a technical corpus is hapax identifiers and
    the vocabulary grows without bound; above 5 the words a branch artifact is actually judged on
    start falling into `<unk>`, which reads as high predictability and inverts the finding.
    """

    stoi: dict[str, int]
    itos: list[str]
    counts: list[int]
    min_count: int
    #: Every type and token the vocabulary does not contain, for whatever reason. This is the
    #: numerator of the OOV rate.
    dropped_types: int
    dropped_tokens: int
    #: The subset of the above that met `min_count` and was cut by `max_size` anyway — a subset, not
    #: a disjoint count. Reported separately because the two have different remedies and only one of
    #: them is a modelling decision: a word dropped for appearing once is a choice, and a word
    #: dropped because the ceiling filled up is a ceiling that bound without saying so. That is the
    #: shape of every silent-truncation bug this repository has already had.
    truncated_types: int = 0
    truncated_tokens: int = 0

    def __len__(self) -> int:
        return len(self.itos)

    def encode(self, ts: Iterable[str]) -> list[int]:
        unk = self.stoi[UNK]
        get = self.stoi.get
        return [get(t, unk) for t in ts]

    def unk_rate(self, ts: Iterable[str]) -> float:
        seq = list(ts)
        if not seq:
            return 0.0
        return sum(1 for t in seq if t not in self.stoi) / len(seq)

    @classmethod
    def build(cls, counter: Counter[str], min_count: int = 2, max_size: int | None = None) -> Vocab:
        specials = [UNK, BOS, EOS]
        frequent = [(w, c) for w, c in counter.most_common() if c >= min_count and w not in specials]
        kept = frequent if max_size is None else frequent[: max(0, max_size - len(specials))]
        truncated = frequent[len(kept):]
        keep = {w for w, _ in kept}
        itos = specials + [w for w, _ in kept]
        counts = [0, 0, 0] + [c for _, c in kept]
        return cls(
            stoi={w: i for i, w in enumerate(itos)},
            itos=itos,
            counts=counts,
            min_count=min_count,
            dropped_types=sum(1 for w in counter if w not in keep and w not in specials),
            dropped_tokens=sum(c for w, c in counter.items() if w not in keep and w not in specials),
            truncated_types=len(truncated),
            truncated_tokens=sum(c for _, c in truncated),
        )
