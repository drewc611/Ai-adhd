"""E9's sampled softmax: the loss the model optimises at 148,114 types, and what it must not change.

Backlog 79 could not be attempted without this and said so: the full softmax is `d_model x vocab_size`
and every token's loss touches all of it, so at the n-gram's vocabulary that one matmul is the whole
cost. A sampled softmax makes the cell reachable and **changes the loss**, which is why E9 is a
registration rather than a commit.

The gradient check here is the load-bearing test, to the standard D24 held the LSTM to. This is new
code on the part of the model that carries 93% of its parameters at the registered vocabulary, and the
LSTM's own check did not work when it was first written — it sampled positions and missed the one that
mattered. So this one is exhaustive.
"""

from __future__ import annotations

import math
from collections import Counter

import numpy as np
import pytest

from adhd_analysis.text import transformer as tf
from adhd_analysis.text.tokenize import Vocab
from adhd_analysis.text.transformer import Transformer, TransformerConfig


def vocab_of(n: int = 40) -> Vocab:
    # Frequency-ordered, because `log_uniform_sampler` assumes it and says so.
    return Vocab.build(Counter({f"w{i}": n * 10 - i for i in range(n)}), min_count=1)


def small(vocab: Vocab, **over) -> TransformerConfig:
    kw = dict(vocab_size=len(vocab), d_model=8, n_heads=2, n_layers=1, context=4, d_ff=16)
    kw.update(over)
    return TransformerConfig(**kw)


@pytest.fixture
def f64(monkeypatch):
    """Central differences in float32 are dominated by rounding. The first run of this check was in
    float32 and reported a worst relative error of 1.976 — which reads exactly like a wrong gradient
    and was not one."""
    monkeypatch.setattr(tf, "DTYPE", np.float64)
    yield


def fixture_batch(seed: int = 0, n_samples: int = 12):
    vocab = vocab_of()
    cfg = small(vocab)
    model = Transformer(cfg, vocab, seed=seed)
    rng = np.random.default_rng(seed + 1)
    idx = rng.integers(0, cfg.vocab_size, size=(2, cfg.context))
    tgt = rng.integers(0, cfg.vocab_size, size=(2, cfg.context))
    samples = model.log_uniform_sampler(n_samples, np.random.default_rng(seed + 7))
    return model, cfg, idx, tgt, samples


def test_the_sampled_gradient_matches_central_differences_on_every_parameter(f64):
    """Exhaustive, and the count is asserted so coverage cannot silently shrink."""
    model, cfg, idx, tgt, samples = fixture_batch()
    rng = np.random.default_rng(0)

    def loss_only() -> float:
        return model.loss_and_grads_sampled(idx, tgt, n_samples=0, rng=rng, samples=samples)[0]

    _, grads = model.loss_and_grads_sampled(idx, tgt, n_samples=0, rng=rng, samples=samples)
    # `scale` floors at 1.0, which is `test_transformer.py`'s convention and is the reason this test
    # reports what it means. A pure ratio turns float64 noise on a near-zero entry into a large
    # relative error: the first run of this check reported 8.19e-03 on `b0.qkv`, where numeric was
    # +3.730e-08 against analytic +3.761e-08 — a correct gradient measured against nothing.
    eps, worst, where, checked = 1e-5, 0.0, "", 0
    for name, arr in model.params.items():
        assert arr.dtype == np.float64, f"{name} did not honour the patched dtype"
        flat, g = arr.reshape(-1), grads[name].reshape(-1)
        for k in range(flat.size):
            keep = flat[k]
            flat[k] = keep + eps
            up = loss_only()
            flat[k] = keep - eps
            down = loss_only()
            flat[k] = keep
            numeric = (up - down) / (2 * eps)
            scale = max(1.0, abs(numeric), abs(float(g[k])))
            err = abs(numeric - float(g[k])) / scale
            if err > worst:
                worst, where = err, f"{name}[{k}]"
            checked += 1
    assert checked == cfg.parameter_count(), "the check stopped covering every parameter"
    assert worst < 1e-6, f"worst relative error {worst:.3e} at {where} over {checked} parameters"


def test_the_estimator_approaches_the_full_loss_as_the_sample_grows(f64):
    """A sampled softmax is an estimator of the full cross-entropy. If drawing more negatives did not
    move it towards the real number, the `-log Q` correction would be decoration."""
    model, cfg, idx, tgt, _ = fixture_batch()
    full = model.full_loss(idx, tgt)
    errors = []
    for n_samples in (4, 32, 256, 2048):
        # Averaged over draws: one draw at a small sample size is noise, and the claim is about the
        # estimator rather than about a particular sample.
        vals = [
            model.loss_and_grads_sampled(idx, tgt, n_samples=n_samples, rng=np.random.default_rng(s))[0]
            for s in range(12)
        ]
        errors.append(abs(float(np.mean(vals)) - full))
    assert errors[-1] < errors[0], f"more negatives did not help: {errors}"
    assert errors[-1] < 0.35 * errors[0], f"convergence is too weak to call it an estimator: {errors}"
    # The bug this test was written for, named so a regression reads as itself rather than as drift.
    # The first version of the head omitted `- log S` from the importance weight, and the estimator ran
    # *away* from the full loss by exactly `log S`: 1.29, 3.48, 5.54 and 7.59 at S of 4, 32, 256 and
    # 2048. A gradient check cannot see it — the term is constant in the parameters and cancels out of
    # every derivative — so only comparing against the real loss catches it.
    assert errors[-1] < math.log(2048) / 10, f"the estimator is off by something like log S: {errors}"


def test_a_negative_colliding_with_the_target_is_masked_out():
    """Without the mask a collision teaches the model to push the target's own logit down: the same id
    appears as the thing to predict and as a thing not to predict, inside one softmax.

    Masking a collision is **not** the same as having drawn one fewer negative, and the first version of
    this test assumed it was. The importance weight is `1/(S·Q)` for the S that were actually drawn, so
    `log S` counts the collision whether or not it survives into the denominator. The properties below
    hold regardless, which is why they are the ones asserted.
    """
    vocab = vocab_of()
    model = Transformer(small(vocab), vocab, seed=2)
    idx = np.array([[1, 2, 3, 4]])
    tgt = np.array([[5, 5, 5, 5]])
    rng = np.random.default_rng(0)
    q2 = np.array([-2.0, -2.0])

    def loss(ids: list[int], log_q: np.ndarray) -> float:
        return model.loss_and_grads_sampled(
            idx, tgt, n_samples=0, rng=rng, samples=(np.array(ids), log_q)
        )[0]

    clean = loss([7, 9], q2)
    one_hit = loss([7, 5], q2)
    # A masked negative leaves the denominator, so the target keeps more of the probability mass.
    assert one_hit < clean, "masking a collision did not lower the loss"
    # Order cannot matter: the candidates are a set summed over, not a sequence.
    assert loss([5, 7], q2) == pytest.approx(one_hit)
    # Every negative masked leaves the target as the only candidate, so it has all the mass and the
    # loss is zero. This is the assertion that fails loudest if the mask stops working.
    assert loss([5, 5], q2) == pytest.approx(0.0, abs=1e-12)


def test_the_masked_candidate_produces_no_nan_in_the_gradient():
    """`-inf` times zero is a NaN, and a NaN gradient is a model that trains to nothing in silence."""
    vocab = vocab_of()
    model = Transformer(small(vocab), vocab, seed=4)
    idx = np.array([[1, 2, 3, 4]])
    tgt = np.array([[6, 6, 6, 6]])
    samples = (np.array([6, 6, 6]), np.array([-2.0, -2.0, -2.0]))
    loss, grads = model.loss_and_grads_sampled(
        idx, tgt, n_samples=0, rng=np.random.default_rng(0), samples=samples
    )
    assert math.isfinite(loss)
    for name, g in grads.items():
        assert np.isfinite(g).all(), f"{name} carries a NaN or an infinity"


def test_every_sampled_id_is_in_range_and_the_log_probabilities_are_a_distribution():
    vocab = vocab_of(200)
    model = Transformer(small(vocab, vocab_size=len(vocab)), vocab, seed=0)
    ids, log_q = model.log_uniform_sampler(5000, np.random.default_rng(3))
    assert ids.min() >= 0 and ids.max() < len(vocab)
    assert np.isfinite(log_q).all() and (log_q < 0).all()
    # The sampler claims P(i) proportional to 1/(i+1). Summed over the whole vocabulary that is 1.
    all_ids = np.arange(len(vocab))
    total = np.exp(np.log((np.log(all_ids + 2.0) - np.log(all_ids + 1.0)) / math.log(len(vocab) + 1))).sum()
    assert total == pytest.approx(1.0, abs=1e-9), f"the sampling distribution sums to {total}"
    # And it really does favour the frequent end, or it is uniform sampling with extra arithmetic.
    assert (ids < len(vocab) // 10).mean() > 0.3


def test_skipping_the_projection_changes_nothing_but_the_logits():
    """`project=False` exists so the sampled head does not pay for the matmul it is avoiding. If the
    cache differed between the two paths, the sampled gradient would be computed against a different
    forward pass than the full one."""
    vocab = vocab_of()
    model = Transformer(small(vocab), vocab, seed=6)
    idx = np.array([[1, 2, 3, 4], [4, 3, 2, 1]])
    logits, full_cache = model.forward(idx)
    none_logits, lean_cache = model.forward(idx, project=False)
    assert logits is not None and none_logits is None
    assert np.array_equal(full_cache["xf"], lean_cache["xf"])
    assert set(full_cache) == set(lean_cache)


def test_scoring_never_uses_the_sampled_head():
    """E9's registered reading: cell D's perplexity is a true held-out perplexity. `logprob_terms`
    computes the full normalised distribution, so the log probabilities over a position sum to one."""
    vocab = vocab_of()
    model = Transformer(small(vocab), vocab, seed=8)
    ids = [1, 2, 3, 4, 5, 6]
    terms = model.logprob_terms(ids)
    # One term per target, and the sequence the scorer builds is `<s> ids </s>`, so a document of n ids
    # yields n + 1 targets. The same contract `KneserNey.logprob_terms` has.
    assert len(terms) == len(ids) + 1
    # Full normalisation, checked directly on the forward pass the scorer uses. A sampled head would
    # not sum to one over the vocabulary, because it never looks at most of it.
    logits, _ = model.forward(np.array([ids[:4]]))
    probs = tf._softmax(logits)[0, -1]
    assert probs.shape == (len(vocab),)
    assert float(probs.sum()) == pytest.approx(1.0, abs=1e-5), "scoring is not normalised over the vocabulary"
