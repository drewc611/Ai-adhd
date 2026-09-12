"""An LSTM language model, written from scratch over numpy.

The third model class, and the one whose gradient is genuinely hard. A transformer's backward pass is
a stack of matrix multiplies and one softmax; an LSTM's is four gates whose errors flow both down into
the input and backwards through time, and every one of those paths is a place to drop a term. The loss
still falls if you do. `tests/test_lstm.py` gradient-checks every parameter against central
differences before anything here is trusted, for the reason `transformer.py` gives at length: a
hand-derived gradient that is subtly wrong trains to a plausible loss and produces a model whose
perplexity is a number about nothing.

Inside D2 with nothing amended, like the transformer: no pretrained weights, no download, no key, no
runtime beyond the numpy this package already depends on. It duck-types `KneserNey` where the scoring
machinery touches it — `vocab`, `meta`, `logprob_terms` — so `evaluate`, `FrozenSplit`,
`in_sample_refusal`, `HeldOut.truncated` and `comparable_heldout` apply with no special case.

**One thing it gets that the transformer did not, stated because it matters for reading E7.** An LSTM
carries a hidden state, so at scoring time its context is the whole document rather than a window. The
transformer was scored over windows of 128 tokens with at least 64 tokens of left context. That is not
a harness asymmetry of the kind D21 had to correct — it is the architectural difference between the
two, and equalising it would mean measuring the transformer's limitation instead of the LSTM's
ability. It does mean the comparison flatters the LSTM against a windowed evaluation, and E7 says so.
"""

from __future__ import annotations

import gzip
import json
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

import numpy as np

from .budget import Budget
from .modelfile import ModelFileRefused, body_lines, bounded_int, read_header, read_vocabulary
from .tokenize import BOS, EOS, UNK, Vocab

#: What `load` allows itself when no `Budget` says otherwise. Same reasoning as the transformer's.
_DEFAULT_LOAD_CEILING_MB = 8192

DTYPE = np.float32


@dataclass
class LSTMConfig:
    """Shape of the model.

    `vocab_size` dominates the parameter count exactly as it does for the transformer, and for the same
    reason: the output projection is `d_hidden x vocab_size` and every token's loss touches all of it.
    """

    vocab_size: int = 8192
    d_model: int = 128
    n_layers: int = 2
    #: Truncated-BPTT length. Not a ceiling on what the model can remember at scoring time — the state
    #: carries across windows there — but a ceiling on how far a gradient travels back in training.
    context: int = 128
    init_std: float = 0.05

    LIMITS = {
        "vocab_size": (2, 10_000_000),
        "d_model": (1, 8_192),
        "n_layers": (1, 64),
        "context": (2, 100_000),
    }

    def __post_init__(self) -> None:
        for name, (low, high) in self.LIMITS.items():
            v = getattr(self, name)
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError(f"{name} is {v!r}, expected an integer")
            if not low <= v <= high:
                raise ValueError(f"{name} is {v:,}, outside the supported range {low} to {high:,}")
        if not isinstance(self.init_std, (int, float)) or not 0 < float(self.init_std) <= 1.0:
            raise ValueError(f"init_std is {self.init_std!r}, expected a positive number no greater than 1")

    def parameter_count(self) -> int:
        per_layer = 4 * self.d_model * self.d_model * 2 + 4 * self.d_model
        return self.vocab_size * self.d_model + self.n_layers * per_layer


def _sigmoid(x: np.ndarray) -> np.ndarray:
    # The stable form. `1/(1+exp(-x))` overflows to inf for x very negative and returns a warning plus
    # a zero that happens to be right; `tanh` is implemented stably and this identity is exact.
    return 0.5 * (np.tanh(0.5 * x) + 1.0)


class LSTM:
    """The model. `params` is a flat dict so the optimiser and the gradient check share one view."""

    def __init__(self, config: LSTMConfig, vocab: Vocab, meta: dict | None = None, seed: int = 0) -> None:
        if len(vocab) > config.vocab_size:
            raise ValueError(
                f"vocabulary of {len(vocab)} exceeds vocab_size {config.vocab_size}; "
                "build it with max_size=config.vocab_size"
            )
        self.config = config
        self.vocab = vocab
        self.meta = meta or {}
        rng = np.random.default_rng(seed)
        c = config
        d = c.d_model

        def normal(*shape: int) -> np.ndarray:
            return (rng.standard_normal(shape) * c.init_std).astype(DTYPE)

        self.params: dict[str, np.ndarray] = {"tok": normal(c.vocab_size, d)}
        for i in range(c.n_layers):
            self.params[f"l{i}.wx"] = normal(d, 4 * d)
            self.params[f"l{i}.wh"] = normal(d, 4 * d)
            b = np.zeros(4 * d, dtype=DTYPE)
            # The forget gate starts open. A zero bias makes `sigmoid(0) = 0.5`, which halves the cell
            # state every step and costs the model the first few hundred updates learning to stop doing
            # that. One is the standard remedy and it is a real difference at this training budget.
            b[d : 2 * d] = 1.0
            self.params[f"l{i}.b"] = b

    # ---- forward ---------------------------------------------------------------------------------

    def forward(self, idx: np.ndarray, state: list[tuple[np.ndarray, np.ndarray]] | None = None):
        """Logits for a batch of id sequences, plus the cache the backward pass needs.

        `idx` is (batch, time). `state` carries `(h, c)` per layer from a previous call, which is how
        scoring gets a context longer than `context`. Returns logits (batch, time, vocab), the cache,
        and the final state.
        """
        c = self.config
        p = self.params
        B, T = idx.shape
        d = c.d_model
        if state is None:
            state = [(np.zeros((B, d), dtype=DTYPE), np.zeros((B, d), dtype=DTYPE)) for _ in range(c.n_layers)]

        x = p["tok"][idx]  # (B, T, d)
        cache: dict = {"idx": idx, "B": B, "T": T, "layers": []}
        for i in range(c.n_layers):
            wx, wh = p[f"l{i}.wx"], p[f"l{i}.wh"]
            b = p[f"l{i}.b"]
            h_prev, c_prev = state[i]
            hs = np.empty((B, T, d), dtype=DTYPE)
            gates = np.empty((B, T, 4 * d), dtype=DTYPE)
            cells = np.empty((B, T, d), dtype=DTYPE)
            tanh_c = np.empty((B, T, d), dtype=DTYPE)
            h_in = np.empty((B, T, d), dtype=DTYPE)  # h_{t-1} per step, kept for the backward matmul
            # The input side is time-independent, so it is one (B*T, d) @ (d, 4d) rather than T small
            # ones. The recurrent side cannot be: h_{t-1} does not exist until step t-1 is done.
            xz = (x.reshape(-1, d) @ wx).reshape(B, T, 4 * d) + b
            for t in range(T):
                h_in[:, t] = h_prev
                z = xz[:, t] + h_prev @ wh
                gi = _sigmoid(z[:, :d])
                gf = _sigmoid(z[:, d : 2 * d])
                gg = np.tanh(z[:, 2 * d : 3 * d])
                go = _sigmoid(z[:, 3 * d :])
                c_prev = gf * c_prev + gi * gg
                tc = np.tanh(c_prev)
                h_prev = go * tc
                gates[:, t] = np.concatenate([gi, gf, gg, go], axis=-1)
                cells[:, t] = c_prev
                tanh_c[:, t] = tc
                hs[:, t] = h_prev
            cache["layers"].append({"x_in": x, "h_in": h_in, "gates": gates, "cells": cells, "tanh_c": tanh_c})
            state[i] = (h_prev, c_prev)
            x = hs
        cache["top"] = x
        logits = x.reshape(-1, d) @ p["tok"].T
        return logits.reshape(B, T, c.vocab_size), cache, state

    # ---- loss and gradients ----------------------------------------------------------------------

    def loss_and_grads(self, idx: np.ndarray, targets: np.ndarray) -> tuple[float, dict[str, np.ndarray]]:
        """Mean cross-entropy over every position, and the gradient of it for every parameter.

        Backpropagation through time, written out. The cell state's gradient arrives from two places at
        every step — the hidden output at `t` and the cell at `t+1` — and dropping the second is the
        classic way to get an LSTM that trains and cannot remember anything.
        """
        c = self.config
        p = self.params
        d = c.d_model
        logits, cache, _ = self.forward(idx)
        B, T = idx.shape
        n = B * T

        flat = logits.reshape(n, c.vocab_size)
        flat -= flat.max(axis=-1, keepdims=True)
        np.exp(flat, out=flat)
        flat /= flat.sum(axis=-1, keepdims=True)
        tgt = targets.reshape(n)
        rows = np.arange(n)
        loss = float(-np.log(np.maximum(flat[rows, tgt], 1e-12)).mean())
        flat[rows, tgt] -= 1.0
        flat /= n

        grads = {k: np.zeros_like(v) for k, v in p.items()}
        top = cache["top"]
        grads["tok"] += flat.T @ top.reshape(-1, d)
        dx = (flat @ p["tok"]).reshape(B, T, d)

        for i in reversed(range(c.n_layers)):
            lc = cache["layers"][i]
            wx, wh = p[f"l{i}.wx"], p[f"l{i}.wh"]
            gates, cells, tanh_c, h_in = lc["gates"], lc["cells"], lc["tanh_c"], lc["h_in"]
            dz_all = np.empty((B, T, 4 * d), dtype=DTYPE)
            dh_next = np.zeros((B, d), dtype=DTYPE)
            dc_next = np.zeros((B, d), dtype=DTYPE)
            for t in reversed(range(T)):
                gi = gates[:, t, :d]
                gf = gates[:, t, d : 2 * d]
                gg = gates[:, t, 2 * d : 3 * d]
                go = gates[:, t, 3 * d :]
                tc = tanh_c[:, t]
                dh = dx[:, t] + dh_next
                dgo = dh * tc
                # Both contributions to the cell: through this step's output, and from step t+1.
                dc = dh * go * (1.0 - tc * tc) + dc_next
                c_before = cells[:, t - 1] if t > 0 else np.zeros((B, d), dtype=DTYPE)
                dgf = dc * c_before
                dgi = dc * gg
                dgg = dc * gi
                dc_next = dc * gf
                dz = np.concatenate(
                    [dgi * gi * (1.0 - gi), dgf * gf * (1.0 - gf), dgg * (1.0 - gg * gg), dgo * go * (1.0 - go)],
                    axis=-1,
                )
                dz_all[:, t] = dz
                dh_next = dz @ wh.T
            flat_dz = dz_all.reshape(-1, 4 * d)
            grads[f"l{i}.wx"] += lc["x_in"].reshape(-1, d).T @ flat_dz
            grads[f"l{i}.wh"] += h_in.reshape(-1, d).T @ flat_dz
            grads[f"l{i}.b"] += flat_dz.sum(axis=0)
            dx = (flat_dz @ wx.T).reshape(B, T, d)

        np.add.at(grads["tok"], cache["idx"].reshape(-1), dx.reshape(-1, d))
        return loss, grads

    # ---- scoring, duck-typed against KneserNey ---------------------------------------------------

    def logprob_terms(self, ids: Iterable[int]) -> list[tuple[float, bool]]:
        """Per-position natural log probability and whether the target is a real word.

        State carries across windows, so every position after the first is predicted from the whole
        document so far rather than from a window. That is the architecture's property and not a
        harness choice — see the module docstring, and E7 for what it means for the comparison.
        """
        c = self.config
        unk = self.vocab.stoi[UNK]
        seq = [self.vocab.stoi[BOS]] + list(ids) + [self.vocab.stoi[EOS]]
        out: list[tuple[float, bool]] = []
        state = None
        for start in range(0, len(seq) - 1, c.context):
            window = seq[start : start + c.context + 1]
            if len(window) < 2:
                break
            logits, _, state = self.forward(np.array([window[:-1]], dtype=np.int64), state)
            lp = logits[0] - logits[0].max(axis=-1, keepdims=True)
            lp -= np.log(np.exp(lp).sum(axis=-1, keepdims=True))
            for t, target in enumerate(window[1:]):
                out.append((float(lp[t, target]), target != unk))
        return out

    def logprob(self, ids: Iterable[int]) -> tuple[float, int]:
        terms = self.logprob_terms(ids)
        return sum(lp for lp, _ in terms), len(terms)

    def perplexity(self, ids: Iterable[int]) -> float:
        lp, n = self.logprob(ids)
        return math.exp(-lp / n) if n else float("inf")

    # ---- persistence -----------------------------------------------------------------------------

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps({"format": "adhd-lstm-1", "config": asdict(self.config), "meta": self.meta}) + "\n")
            fh.write(json.dumps({"itos": self.vocab.itos, "min_count": self.vocab.min_count}) + "\n")
            for name, arr in sorted(self.params.items()):
                fh.write(f"{name}\t{','.join(str(x) for x in arr.shape)}\t")
                fh.write(",".join(f"{v:.6g}" for v in arr.ravel()))
                fh.write("\n")
        return path

    @classmethod
    def load(cls, path: str | Path, budget: Budget | None = None) -> LSTM:
        """Read a model back, refusing one that asks for more memory than it may have.

        Same order as `Transformer.load`, for the reason D22 records: every dimension in the file is a
        number the file chose, `__init__` allocates from them, and a budget consulted after the
        allocation is a ceiling that observes the crash.
        """
        path = Path(path)
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            head = read_header(fh, path, "header")
            if head.get("format") != "adhd-lstm-1":
                raise ModelFileRefused(f"{path} is not an adhd-lstm-1 model")
            raw = head.get("config")
            if not isinstance(raw, dict):
                raise ModelFileRefused(f"{path}: the header carries no config object")
            try:
                config = LSTMConfig(**raw)
            except (TypeError, ValueError) as e:
                raise ModelFileRefused(f"{path}: unusable config ({e})") from e

            ceiling_mb = budget.max_rss_mb if budget is not None else _DEFAULT_LOAD_CEILING_MB
            wants_mb = config.parameter_count() * 4 // (1024 * 1024)
            if wants_mb > ceiling_mb:
                raise ModelFileRefused(
                    f"{path}: its parameters need {wants_mb:,}MB against a ceiling of {ceiling_mb:,}MB"
                )

            vocab = read_vocabulary(fh, path, max_types=config.vocab_size)
            meta = head.get("meta", {})
            m = cls(config, vocab, meta if isinstance(meta, dict) else {})
            seen: set[str] = set()
            for line in body_lines(fh, path):
                parts = line.rstrip("\n").split("\t")
                if len(parts) != 3:
                    raise ModelFileRefused(f"{path}: a parameter line has {len(parts)} fields, expected 3")
                name, shape, values = parts
                if name not in m.params:
                    raise ModelFileRefused(f"{path}: unknown parameter {name!r} for this architecture")
                if name in seen:
                    raise ModelFileRefused(f"{path}: parameter {name!r} appears twice")
                seen.add(name)
                dims = tuple(bounded_int(int(x), "a dimension", 1, 10**9, path) for x in shape.split(","))
                if dims != m.params[name].shape:
                    raise ModelFileRefused(
                        f"{path}: {name} is {dims}, but this architecture needs {m.params[name].shape}"
                    )
                m.params[name] = np.fromstring(values, sep=",", dtype=DTYPE).reshape(dims)
                if budget is not None:
                    budget.touch()
                    if not budget.allows():
                        raise RuntimeError(f"loading {path} refused: {budget.stopped_because}")
            missing = set(m.params) - seen
            if missing:
                raise ModelFileRefused(f"{path}: {len(missing)} parameters missing, including {sorted(missing)[0]!r}")
        return m
