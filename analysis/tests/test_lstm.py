"""The LSTM's gradient, its state, and its scoring contract.

The gradient check is why this file exists, and it matters more here than it did for the transformer.
An LSTM's error flows through four gates and backwards through time, and the cell state's gradient
arrives from two places at every step — the hidden output at `t` and the cell at `t+1`. Dropping the
second gives a model that trains to a plausible loss and cannot remember anything, with no symptom to
notice. Central differences are the only thing that tells the difference.
"""

from __future__ import annotations

import math
from collections import Counter

import numpy as np
import pytest

from adhd_analysis.text import lstm as ls
from adhd_analysis.text.budget import Budget
from adhd_analysis.text.lstm import LSTM, LSTMConfig, _sigmoid
from adhd_analysis.text.tokenize import BOS, EOS, UNK, Vocab
from adhd_analysis.text.transformer import Adam


def tiny_vocab(n_words: int = 8) -> Vocab:
    return Vocab.build(Counter({f"w{i}": n_words - i + 2 for i in range(n_words)}), min_count=1)


def tiny_config(vocab: Vocab, **over) -> LSTMConfig:
    kw = dict(vocab_size=len(vocab), d_model=8, n_layers=2, context=6)
    kw.update(over)
    return LSTMConfig(**kw)


@pytest.fixture
def f64(monkeypatch):
    """Central differences in float32 are dominated by rounding: the step small enough to approximate
    the derivative is smaller than the representable difference."""
    monkeypatch.setattr(ls, "DTYPE", np.float64)
    yield


def test_gradient_matches_central_differences(f64):
    """**Every** parameter, not a sample of them, on a model deliberately small enough that exhaustive
    is affordable.

    This test sampled seven deterministic positions per tensor when first written, and that was not
    enough. Deleting `dh_next` — the recurrent gradient, the whole reason an LSTM is not a feedforward
    net — produced a 4.35e-04 relative error at `l1.b[20]` and **the test passed**, because
    `(k * 7919) % 32` for k in 1..7 never lands on 20. A check that samples is a check whose coverage
    depends on arithmetic nobody chose deliberately.

    About a thousand parameters here, so two thousand forward passes. Cheap, and it cannot get lucky.
    """
    vocab = tiny_vocab()
    cfg = tiny_config(vocab, context=10)
    model = LSTM(cfg, vocab, seed=3)
    rng = np.random.default_rng(11)
    idx = rng.integers(0, cfg.vocab_size, size=(2, cfg.context))
    tgt = rng.integers(0, cfg.vocab_size, size=(2, cfg.context))

    _, grads = model.loss_and_grads(idx, tgt)

    def loss_only():
        logits, _, _ = model.forward(idx)
        p = logits.reshape(-1, cfg.vocab_size)
        p = p - p.max(axis=-1, keepdims=True)
        p = np.exp(p)
        p /= p.sum(axis=-1, keepdims=True)
        flat = tgt.reshape(-1)
        return float(-np.log(p[np.arange(flat.size), flat]).mean())

    eps = 1e-5
    worst = (0.0, "nothing checked")
    checked = 0
    for name, arr in model.params.items():
        assert arr.dtype == np.float64, f"{name} did not honour the patched dtype"
        flat = arr.ravel()
        for j in range(flat.size):
            keep = flat[j]
            flat[j] = keep + eps
            up = loss_only()
            flat[j] = keep - eps
            down = loss_only()
            flat[j] = keep
            numeric = (up - down) / (2 * eps)
            analytic = float(grads[name].ravel()[j])
            scale = max(1.0, abs(numeric), abs(analytic))
            err = abs(numeric - analytic) / scale
            checked += 1
            if err > worst[0]:
                worst = (err, f"{name}[{j}] numeric={numeric:.6e} analytic={analytic:.6e}")

    assert checked == cfg.parameter_count(), f"checked {checked} of {cfg.parameter_count()} parameters"
    assert worst[0] < 1e-6, f"worst relative gradient error {worst[0]:.2e} at {worst[1]}"


def test_the_gradient_travels_back_through_time(f64):
    """The check the sampled one can pass while the model is broken: perturbing a weight must change
    the loss at *later* timesteps, which only happens if the recurrent path is wired.

    A single-step LSTM with the recurrence dropped still gradient-checks at `T = 1`. This uses a
    sequence long enough that `wh` has somewhere to send error, and asserts it arrives.
    """
    vocab = tiny_vocab()
    cfg = tiny_config(vocab, context=6, n_layers=1)
    model = LSTM(cfg, vocab, seed=5)
    idx = np.array([[3, 4, 5, 6, 7, 8]])
    tgt = np.array([[4, 5, 6, 7, 8, 3]])
    _, grads = model.loss_and_grads(idx, tgt)
    # `wh` is the recurrent matrix. If it receives no gradient, there is no recurrence.
    assert np.abs(grads["l0.wh"]).sum() > 0, "the recurrent weights received no gradient at all"
    # And the forget-gate block of the bias, which only moves if the cell state carries anything.
    d = cfg.d_model
    forget = grads["l0.b"][d : 2 * d]
    assert np.abs(forget).sum() > 0, "the forget gate received no gradient; the cell is not carrying"


def test_gradient_reaches_every_parameter(f64):
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = LSTM(cfg, vocab, seed=7)
    idx = np.array([[3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3]])
    tgt = np.array([[4, 5, 6, 7, 8, 9], [7, 6, 5, 4, 3, 9]])
    _, grads = model.loss_and_grads(idx, tgt)
    assert set(grads) == set(model.params)
    for name, g in grads.items():
        if name == "tok":
            used = sorted(set(idx.ravel()) | set(tgt.ravel()))
            g = g[used]
        assert np.abs(g).sum() > 0, f"{name} received no gradient at all"


def test_the_tied_embedding_gets_both_gradients(f64):
    vocab = tiny_vocab()
    model = LSTM(tiny_config(vocab), vocab, seed=9)
    idx = np.array([[3, 3, 3, 3, 3, 3]])
    tgt = np.array([[4, 4, 4, 4, 4, 4]])
    _, grads = model.loss_and_grads(idx, tgt)
    assert abs(grads["tok"][3]).sum() > 0, "row 3 appears only as an input and must still move"
    assert abs(grads["tok"][4]).sum() > 0, "row 4 appears only as a target and must still move"


def test_the_forget_gate_starts_open():
    """A zero bias makes `sigmoid(0) = 0.5`, halving the cell state every step, and the model spends
    its first few hundred updates learning to stop. One is the standard remedy and it is a real
    difference at this training budget."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = LSTM(cfg, vocab)
    d = cfg.d_model
    for i in range(cfg.n_layers):
        b = model.params[f"l{i}.b"]
        assert np.allclose(b[:d], 0.0), "the input gate should start neutral"
        assert np.allclose(b[d : 2 * d], 1.0), "the forget gate should start open"
        assert np.allclose(b[2 * d :], 0.0)


def test_state_carries_between_calls():
    """The property `logprob_terms` relies on, and the thing that makes this model class different from
    the transformer at scoring time."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab, context=4)
    model = LSTM(cfg, vocab, seed=2)
    a = np.array([[3, 4, 5, 6]])
    b = np.array([[7, 8, 9, 10]])

    _, _, state = model.forward(a)
    assert state is not None and len(state) == cfg.n_layers
    assert any(np.abs(h).sum() > 0 for h, _c in state), "the state came back empty"

    continued, _, _ = model.forward(b, state)
    fresh, _, _ = model.forward(b, None)
    assert not np.allclose(continued, fresh), "passing state changed nothing, so it is not being used"


def test_sigmoid_is_stable_at_the_extremes():
    """`1/(1+exp(-x))` overflows for x very negative. The tanh identity is exact and does not."""
    x = np.array([-800.0, -40.0, 0.0, 40.0, 800.0])
    out = _sigmoid(x)
    assert np.all(np.isfinite(out))
    assert out[0] == pytest.approx(0.0) and out[-1] == pytest.approx(1.0)
    assert out[2] == pytest.approx(0.5)


def test_config_rejects_dimensions_a_file_could_choose():
    with pytest.raises(ValueError, match="outside the supported range"):
        LSTMConfig(vocab_size=200_000_000)
    with pytest.raises(ValueError, match="outside the supported range"):
        LSTMConfig(n_layers=0)
    with pytest.raises(ValueError, match="expected an integer"):
        LSTMConfig(d_model=True)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="init_std"):
        LSTMConfig(init_std=0.0)


def test_parameter_count_matches_the_arrays():
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = LSTM(cfg, vocab)
    assert sum(a.size for a in model.params.values()) == cfg.parameter_count()


def test_logprob_terms_has_one_entry_per_predicted_token():
    vocab = tiny_vocab()
    model = LSTM(tiny_config(vocab, context=4), vocab, seed=2)
    ids = vocab.encode(["w0", "w1", "w2", "w3", "w4", "w5"])
    terms = model.logprob_terms(ids)
    assert len(terms) == len(ids) + 1
    assert all(lp < 0 for lp, _ in terms)
    assert all(real for _, real in terms)


def test_logprob_terms_flags_unk_as_not_real():
    vocab = tiny_vocab()
    model = LSTM(tiny_config(vocab), vocab, seed=2)
    flags = [real for _, real in model.logprob_terms(vocab.encode(["w0", "nowhere", "w1"]))]
    assert flags == [True, False, True, True]


def test_scoring_emits_one_term_per_target_at_every_length():
    vocab = tiny_vocab()
    model = LSTM(tiny_config(vocab, context=4), vocab, seed=1)
    for n in (1, 2, 3, 4, 5, 8, 9, 16, 17, 31):
        assert len(model.logprob_terms(vocab.encode(["w0"] * n))) == n + 1, f"length {n}"


def test_scoring_matches_the_kneser_ney_contract():
    from adhd_analysis.text.ngram import KneserNey, count_ngrams

    vocab = tiny_vocab()
    ids = vocab.encode(["w0", "w1", "w2"])
    table, meta = count_ngrams(iter([ids, ids]), 2, Budget(), vocab)
    kn = KneserNey(order=2, vocab=vocab, counts=[{}, table], meta=meta).seal()
    for model in (LSTM(tiny_config(vocab), vocab, seed=2), kn):
        terms = model.logprob_terms(ids)
        assert all(isinstance(lp, float) and isinstance(real, bool) for lp, real in terms)


def test_training_drives_the_loss_below_chance():
    """A model that cannot memorise one short cycle has a wiring bug the gradient check can miss,
    because a right gradient with a wrong optimiser update still fails."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab, context=6, n_layers=1)
    model = LSTM(cfg, vocab, seed=6)
    idx = np.array([[3, 4, 5, 6, 7, 8]])
    tgt = np.array([[4, 5, 6, 7, 8, 3]])
    chance = math.log(cfg.vocab_size)
    first, _ = model.loss_and_grads(idx, tgt)
    assert first == pytest.approx(chance, rel=0.25)
    opt = Adam(lr=2e-2)
    last = first
    for _ in range(400):
        last, grads = model.loss_and_grads(idx, tgt)
        opt.step(model.params, grads)
    assert last < chance / 3, f"loss went {first:.3f} -> {last:.3f}, chance is {chance:.3f}"


def test_save_and_load_round_trips(tmp_path):
    vocab = tiny_vocab()
    model = LSTM(tiny_config(vocab), vocab, meta={"corpus": "tiny"}, seed=4)
    ids = vocab.encode(["w0", "w1", "w2", "w3"])
    before = model.perplexity(ids)
    back = LSTM.load(model.save(tmp_path / "rt.lstm.gz"))
    assert back.config == model.config
    assert back.meta == {"corpus": "tiny"}
    assert back.perplexity(ids) == pytest.approx(before, rel=1e-4)


def test_load_refuses_another_format(tmp_path):
    import gzip
    import json as _json

    bad = tmp_path / "not-lstm.gz"
    with gzip.open(bad, "wt", encoding="utf-8") as fh:
        fh.write(_json.dumps({"format": "adhd-tf-1"}) + "\n")
    with pytest.raises(ls.ModelFileRefused, match="not an adhd-lstm-1 model"):
        LSTM.load(bad)


def test_load_refuses_a_file_that_wants_too_much_memory(tmp_path):
    import gzip
    import json as _json

    p = tmp_path / "huge.lstm.gz"
    with gzip.open(p, "wt", encoding="utf-8") as fh:
        fh.write(_json.dumps({"format": "adhd-lstm-1", "meta": {},
                              "config": {"vocab_size": 8_000_000, "d_model": 512, "n_layers": 2, "context": 64,
                                         "init_std": 0.05}}) + "\n")
        fh.write(_json.dumps({"itos": ["<unk>", "<s>", "</s>"], "min_count": 2}) + "\n")
    assert p.stat().st_size < 1024
    with pytest.raises(ls.ModelFileRefused, match="against a ceiling"):
        LSTM.load(p, Budget(max_rss_mb=1024))


def test_a_vocabulary_larger_than_the_config_is_refused():
    vocab = tiny_vocab(n_words=8)
    with pytest.raises(ValueError, match="exceeds vocab_size"):
        LSTM(tiny_config(vocab, vocab_size=len(vocab) - 1), vocab)


def test_specials_keep_the_ids_scoring_assumes():
    vocab = tiny_vocab()
    assert vocab.stoi[UNK] == 0 and vocab.stoi[BOS] == 1 and vocab.stoi[EOS] == 2
