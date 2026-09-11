"""A decoder-only transformer language model, written from scratch over numpy.

Why this exists, and what it is not. `ngram.py` records a prediction: a transformer trained from
scratch "needs somewhere north of 10^8 tokens before its perplexity beats a well-smoothed 5-gram, and
it needs a GPU to get there." That was an assertion with no measurement behind it, sitting in a
repository whose whole practice is to measure rather than assert. This module makes it falsifiable.

It stays inside D2 without amending anything. No pretrained weights, no download, no key, no runtime
beyond numpy — which is already a dependency of this package. Every parameter is derived from a corpus
the repository can point at, which is the property D9 actually cares about; the model class is not.
`test/boundary.test.ts` bans `torch`, `tensorflow` and `transformers` because a weights file is an
inference client with a different delivery mechanism, and nothing here imports any of them.

It duck-types `KneserNey` where the scoring machinery touches it — `vocab`, `meta`, `logprob_terms` —
so `evaluate`, `FrozenSplit`, `in_sample_refusal`, `HeldOut.truncated` and `comparable_heldout` all
apply unchanged. A new model class that could not be measured by the existing instruments would be a
new model class nobody could compare to anything.

Pre-norm blocks, learned positional embeddings, tied input and output projections. The backward pass
is written out by hand and `tests/test_transformer.py` gradient-checks it against central differences,
because a hand-derived gradient that is subtly wrong trains to a plausible loss and produces a model
whose perplexity means nothing.
"""

from __future__ import annotations

import gzip
import json
import math
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

import numpy as np

from .budget import Budget
from .tokenize import BOS, EOS, UNK, Vocab

#: float32 throughout. float64 doubles the memory and the bandwidth for no accuracy that matters to a
#: perplexity, and this model is bandwidth-bound on a CPU.
DTYPE = np.float32


@dataclass
class TransformerConfig:
    """Shape of the model. Small on purpose: see `docs/DECISIONS.md` for the measured arithmetic.

    `vocab_size` is the cap, and it is the parameter that most decides whether this is trainable at
    all. The n-gram model carries 148,353 types happily because a dict lookup does not care how big
    the dict is. A softmax does: the output projection is `d_model x vocab_size`, and every token's
    loss touches all of it. At the n-gram model's vocabulary this layer alone would be 19M parameters
    and dominate everything else.
    """

    vocab_size: int = 8192
    d_model: int = 128
    n_heads: int = 4
    n_layers: int = 2
    context: int = 64
    d_ff: int = 512
    #: Standard deviation of the initial weights. 0.02 is the usual choice and it matters here:
    #: pre-norm blocks tolerate it, post-norm would not.
    init_std: float = 0.02

    def __post_init__(self) -> None:
        if self.d_model % self.n_heads:
            raise ValueError(f"d_model {self.d_model} is not divisible by n_heads {self.n_heads}")
        if self.context < 2:
            raise ValueError("a context of one token predicts nothing from anything")

    @property
    def d_head(self) -> int:
        return self.d_model // self.n_heads

    def parameter_count(self) -> int:
        per_block = 4 * self.d_model * self.d_model + 2 * self.d_model * self.d_ff
        return (
            self.vocab_size * self.d_model  # token embedding, tied with the output projection
            + self.context * self.d_model  # positions
            + self.n_layers * per_block
            + 2 * self.n_layers * 2 * self.d_model  # two layer norms per block
            + 2 * self.d_model  # the final layer norm
        )


def _layer_norm(x: np.ndarray, gamma: np.ndarray, beta: np.ndarray, eps: float = 1e-5):
    mu = x.mean(axis=-1, keepdims=True)
    xc = x - mu
    var = (xc * xc).mean(axis=-1, keepdims=True)
    inv = 1.0 / np.sqrt(var + eps)
    xhat = xc * inv
    return xhat * gamma + beta, (xhat, inv, gamma)


def _layer_norm_backward(dout: np.ndarray, cache):
    xhat, inv, gamma = cache
    d = xhat.shape[-1]
    dgamma = (dout * xhat).reshape(-1, d).sum(axis=0)
    dbeta = dout.reshape(-1, d).sum(axis=0)
    dxhat = dout * gamma
    dx = inv / d * (d * dxhat - dxhat.sum(axis=-1, keepdims=True) - xhat * (dxhat * xhat).sum(axis=-1, keepdims=True))
    return dx, dgamma, dbeta


_GELU_C = 0.7978845608028654  # sqrt(2/pi)


def _gelu(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The tanh approximation, returning the tanh alongside the output.

    Cheaper than erf on numpy and indistinguishable at this scale. The tanh comes back because the
    backward pass needs exactly it, and recomputing it there cost 76ms of a 463ms step — the second
    largest line in the profile after the einsum, for a value the forward pass had already produced.
    """
    t = np.tanh(_GELU_C * (x + 0.044715 * x * x * x))
    return 0.5 * x * (1.0 + t), t


def _gelu_backward(dout: np.ndarray, x: np.ndarray, t: np.ndarray) -> np.ndarray:
    # `x * x` rather than `x ** 2`: the power operator dispatches to np.power, which is an order
    # slower than a multiply on float32 and was doing it over every hidden unit twice per step.
    dinner = _GELU_C * (1.0 + 3 * 0.044715 * x * x)
    return dout * (0.5 * (1.0 + t) + 0.5 * x * (1.0 - t * t) * dinner)


def _softmax(x: np.ndarray) -> np.ndarray:
    """In place, and returning the same array. `x` must be a private float buffer.

    Every caller here passes a freshly computed contiguous array — the attention scores and the
    logits, neither of which is read again afterwards — so the out-of-place version was allocating
    three extra copies of its input per call. At the logits that input is (batch, time, vocab): 16.8M
    float32, 67MB, and the single largest tensor in the step. Measured at 2.2s of a 10.1s profile.
    """
    x -= x.max(axis=-1, keepdims=True)
    np.exp(x, out=x)
    x /= x.sum(axis=-1, keepdims=True)
    return x


class Transformer:
    """The model. `params` is a flat dict of arrays so the optimiser and the gradient check share it."""

    def __init__(self, config: TransformerConfig, vocab: Vocab, meta: dict | None = None, seed: int = 0) -> None:
        if len(vocab) > config.vocab_size:
            # Loudly, because the alternative is to map the overflow to `<unk>` at scoring time, which
            # inflates the OOV rate the model reports while `evaluate` computes OOV from the vocabulary
            # and disagrees. Build the vocabulary with `max_size=config.vocab_size`.
            raise ValueError(
                f"vocabulary of {len(vocab)} exceeds vocab_size {config.vocab_size}; "
                "build it with max_size=config.vocab_size"
            )
        self.config = config
        self.vocab = vocab
        self.meta = meta or {}
        rng = np.random.default_rng(seed)
        c = config
        s = c.init_std

        def normal(*shape: int) -> np.ndarray:
            return (rng.standard_normal(shape) * s).astype(DTYPE)

        #: Additive causal masks by sequence length. Constants, so they are cached rather than rebuilt.
        self._masks: dict[int, np.ndarray] = {}
        self.params: dict[str, np.ndarray] = {
            "tok": normal(c.vocab_size, c.d_model),
            "pos": normal(c.context, c.d_model),
            "ln_f.g": np.ones(c.d_model, dtype=DTYPE),
            "ln_f.b": np.zeros(c.d_model, dtype=DTYPE),
        }
        for i in range(c.n_layers):
            self.params[f"b{i}.ln1.g"] = np.ones(c.d_model, dtype=DTYPE)
            self.params[f"b{i}.ln1.b"] = np.zeros(c.d_model, dtype=DTYPE)
            self.params[f"b{i}.qkv"] = normal(c.d_model, 3 * c.d_model)
            self.params[f"b{i}.proj"] = normal(c.d_model, c.d_model)
            self.params[f"b{i}.ln2.g"] = np.ones(c.d_model, dtype=DTYPE)
            self.params[f"b{i}.ln2.b"] = np.zeros(c.d_model, dtype=DTYPE)
            self.params[f"b{i}.fc1"] = normal(c.d_model, c.d_ff)
            self.params[f"b{i}.fc2"] = normal(c.d_ff, c.d_model)

    # ---- forward ---------------------------------------------------------------------------------

    def _causal_mask(self, T: int) -> np.ndarray:
        m = self._masks.get(T)
        if m is None:
            m = np.triu(np.full((T, T), -1e9, dtype=DTYPE), k=1)
            self._masks[T] = m
        return m

    def forward(self, idx: np.ndarray) -> tuple[np.ndarray, dict]:
        """Logits for a batch of id sequences, plus everything the backward pass needs.

        `idx` is (batch, time). Returns logits (batch, time, vocab). The causal mask is applied as an
        additive -inf on the upper triangle rather than by slicing, because a mask that is a separate
        code path from the unmasked case is a mask that gets it wrong once.
        """
        c = self.config
        p = self.params
        B, T = idx.shape
        if T > c.context:
            raise ValueError(f"sequence of {T} exceeds the context of {c.context}")
        cache: dict = {"idx": idx, "T": T, "B": B, "blocks": []}

        x = p["tok"][idx] + p["pos"][:T]
        for i in range(c.n_layers):
            bc: dict = {"x_in": x}
            h, ln1 = _layer_norm(x, p[f"b{i}.ln1.g"], p[f"b{i}.ln1.b"])
            bc["ln1"] = ln1
            bc["ln1_out"] = h

            qkv = h @ p[f"b{i}.qkv"]
            q, k, v = np.split(qkv, 3, axis=-1)
            # (B, heads, T, d_head)
            shape = (B, T, c.n_heads, c.d_head)
            q = q.reshape(shape).transpose(0, 2, 1, 3)
            k = k.reshape(shape).transpose(0, 2, 1, 3)
            v = v.reshape(shape).transpose(0, 2, 1, 3)
            att = (q @ k.transpose(0, 1, 3, 2)) / math.sqrt(c.d_head)
            # Additive and in place. A fresh `np.triu(np.ones(...))` per layer per step, applied with
            # `np.where`, allocated a second (batch, heads, T, T) every time for a constant that
            # depends on nothing but T. The additive form is also why no masked position needs
            # special handling in the backward pass: its softmax weight is zero, so its gradient is.
            att += self._causal_mask(T)
            w = _softmax(att)
            o = (w @ v).transpose(0, 2, 1, 3).reshape(B, T, c.d_model)
            bc.update(q=q, k=k, v=v, w=w, o_pre=o)
            a = o @ p[f"b{i}.proj"]
            x = x + a

            bc["x_mid"] = x
            h2, ln2 = _layer_norm(x, p[f"b{i}.ln2.g"], p[f"b{i}.ln2.b"])
            bc["ln2"] = ln2
            bc["ln2_out"] = h2
            f1 = h2 @ p[f"b{i}.fc1"]
            bc["f1"] = f1
            g, gt = _gelu(f1)
            bc["gelu"] = g
            bc["gelu_tanh"] = gt
            x = x + g @ p[f"b{i}.fc2"]
            cache["blocks"].append(bc)

        xf, ln_f = _layer_norm(x, p["ln_f.g"], p["ln_f.b"])
        cache["ln_f"] = ln_f
        cache["xf"] = xf
        # Tied: the output projection is the token embedding. Halves the parameters that matter most
        # at this vocabulary size and is the standard choice for a small LM.
        logits = xf @ p["tok"].T
        return logits, cache

    # ---- loss and gradients ----------------------------------------------------------------------

    def loss_and_grads(self, idx: np.ndarray, targets: np.ndarray) -> tuple[float, dict[str, np.ndarray]]:
        """Mean cross-entropy over every position, and the gradient of it for every parameter."""
        c = self.config
        p = self.params
        logits, cache = self.forward(idx)
        B, T = idx.shape
        # `logits` is turned into probabilities and then into their gradient, all in the one buffer.
        # A `.copy()` here was 0.5s of a 10.1s profile for a 67MB array nothing else refers to.
        n = B * T
        flat = _softmax(logits).reshape(n, c.vocab_size)
        tgt = targets.reshape(n)
        rows = np.arange(n)
        loss = float(-np.log(np.maximum(flat[rows, tgt], 1e-12)).mean())

        flat[rows, tgt] -= 1.0
        flat /= n
        dlogits = flat.reshape(B, T, c.vocab_size)

        grads = {k: np.zeros_like(v) for k, v in p.items()}
        xf = cache["xf"]
        # A reshape and a matmul, not `np.einsum("btv,btd->vd", ...)`. Measured: einsum took 227ms of
        # a 463ms step because it has no BLAS path for this contraction and falls to its own C loop.
        # The same product as a single GEMM is under 10ms. This is the largest matrix multiply in the
        # model — vocab x d_model — so it was also the worst possible place to lose the fast path.
        grads["tok"] += dlogits.reshape(-1, c.vocab_size).T @ xf.reshape(-1, c.d_model)
        dxf = dlogits @ p["tok"]

        dx, dg, db = _layer_norm_backward(dxf, cache["ln_f"])
        grads["ln_f.g"] += dg
        grads["ln_f.b"] += db

        for i in reversed(range(c.n_layers)):
            bc = cache["blocks"][i]
            # MLP branch: x_out = x_mid + gelu(ln2(x_mid) @ fc1) @ fc2
            dres = dx
            dmlp = dx
            grads[f"b{i}.fc2"] += bc["gelu"].reshape(-1, c.d_ff).T @ dmlp.reshape(-1, c.d_model)
            dg_ = dmlp @ p[f"b{i}.fc2"].T
            df1 = _gelu_backward(dg_, bc["f1"], bc["gelu_tanh"])
            grads[f"b{i}.fc1"] += bc["ln2_out"].reshape(-1, c.d_model).T @ df1.reshape(-1, c.d_ff)
            dh2 = df1 @ p[f"b{i}.fc1"].T
            dx2, dg2, db2 = _layer_norm_backward(dh2, bc["ln2"])
            grads[f"b{i}.ln2.g"] += dg2
            grads[f"b{i}.ln2.b"] += db2
            dx = dres + dx2

            # Attention branch: x_mid = x_in + (attn(ln1(x_in)) @ proj)
            dres = dx
            da = dx
            grads[f"b{i}.proj"] += bc["o_pre"].reshape(-1, c.d_model).T @ da.reshape(-1, c.d_model)
            do = da @ p[f"b{i}.proj"].T
            do = do.reshape(B, T, c.n_heads, c.d_head).transpose(0, 2, 1, 3)
            w, v, q, k = bc["w"], bc["v"], bc["q"], bc["k"]
            dw = do @ v.transpose(0, 1, 3, 2)
            dv = w.transpose(0, 1, 3, 2) @ do
            # softmax backward, per row
            datt = w * (dw - (dw * w).sum(axis=-1, keepdims=True))
            datt = datt / math.sqrt(c.d_head)
            dq = datt @ k
            dk = datt.transpose(0, 1, 3, 2) @ q
            back = lambda t: t.transpose(0, 2, 1, 3).reshape(B, T, c.d_model)  # noqa: E731
            dqkv = np.concatenate([back(dq), back(dk), back(dv)], axis=-1)
            grads[f"b{i}.qkv"] += bc["ln1_out"].reshape(-1, c.d_model).T @ dqkv.reshape(-1, 3 * c.d_model)
            dh = dqkv @ p[f"b{i}.qkv"].T
            dx1, dg1, db1 = _layer_norm_backward(dh, bc["ln1"])
            grads[f"b{i}.ln1.g"] += dg1
            grads[f"b{i}.ln1.b"] += db1
            dx = dres + dx1

        idxf = cache["idx"].reshape(-1)
        np.add.at(grads["tok"], idxf, dx.reshape(-1, c.d_model))
        grads["pos"][:T] += dx.sum(axis=0)
        return loss, grads

    # ---- scoring, duck-typed against KneserNey ---------------------------------------------------

    def logprob_terms(self, ids: Iterable[int]) -> list[tuple[float, bool]]:
        """Per-position natural log probability and whether the target is a real word.

        The same contract `KneserNey.logprob_terms` has, so `evaluate` scores this model with no
        special case. Positions are produced in windows of `context`, each window predicting its own
        tokens from the ones before them inside that window — a sliding window with no overlap, which
        is the cheap convention. It underestimates slightly against a fully overlapping window,
        identically for every model scored this way.
        """
        c = self.config
        unk = self.vocab.stoi[UNK]
        bos, eos = self.vocab.stoi[BOS], self.vocab.stoi[EOS]
        seq = [bos] + list(ids) + [eos]
        out: list[tuple[float, bool]] = []
        for start in range(0, len(seq) - 1, c.context):
            window = seq[start : start + c.context + 1]
            if len(window) < 2:
                break
            x = np.array([window[:-1]], dtype=np.int64)
            y = window[1:]
            logits, _ = self.forward(x)
            logp = logits[0] - logits[0].max(axis=-1, keepdims=True)
            logp = logp - np.log(np.exp(logp).sum(axis=-1, keepdims=True))
            for t, target in enumerate(y):
                out.append((float(logp[t, target]), target != unk))
        return out

    def logprob(self, ids: Iterable[int]) -> tuple[float, int]:
        terms = self.logprob_terms(ids)
        return sum(lp for lp, _ in terms), len(terms)

    def perplexity(self, ids: Iterable[int]) -> float:
        lp, n = self.logprob(ids)
        return math.exp(-lp / n) if n else float("inf")

    # ---- persistence -----------------------------------------------------------------------------

    def save(self, path: str | Path) -> Path:
        """Header, vocabulary, then one base64-free line per parameter as plain floats.

        Not pickle, for the reason `ngram.py` gives: a checked-out model a scheduled job loads is a
        code-execution path if it is pickle. `.npz` would be smaller and is also not pickle, but it is
        opaque to `zcat`, and being able to read a model with shell tools has already earned its keep
        in this repository twice.
        """
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps({"format": "adhd-tf-1", "config": asdict(self.config), "meta": self.meta}) + "\n")
            fh.write(json.dumps({"itos": self.vocab.itos, "min_count": self.vocab.min_count}) + "\n")
            for name, arr in sorted(self.params.items()):
                fh.write(f"{name}\t{','.join(str(d) for d in arr.shape)}\t")
                fh.write(",".join(f"{v:.6g}" for v in arr.ravel()))
                fh.write("\n")
        return path

    @classmethod
    def load(cls, path: str | Path, budget: Budget | None = None) -> Transformer:
        path = Path(path)
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            head = json.loads(fh.readline())
            if head.get("format") != "adhd-tf-1":
                raise ValueError(f"{path} is not an adhd-tf-1 model")
            vline = json.loads(fh.readline())
            itos = vline["itos"]
            vocab = Vocab(
                stoi={w: i for i, w in enumerate(itos)},
                itos=itos,
                counts=[0] * len(itos),
                min_count=vline.get("min_count", 2),
                dropped_types=0,
                dropped_tokens=0,
            )
            m = cls(TransformerConfig(**head["config"]), vocab, head.get("meta", {}))
            for line in fh:
                name, shape, values = line.rstrip("\n").split("\t")
                dims = tuple(int(d) for d in shape.split(","))
                m.params[name] = np.fromstring(values, sep=",", dtype=DTYPE).reshape(dims)
                if budget is not None:
                    budget.touch()
                    if not budget.allows():
                        raise RuntimeError(f"loading {path} refused: {budget.stopped_because}")
        return m


@dataclass
class Adam:
    """Adam, because SGD on a transformer at this size is a way to measure the wrong thing."""

    lr: float = 3e-4
    beta1: float = 0.9
    beta2: float = 0.95
    eps: float = 1e-8
    clip: float = 1.0
    t: int = 0
    m: dict[str, np.ndarray] = field(default_factory=dict)
    v: dict[str, np.ndarray] = field(default_factory=dict)

    def step(self, params: dict[str, np.ndarray], grads: dict[str, np.ndarray]) -> float:
        total = math.sqrt(sum(float((g * g).sum()) for g in grads.values()))
        scale = min(1.0, self.clip / (total + 1e-12))
        self.t += 1
        for k, g in grads.items():
            g = g * scale
            if k not in self.m:
                self.m[k] = np.zeros_like(g)
                self.v[k] = np.zeros_like(g)
            self.m[k] = self.beta1 * self.m[k] + (1 - self.beta1) * g
            self.v[k] = self.beta2 * self.v[k] + (1 - self.beta2) * (g * g)
            mhat = self.m[k] / (1 - self.beta1**self.t)
            vhat = self.v[k] / (1 - self.beta2**self.t)
            params[k] -= (self.lr * mhat / (np.sqrt(vhat) + self.eps)).astype(DTYPE)
        return total


def batches(ids: Iterator[int], context: int, batch_size: int) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    """Contiguous windows, packed into batches. Each window predicts its own next tokens."""
    need = context + 1
    buf: list[int] = []
    rows: list[list[int]] = []
    for i in ids:
        buf.append(i)
        if len(buf) == need:
            rows.append(buf)
            buf = [buf[-1]]
            if len(rows) == batch_size:
                a = np.array(rows, dtype=np.int64)
                yield a[:, :-1], a[:, 1:]
                rows = []
    if rows:
        a = np.array(rows, dtype=np.int64)
        yield a[:, :-1], a[:, 1:]


def array_batches(ids: np.ndarray, context: int, batch_size: int) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    """`batches` over an array already in memory, without copying it into a Python list.

    Same windows in the same order as `batches` on the same ids, and `tests/test_transformer.py`
    asserts that rather than trusting it. The difference is only cost, and the cost is the reason:
    `iter(ids.tolist())` on 64M ids builds a multi-gigabyte list of boxed integers every epoch, which
    is larger than the model, the optimiser state and the corpus put together.
    """
    n_windows = (ids.size - 1) // context
    for start in range(0, n_windows, batch_size):
        stop = min(start + batch_size, n_windows)
        rows = [ids[j * context : j * context + context + 1] for j in range(start, stop)]
        a = np.stack(rows).astype(np.int64)
        yield a[:, :-1], a[:, 1:]
