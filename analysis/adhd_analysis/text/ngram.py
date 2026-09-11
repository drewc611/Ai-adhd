"""Interpolated modified Kneser-Ney, trained from scratch on whatever text it is given.

No pretrained weights, no download, no runtime beyond the standard library. That is not asceticism
— it is what keeps this on the analysis side of D9. A model whose parameters are entirely derived
from a corpus the repository can point at is a description of that corpus; a model whose
parameters arrived with it is an inference client that shipped its weights instead of a key.

Why n-gram and not a small transformer. A transformer trained from scratch needs somewhere north
of 10^8 tokens before its perplexity beats a well-smoothed 5-gram, and it needs a GPU to get
there. Modified Kneser-Ney is the strongest count-based model published, reaches useful perplexity
at 10^6-10^7 tokens, trains in one pass on a CPU, and its parameters are inspectable: a suspicious
score can be traced to the exact context that produced it. On a weekly CPU job over a document
library, it is not a compromise, it is the better model.

Chen & Goodman (1999). An empirical study of smoothing techniques for language modeling.
*Computer Speech & Language, 13*(4), 359-394. https://doi.org/10.1006/csla.1999.0128
"""

from __future__ import annotations

import gzip
import json
import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

from .budget import Budget, BudgetExceeded
from .modelfile import ModelFileRefused, body_lines, bounded_int, read_header
from .tokenize import BOS, EOS, UNK, Vocab

Gram = tuple[int, ...]


@dataclass
class HistoryStats:
    """Per-context denominators for the interpolation weight, precomputed once at seal time.

    gamma(h) = (D1*N1(h.) + D2*N2(h.) + D3*N3+(h.)) / c(h.)

    Recomputing N1/N2/N3+ per query would mean scanning every continuation of the context on every
    token scored, which turns an O(order) lookup into an O(vocabulary) one.
    """

    total: int
    n1: int
    n2: int
    n3p: int


@dataclass
class KneserNey:
    order: int
    vocab: Vocab
    #: `counts[k-1]` holds k-grams. The top order holds raw counts; every lower order holds
    #: continuation counts, which is the whole of what makes this Kneser-Ney rather than Katz.
    counts: list[dict[Gram, int]]
    hist: list[dict[Gram, HistoryStats]] = field(default_factory=list)
    discounts: list[tuple[float, float, float]] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    def seal(self) -> KneserNey:
        """Derive lower orders, estimate discounts, precompute history stats. Idempotent."""
        for k in range(self.order - 1, 0, -1):
            lower: dict[Gram, int] = {}
            for gram in self.counts[k]:
                suffix = gram[1:]
                lower[suffix] = lower.get(suffix, 0) + 1
            self.counts[k - 1] = lower

        self.discounts = [self._discounts(self.counts[k]) for k in range(self.order)]
        self.hist = []
        for k in range(self.order):
            acc: dict[Gram, list[int]] = {}
            for gram, c in self.counts[k].items():
                h = gram[:-1]
                row = acc.get(h)
                if row is None:
                    row = acc[h] = [0, 0, 0, 0]
                row[0] += c
                if c == 1:
                    row[1] += 1
                elif c == 2:
                    row[2] += 1
                else:
                    row[3] += 1
            self.hist.append({h: HistoryStats(t, a, b, c) for h, (t, a, b, c) in acc.items()})
        return self

    def _discounts(self, table: dict[Gram, int]) -> tuple[float, float, float]:
        """Chen & Goodman's three discounts, from the counts-of-counts n1..n4.

            Y = n1 / (n1 + 2*n2);  D1 = 1 - 2Y*n2/n1;  D2 = 2 - 3Y*n3/n2;  D3+ = 3 - 4Y*n4/n3

        A corpus small or skewed enough to make any denominator zero gets the fixed 0.75 fallback
        rather than a division error. That fallback is the *unmodified* Kneser-Ney discount, so the
        degenerate case degrades to the older model instead of to nonsense.
        """
        pruned = self.meta.get("counts_of_counts_at_prune")
        if pruned and table is self.counts[self.order - 1]:
            n = [int(x) for x in pruned]
        else:
            cc = Counter(table.values())
            n = [cc.get(i, 0) for i in range(1, 5)]
        n1, n2, n3, n4 = n[0], n[1], n[2], n[3]
        if n1 == 0 or n2 == 0:
            return (0.75, 0.75, 0.75)
        y = n1 / (n1 + 2 * n2)
        d1 = 1.0 - 2.0 * y * n2 / n1
        d2 = 2.0 - 3.0 * y * n3 / n2 if n3 else 0.75
        d3 = 3.0 - 4.0 * y * n4 / n3 if (n3 and n4) else 0.75
        return (max(d1, 0.0), max(d2, 0.0), max(d3, 0.0))

    def _discount_for(self, k: int, c: int) -> float:
        d1, d2, d3 = self.discounts[k]
        return d1 if c == 1 else d2 if c == 2 else d3

    def prob(self, context: Gram, word: int) -> float:
        k = min(len(context), self.order - 1)
        return self._prob(context[len(context) - k :] if k else (), word, k)

    def _prob(self, h: Gram, w: int, k: int) -> float:
        if k == 0:
            table = self.counts[0]
            total = self.hist[0].get((), HistoryStats(0, 0, 0, 0))
            uniform = 1.0 / max(len(self.vocab), 1)
            if total.total == 0:
                return uniform
            c = table.get((w,), 0)
            d1, d2, d3 = self.discounts[0]
            disc = self._discount_for(0, c) if c else 0.0
            gamma = (d1 * total.n1 + d2 * total.n2 + d3 * total.n3p) / total.total
            return max(c - disc, 0.0) / total.total + gamma * uniform

        stats = self.hist[k].get(h)
        backoff = self._prob(h[1:], w, k - 1)
        if stats is None or stats.total == 0:
            # Unseen context: all the mass is the backoff's. Not a smoothing choice, a definition
            # — gamma(h) is 1 when c(h.) is 0, and the leading term is 0/0.
            return backoff
        c = self.counts[k].get(h + (w,), 0)
        d1, d2, d3 = self.discounts[k]
        gamma = (d1 * stats.n1 + d2 * stats.n2 + d3 * stats.n3p) / stats.total
        disc = self._discount_for(k, c) if c else 0.0
        return max(c - disc, 0.0) / stats.total + gamma * backoff

    def logprob_terms(self, ids: Iterable[int]) -> list[tuple[float, bool]]:
        """Per-position natural-log probability, and whether that position's target is a real word.

        One loop rather than two conventions. `logprob` sums all of it; a caller asking how the model
        does on words it *knows* sums only the positions whose second element is true. Contexts are
        untouched either way, so an `<unk>` in a history still conditions the next prediction — the
        question being separated is which targets count, not what the model was allowed to read.

        `<unk>` is the marker. `Vocab.encode` maps every out-of-vocabulary token to it and it never
        occurs as a real token in a corpus, so an id equal to it is exactly an OOV position.
        """
        bos, eos, unk = self.vocab.stoi[BOS], self.vocab.stoi[EOS], self.vocab.stoi[UNK]
        seq = [bos] * (self.order - 1) + list(ids) + [eos]
        out: list[tuple[float, bool]] = []
        for i in range(self.order - 1, len(seq)):
            p = self.prob(tuple(seq[i - self.order + 1 : i]), seq[i])
            out.append((math.log(p) if p > 0 else -50.0, seq[i] != unk))
        return out

    def logprob(self, ids: Iterable[int]) -> tuple[float, int]:
        """Natural-log probability of a token sequence and the number of predictions made.

        The sequence is padded with `order-1` BOS and one EOS, so a one-word artifact and a
        thousand-word one are scored under the same convention and their perplexities compare.
        """
        terms = self.logprob_terms(ids)
        return sum(lp for lp, _ in terms), len(terms)

    def perplexity(self, ids: Iterable[int]) -> float:
        lp, n = self.logprob(ids)
        return math.exp(-lp / n) if n else float("inf")

    def surprisal(self, ids: list[int]) -> list[float]:
        """Per-token surprisal in bits. What makes the model useful rather than a scalar.

        A branch artifact's mean surprisal says how generic it reads; the per-token vector says
        *which* clauses were the predictable ones, which is the form a T1 finding has to take to
        be actionable.
        """
        bos = self.vocab.stoi[BOS]
        seq = [bos] * (self.order - 1) + ids
        out = []
        for i in range(self.order - 1, len(seq)):
            p = self.prob(tuple(seq[i - self.order + 1 : i]), seq[i])
            out.append(-math.log2(p) if p > 0 else 50.0)
        return out

    def save(self, path: str | Path) -> Path:
        """Gzipped TSV: a metadata line, a vocabulary line, then one line per n-gram.

        Not pickle. A checked-out model file gets loaded by CI on a schedule, and pickle turns a
        tampered artifact into arbitrary code execution in that job. Text also means `zcat | head`
        answers "what did last week's run actually learn", which pickle does not.
        """
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps({"format": "adhd-kn-1", "order": self.order, "meta": self.meta}) + "\n")
            fh.write(json.dumps({"itos": self.vocab.itos, "min_count": self.vocab.min_count}) + "\n")
            for k in range(self.order):
                for gram, c in sorted(self.counts[k].items()):
                    fh.write(f"{k}\t{','.join(map(str, gram))}\t{c}\n")
        return path

    @classmethod
    def load(cls, path: str | Path, budget: "Budget | None" = None) -> KneserNey:
        """Read a model back. Optionally under a ceiling, and there is a reason to pass one.

        `Budget` governs reading a corpus and counting n-grams, and until this argument existed it
        governed nothing about loading the result. A model trained under a 9.5GB ceiling could then
        be loaded into a process that went well past it, because the table is rebuilt in memory and
        nothing was watching. Observed at 11.9GB against a 9.5GB ceiling while comparing orders.

        Checked per batch of lines rather than per line: the check reads the resident set through a
        syscall, and at one call per n-gram it costs more than the load.
        """
        path = Path(path)
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            head = read_header(fh, path, "header")
            if head.get("format") != "adhd-kn-1":
                raise ModelFileRefused(f"{path} is not an adhd-kn-1 model")
            # Before the list it sizes. A 120-byte file declaring `order: 50000000` built a
            # fifty-million-entry list in 111 seconds, and the order came straight out of the file.
            # Twelve is four times the highest order this repository has ever trained, and E5
            # established that five does not fit on this machine at any `min_count`.
            order = bounded_int(head.get("order"), "order", 2, 12, path)
            vocab_line = read_header(fh, path, "vocabulary")
            itos = vocab_line.get("itos")
            if not isinstance(itos, list) or not all(isinstance(w, str) for w in itos):
                raise ModelFileRefused(f"{path}: the vocabulary line is not a list of strings")
            vocab = Vocab(
                stoi={w: i for i, w in enumerate(itos)},
                itos=itos,
                counts=[0] * len(itos),
                min_count=bounded_int(vocab_line.get("min_count", 2), "min_count", 1, 10**6, path),
                dropped_types=0,
                dropped_tokens=0,
            )
            counts: list[dict[Gram, int]] = [{} for _ in range(order)]
            loaded = 0
            for line in body_lines(fh, path):
                parts = line.rstrip("\n").split("\t")
                if len(parts) != 3:
                    raise ModelFileRefused(f"{path}: an n-gram line has {len(parts)} fields, expected 3")
                k, gram, c = parts
                # Range-checked, not just parsed. Python indexes lists from the end on a negative, so
                # a line whose order field reads `-1` used to write silently into the *top* order
                # table — a count the format cannot address, landing where the model is read from.
                try:
                    ki = bounded_int(int(k), "an n-gram order", 0, order - 1, path)
                    ids = tuple(int(x) for x in gram.split(","))
                    count = int(c)
                except ValueError as e:
                    raise ModelFileRefused(f"{path}: unreadable n-gram line ({e})") from e
                if len(ids) != ki + 1:
                    raise ModelFileRefused(f"{path}: a {len(ids)}-gram is filed under order {ki}")
                if any(i < 0 or i >= len(itos) for i in ids):
                    raise ModelFileRefused(f"{path}: an n-gram names a token id outside the vocabulary")
                if count < 1:
                    raise ModelFileRefused(f"{path}: an n-gram has a count of {count}")
                counts[ki][ids] = count
                loaded += 1
                if budget is not None and loaded % 200_000 == 0:
                    budget.touch()
                    if not budget.allows():
                        raise BudgetExceeded(f"loading {path} refused after {loaded:,} n-grams: {budget.stopped_because}")
        m = cls(order=order, vocab=vocab, counts=counts, meta=head.get("meta", {}))
        m.discounts = [m._discounts(m.counts[k]) for k in range(order)]
        m.hist = []
        for k in range(order):
            acc: dict[Gram, list[int]] = {}
            for gram, c in m.counts[k].items():
                h = gram[:-1]
                row = acc.get(h)
                if row is None:
                    row = acc[h] = [0, 0, 0, 0]
                row[0] += c
                row[1 if c == 1 else 2 if c == 2 else 3] += 1
            m.hist.append({h: HistoryStats(t, a, b, cc) for h, (t, a, b, cc) in acc.items()})
        return m


def count_ngrams(
    id_sequences: Iterator[list[int]],
    order: int,
    budget: Budget,
    vocab: Vocab,
) -> tuple[dict[Gram, int], dict]:
    """Top-order counts, stopping when the budget says so.

    Pruning under memory pressure drops the count-1 grams, which is the standard move and is also
    the one that destroys the n1 the discount estimator needs. So the counts-of-counts histogram is
    snapshotted at the first prune, before anything is deleted, and `_discounts` prefers it.
    """
    bos, eos = vocab.stoi[BOS], vocab.stoi[EOS]
    # `id_sequences` is responsible for spending tokens against the budget. Spending here as well
    # would charge every token twice and stop the counting pass at half the corpus the vocabulary
    # pass read, leaving n-grams over words the vocabulary was never built from.
    table: dict[Gram, int] = {}
    prunes = 0
    snapshot: list[int] | None = None
    for ids in id_sequences:
        if not ids:
            continue
        seq = [bos] * (order - 1) + ids + [eos]
        for i in range(order - 1, len(seq)):
            g = tuple(seq[i - order + 1 : i + 1])
            table[g] = table.get(g, 0) + 1
        if not budget.allows(len(table)):
            if prunes < 3:
                cc = Counter(table.values())
                if snapshot is None:
                    snapshot = [cc.get(i, 0) for i in range(1, 5)]
                singletons = [g for g, c in table.items() if c == 1]
                if singletons and budget.relieve():
                    for g in singletons:
                        del table[g]
                    prunes += 1
                    continue
            break
    meta = {"prunes": prunes}
    if snapshot is not None:
        meta["counts_of_counts_at_prune"] = snapshot
    return table, meta
