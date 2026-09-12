"""Word tokenisation and a vocabulary with a closed `<unk>`.

Deliberately not subword. A byte-pair vocabulary would give better perplexity and would make the
resulting numbers unreadable: the whole use for this model is to say which *words* in a branch
artifact are predictable from a background corpus, and a model whose units are `##ability` cannot
answer that without a detokenisation step that reintroduces the ambiguity it removed.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Iterator

BOS = "<s>"
EOS = "</s>"
UNK = "<unk>"


def _mark_ranges() -> list[tuple[int, int]]:
    """Contiguous runs of Unicode combining marks (categories Mn, Mc, Me), from this Python's tables.

    Read rather than pasted. A hardcoded table is a table that is right for one Unicode version and
    silently wrong for the next, and the failure it produces — a word in one script splitting into
    pieces — is exactly the one this exists to stop.
    """
    marks = [c for c in range(0x110000) if unicodedata.category(chr(c)) in ("Mn", "Mc", "Me")]
    out: list[tuple[int, int]] = []
    start = prev = marks[0]
    for c in marks[1:]:
        if c == prev + 1:
            prev = c
            continue
        out.append((start, prev))
        start = prev = c
    out.append((start, prev))
    return out

# Words, contractions, decimals and standalone punctuation, in that precedence. Markdown fences,
# URLs and code identifiers all fall through to the word branch rather than being special-cased:
# a corpus of technical documents is mostly those, and stripping them would model a language
# nobody writes.
# `[^\W\d_]` is "a word character that is neither a digit nor an underscore", which in Python 3 is
# Unicode-aware and therefore means *letter* in any script. The previous pattern used `[A-Za-z]`, and
# ASCII-only word classes do not fail loudly on other alphabets — they truncate. Measured on this
# corpus: 234 of 1,175 sampled files hold non-ASCII characters, and `Löwis` was being learned as `l`
# and `wis`, `André` as `andr`, `Viagénie` as `viag` and `nie`. Author lines and references are where
# a technical corpus keeps its accents, so a fifth of the files were feeding the model broken words.
#
# `\w` is not enough on its own, which is the same mistake one level deeper. It matches **none** of
# Unicode's 2,408 combining marks, and every script that writes its vowels as marks therefore
# shatters rather than truncates: `समीक्षक` came out as `सम`, `ी`, `क`, `्`, `षक` — one Hindi word as
# five tokens, seven words as twenty-eight. Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam,
# Thai, Lao, Khmer, and any Arabic or Hebrew carrying diacritics were all affected. Shattering is
# worse than truncating: a truncated word is at least a consistent wrong token, while a shattered one
# contributes nothing but noise to every n-gram it touches.
#
# `re` has no `\p{M}`, and the `regex` package would be a fourth Python dependency where
# `docs/MANIFEST.md` says three is a decision. So the class is computed from `unicodedata` at import.
# It costs about 90ms once per process, which is under half of `import numpy` and invisible against a
# training run.
_MARKS = "".join(
    f"\\U{lo:08x}-\\U{hi:08x}" if lo != hi else f"\\U{lo:08x}"
    for lo, hi in _mark_ranges()
)

# Still not multilingual, and the gap is now one specific thing rather than several. Scripts written
# without spaces — Chinese, Japanese, Thai, Khmer, Lao — match a whole run as one token, because
# there is no space to break on and word segmentation for them is a model, not a regex. Thai moved
# between two wrong answers rather than to a right one: 15 shattered fragments before, one merged
# 30-character token now. Backlog 80 records what closing this would take.
_TOKEN = re.compile(
    rf"""
    [^\W\d_][\w{_MARKS}]*(?:'[^\W\d_]+)?   # words, snake_case, don't, Löwis, André, समीक्षक
  | \d+(?:[.,]\d+)*%?                       # 3.14  1,000  99%
  | [^\s\w{_MARKS}]                          # one punctuation mark
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
