"""The transformer's gradient, its causal mask, and its scoring contract.

The gradient check is the reason this file exists. A hand-written backward pass that is subtly wrong
still trains: the loss falls, the run finishes, and the perplexity it reports is a number about
nothing. Central differences are the only thing that tells the difference, so they run on every
parameter tensor, in float64, before anything else here is trusted.
"""

from __future__ import annotations

import math
from collections import Counter

import numpy as np
import pytest

from adhd_analysis.text import transformer as tf
from adhd_analysis.text.budget import Budget
from adhd_analysis.text.tokenize import BOS, EOS, UNK, Vocab
from adhd_analysis.text.transformer import Adam, Transformer, TransformerConfig, batches


def tiny_vocab(n_words: int = 8) -> Vocab:
    counter = Counter({f"w{i}": n_words - i + 2 for i in range(n_words)})
    return Vocab.build(counter, min_count=1)


def tiny_config(vocab: Vocab, **over) -> TransformerConfig:
    kw = dict(vocab_size=len(vocab), d_model=8, n_heads=2, n_layers=2, context=4, d_ff=16)
    kw.update(over)
    return TransformerConfig(**kw)


@pytest.fixture
def f64(monkeypatch):
    """Central differences in float32 are dominated by rounding: the step that is small enough to
    approximate the derivative is smaller than the representable difference. The module reads its
    dtype from a global for exactly this test."""
    monkeypatch.setattr(tf, "DTYPE", np.float64)
    yield


def test_gradient_matches_central_differences(f64):
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = Transformer(cfg, vocab, seed=3)
    rng = np.random.default_rng(11)
    idx = rng.integers(0, cfg.vocab_size, size=(2, cfg.context))
    tgt = rng.integers(0, cfg.vocab_size, size=(2, cfg.context))

    _, grads = model.loss_and_grads(idx, tgt)

    def loss_only(i, t):
        logits, _ = model.forward(i)
        p = tf._softmax(logits).reshape(-1, cfg.vocab_size)
        flat = t.reshape(-1)
        return float(-np.log(p[np.arange(flat.size), flat]).mean())

    eps = 1e-5
    worst: list[tuple[float, str]] = []
    for name, arr in model.params.items():
        assert arr.dtype == np.float64, f"{name} did not honour the patched dtype"
        flat = arr.ravel()
        # Deterministic spread of positions rather than a random sample: a test that checks different
        # entries on different runs is a test that fails on someone else's machine.
        picks = sorted({(k * 7919) % flat.size for k in range(1, 7)})
        for j in picks:
            keep = flat[j]
            flat[j] = keep + eps
            up = loss_only(idx, tgt)
            flat[j] = keep - eps
            down = loss_only(idx, tgt)
            flat[j] = keep
            numeric = (up - down) / (2 * eps)
            analytic = float(grads[name].ravel()[j])
            scale = max(1.0, abs(numeric), abs(analytic))
            worst.append((abs(numeric - analytic) / scale, f"{name}[{j}]"))

    err, where = max(worst)
    assert err < 1e-6, f"worst relative gradient error {err:.2e} at {where}"


def test_gradient_reaches_every_parameter(f64):
    """A zero gradient everywhere in a tensor is how an unwired parameter hides: the gradient check
    above passes on it, because zero equals zero."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = Transformer(cfg, vocab, seed=5)
    idx = np.array([[3, 4, 5, 6], [6, 5, 4, 3]])
    tgt = np.array([[4, 5, 6, 7], [5, 4, 3, 2]])
    _, grads = model.loss_and_grads(idx, tgt)
    assert set(grads) == set(model.params)
    for name, g in grads.items():
        if name == "pos":
            # Only the first `T` positions are used, and here T == context, so all of them are.
            g = g[: idx.shape[1]]
        if name == "tok":
            # Rows for ids that appear neither as input nor as target are genuinely untouched.
            used = sorted(set(idx.ravel()) | set(tgt.ravel()))
            g = g[used]
        assert np.abs(g).sum() > 0, f"{name} received no gradient at all"


def test_tied_embedding_gets_both_gradients(f64):
    """`tok` is the input embedding and the output projection. Dropping either contribution leaves a
    gradient that is plausible and wrong, and the sampled check can miss it."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = Transformer(cfg, vocab, seed=7)
    idx = np.array([[3, 3, 3, 3]])
    tgt = np.array([[4, 4, 4, 4]])
    _, grads = model.loss_and_grads(idx, tgt)
    # Row 3 only ever appears as an input, row 4 only as a target. Both must move.
    assert abs(grads["tok"][3]).sum() > 0
    assert abs(grads["tok"][4]).sum() > 0


def test_causal_mask_hides_the_future():
    vocab = tiny_vocab()
    model = Transformer(tiny_config(vocab), vocab, seed=1)
    a = np.array([[3, 4, 5, 6]])
    b = np.array([[3, 4, 5, 7]])
    la, _ = model.forward(a)
    lb, _ = model.forward(b)
    # Positions 0..2 cannot see position 3.
    assert np.allclose(la[0, :3], lb[0, :3], atol=1e-6)
    assert not np.allclose(la[0, 3], lb[0, 3], atol=1e-6)


def test_forward_refuses_a_sequence_longer_than_the_context():
    vocab = tiny_vocab()
    model = Transformer(tiny_config(vocab), vocab)
    with pytest.raises(ValueError, match="exceeds the context"):
        model.forward(np.zeros((1, 9), dtype=np.int64))


def test_config_rejects_shapes_that_cannot_work():
    with pytest.raises(ValueError, match="not divisible"):
        TransformerConfig(d_model=10, n_heads=4)
    with pytest.raises(ValueError, match="predicts nothing"):
        TransformerConfig(context=1)


def test_parameter_count_matches_the_arrays():
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = Transformer(cfg, vocab)
    assert sum(a.size for a in model.params.values()) == cfg.parameter_count()


def test_a_vocabulary_larger_than_the_config_is_refused():
    vocab = tiny_vocab(n_words=8)
    with pytest.raises(ValueError, match="exceeds vocab_size"):
        Transformer(tiny_config(vocab, vocab_size=len(vocab) - 1), vocab)


def test_logprob_terms_has_one_entry_per_predicted_token():
    vocab = tiny_vocab()
    model = Transformer(tiny_config(vocab), vocab, seed=2)
    ids = vocab.encode(["w0", "w1", "w2", "w3", "w4", "w5"])
    terms = model.logprob_terms(ids)
    # <s> w0 .. w5 </s> is 8 tokens, so 7 predictions.
    assert len(terms) == 7
    assert all(lp < 0 for lp, _ in terms)
    assert all(real for _, real in terms)


def test_logprob_terms_flags_unk_as_not_real():
    vocab = tiny_vocab()
    model = Transformer(tiny_config(vocab), vocab, seed=2)
    ids = vocab.encode(["w0", "nowhere", "w1"])
    flags = [real for _, real in model.logprob_terms(ids)]
    assert flags == [True, False, True, True]


def test_logprob_terms_spans_more_windows_than_the_context():
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = Transformer(cfg, vocab, seed=2)
    ids = vocab.encode(["w0"] * 20)
    terms = model.logprob_terms(ids)
    assert len(terms) == 21  # <s> + 20 + </s> is 22 tokens, 21 predictions
    assert model.perplexity(ids) > 1.0


def test_scoring_matches_the_kneser_ney_contract():
    """`evaluate` reads `logprob_terms` off both model classes and cannot know which it holds."""
    from adhd_analysis.text.budget import Budget
    from adhd_analysis.text.ngram import KneserNey, count_ngrams

    vocab = tiny_vocab()
    ids = vocab.encode(["w0", "w1", "w2"])
    table, kn_meta = count_ngrams(iter([ids, ids]), 2, Budget(), vocab)
    kn = KneserNey(order=2, vocab=vocab, counts=[{}, table], meta=kn_meta).seal()
    for model in (Transformer(tiny_config(vocab), vocab, seed=2), kn):
        terms = model.logprob_terms(ids)
        assert isinstance(terms, list)
        assert all(isinstance(lp, float) and isinstance(real, bool) for lp, real in terms)


def test_save_and_load_round_trips():
    vocab = tiny_vocab()
    model = Transformer(tiny_config(vocab), vocab, meta={"corpus": "tiny"}, seed=4)
    ids = vocab.encode(["w0", "w1", "w2", "w3"])
    before = model.perplexity(ids)
    path = model.save("/tmp/claude-0/tf-round-trip.tsv.gz")
    back = Transformer.load(path)
    assert back.config == model.config
    assert back.meta == {"corpus": "tiny"}
    assert back.vocab.itos == vocab.itos
    # Six significant figures per weight, so identical to well within a perplexity's meaning.
    assert back.perplexity(ids) == pytest.approx(before, rel=1e-4)


def test_load_refuses_a_file_that_is_not_a_model(tmp_path):
    import gzip

    bad = tmp_path / "not-a-model.tsv.gz"
    with gzip.open(bad, "wt", encoding="utf-8") as fh:
        fh.write('{"format": "adhd-kn-2"}\n')
    with pytest.raises(ValueError, match="not an adhd-tf-1 model"):
        Transformer.load(bad)


def test_load_stops_when_the_budget_stops_it():
    vocab = tiny_vocab()
    model = Transformer(tiny_config(vocab), vocab, seed=4)
    path = model.save("/tmp/claude-0/tf-budget.tsv.gz")
    spent = Budget(max_tokens=1)
    spent.spend(2)
    with pytest.raises(RuntimeError):
        Transformer.load(path, budget=spent)


def test_training_drives_the_loss_below_chance():
    """Not a claim about perplexity on held-out text. A model that cannot memorise four tokens has a
    wiring bug that the gradient check can miss, because the gradient can be right while the optimiser
    update has the sign wrong."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab)
    model = Transformer(cfg, vocab, seed=6)
    idx = np.array([[3, 4, 5, 6]])
    tgt = np.array([[4, 5, 6, 7]])
    chance = math.log(cfg.vocab_size)
    first, _ = model.loss_and_grads(idx, tgt)
    assert first == pytest.approx(chance, rel=0.2)
    opt = Adam(lr=1e-2)
    last = first
    for _ in range(400):
        last, grads = model.loss_and_grads(idx, tgt)
        opt.step(model.params, grads)
    assert last < chance / 4, f"loss went {first:.3f} -> {last:.3f}, chance is {chance:.3f}"


def test_adam_clips_the_global_norm():
    params = {"w": np.zeros(4, dtype=tf.DTYPE)}
    grads = {"w": np.full(4, 100.0, dtype=tf.DTYPE)}
    opt = Adam(lr=1.0, clip=1.0)
    reported = opt.step(params, grads)
    assert reported == pytest.approx(200.0, rel=1e-3)  # sqrt(4 * 100^2)
    # Clipped to unit norm, then Adam's own normalisation makes every step ~lr.
    assert np.all(np.abs(params["w"]) < 1.01)


def test_batches_are_contiguous_and_shifted_by_one():
    xs, ys = [], []
    for x, y in batches(iter(range(21)), context=4, batch_size=2):
        xs.append(x)
        ys.append(y)
    first = xs[0]
    assert first.shape == (2, 4)
    assert list(first[0]) == [0, 1, 2, 3]
    assert list(ys[0][0]) == [1, 2, 3, 4]
    # The next row starts where the last one ended, so no target is ever unreachable.
    assert list(first[1]) == [4, 5, 6, 7]
    assert list(ys[0][1]) == [5, 6, 7, 8]


def test_batches_yields_a_short_final_batch():
    got = list(batches(iter(range(11)), context=4, batch_size=8))
    assert len(got) == 1
    assert got[0][0].shape == (2, 4)


def test_specials_keep_the_ids_scoring_assumes():
    vocab = tiny_vocab()
    assert vocab.stoi[UNK] == 0 and vocab.stoi[BOS] == 1 and vocab.stoi[EOS] == 2


def test_array_batches_agrees_with_the_streaming_version():
    from adhd_analysis.text.transformer import array_batches

    ids = np.arange(45, dtype=np.int32)
    streamed = list(batches(iter(ids.tolist()), context=4, batch_size=3))
    arrayed = list(array_batches(ids, context=4, batch_size=3))
    assert len(streamed) == len(arrayed)
    for (sx, sy), (ax, ay) in zip(streamed, arrayed):
        assert np.array_equal(sx, ax)
        assert np.array_equal(sy, ay)


def test_array_batches_does_not_run_off_the_end():
    from adhd_analysis.text.transformer import array_batches

    ids = np.arange(9, dtype=np.int32)
    got = list(array_batches(ids, context=4, batch_size=8))
    assert len(got) == 1
    assert got[0][0].shape == (2, 4)
    assert list(got[0][1][-1]) == [5, 6, 7, 8]


def test_no_scored_position_is_starved_of_context():
    """The property the strided window exists to guarantee, checked by recording what the model was
    actually shown.

    The non-overlapping version starved one position in every `context`: the token on a window boundary
    was predicted from the single token before it, when the model could have had the whole window.
    `KneserNey` slides an order-4 window continuously and never has a starved position, so that bias
    ran one way in the comparison E6 exists to make.

    Deliberately not a test that overlapping scores better. At toy scale the direction is noise — the
    same untrained model reverses it between a fixture whose period divides `context` and one whose
    period does not, because learned positional embeddings make the score depend on window alignment.
    A test that asserted a direction here would be asserting a hope. The size of the effect belongs to
    a measurement on a real model, recorded with the E6 result.
    """
    vocab = tiny_vocab()
    cfg = tiny_config(vocab, context=8)
    model = Transformer(cfg, vocab, seed=9)
    stride = cfg.context // 2

    seen: list[int] = []
    real = model.forward

    def spy(idx):
        seen.append(int(idx.shape[1]))
        return real(idx)

    model.forward = spy  # type: ignore[method-assign]
    ids = vocab.encode(["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"] * 5)
    terms = model.logprob_terms(ids)

    assert len(terms) == len(ids) + 1
    # Every window after the first is full width, so its final stride of targets each sit behind at
    # least `context - stride` tokens of context.
    assert seen[0] <= cfg.context
    assert all(w == cfg.context for w in seen[1:]), seen
    assert all(w >= stride for w in seen), seen
    # And the windows overlap rather than tile: tiling 42 targets at width 8 needs 6 passes, striding
    # needs about twice that.
    assert len(seen) >= (len(ids) + 1) // stride, seen


def test_a_sequence_inside_the_context_is_scored_in_one_pass():
    """No windowing at all when none is needed. A strided loop that still splits a short sequence is a
    loop whose first window is computed wrongly."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab, context=32)
    model = Transformer(cfg, vocab, seed=2)
    seen: list[int] = []
    real = model.forward
    model.forward = lambda idx: (seen.append(int(idx.shape[1])), real(idx))[1]  # type: ignore[method-assign]
    ids = vocab.encode(["w0", "w1", "w2", "w3"])
    assert len(model.logprob_terms(ids)) == 5
    assert len(seen) == 1, seen


def test_scoring_emits_one_term_per_target_at_every_length():
    """Off-by-one in a strided window is silent: it drops or duplicates a position and the perplexity
    still looks like a perplexity."""
    vocab = tiny_vocab()
    cfg = tiny_config(vocab, context=8)
    model = Transformer(cfg, vocab, seed=1)
    for n in (1, 2, 3, 7, 8, 9, 12, 16, 17, 31, 40):
        ids = vocab.encode(["w0"] * n)
        assert len(model.logprob_terms(ids)) == n + 1, f"length {n}"


def test_scoring_is_deterministic():
    vocab = tiny_vocab()
    model = Transformer(tiny_config(vocab, context=8), vocab, seed=3)
    ids = vocab.encode(["w0", "w1", "w2"] * 7)
    assert model.logprob_terms(ids) == model.logprob_terms(ids)
