"""The transformer trainer, and the two things about it that are easy to report wrongly.

The first is the split: the same `in_sample_refusal` that guards the n-gram has to guard this, and it
reads a metadata field the trainer has to remember to write. The second is how much text the run saw.
A transformer on this machine stops on a compute ceiling, not at the end of the corpus, so a record
that says "trained on the corpus" when it saw a twentieth of it is the same class of mistake as a
truncated perplexity reporting itself as a finished one.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from adhd_analysis.text.budget import Budget
from adhd_analysis.text.corpora import Library, Source
from adhd_analysis.text.evaluate import SplitLibrary, evaluate, in_sample_refusal
from adhd_analysis.text.train_transformer import cosine_schedule, train_transformer
from adhd_analysis.text.transformer import Transformer, TransformerConfig


def _library(tmp_path: Path, n: int = 40) -> Library:
    d = tmp_path / "docs"
    d.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        body = " ".join(f"the critic prunes artifact {i} under objection ." for _ in range(20))
        if i == 0:
            body += " zqxwv zqxwv zqxwv zqxwv ."
        (d / f"doc{i:03d}.txt").write_text(body + "\n")
    return Library([Source(name="toy", path=d, include=["*.txt"])])


def _cfg(**over) -> TransformerConfig:
    kw = dict(vocab_size=64, d_model=16, n_heads=2, n_layers=1, context=8, d_ff=32)
    kw.update(over)
    return TransformerConfig(**kw)


def test_training_produces_a_loadable_model_and_a_record(tmp_path):
    lib = _library(tmp_path)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"),
        tmp_path / "m.tf.gz",
        _cfg(),
        Budget.smoke(),
        epochs=0.2,
        batch_size=4,
    )
    assert rec.steps > 0
    assert rec.model_path.exists()
    model = Transformer.load(rec.model_path)
    assert model.config == _cfg()
    assert rec.vocab_size == len(model.vocab)
    assert rec.tokens_seen == rec.steps * 4 * 8


def test_the_vocabulary_comes_from_the_training_side_only(tmp_path):
    """The same probe `test_heldout.py` uses, because the leak does not care which model class it is."""
    lib = _library(tmp_path)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"), tmp_path / "m.tf.gz", _cfg(), Budget.smoke(), epochs=0.1, batch_size=4
    )
    model = Transformer.load(rec.model_path)
    assert "critic" in model.vocab.stoi
    assert "zqxwv" not in model.vocab.stoi, "the vocabulary was built over the held-out half too"


def test_the_record_names_which_side_it_trained_on(tmp_path):
    lib = _library(tmp_path)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"), tmp_path / "m.tf.gz", _cfg(), Budget.smoke(), epochs=0.1, batch_size=4
    )
    assert rec.split == {"every": 10, "side": "train"}
    model = Transformer.load(rec.model_path)
    # The refusal machinery reads this off the model, so it has to survive the round trip.
    assert in_sample_refusal(model, SplitLibrary(lib, every=10, side="heldout")) is None
    assert in_sample_refusal(model, SplitLibrary(lib, every=10, side="train")) is not None


def test_evaluate_scores_a_transformer_with_no_special_case(tmp_path):
    lib = _library(tmp_path)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"), tmp_path / "m.tf.gz", _cfg(), Budget.smoke(), epochs=0.3, batch_size=4
    )
    model = Transformer.load(rec.model_path)
    held = evaluate(model, SplitLibrary(lib, every=10, side="heldout"), Budget.smoke())
    assert math.isfinite(held.perplexity)
    assert held.perplexity > 1.0
    assert held.documents == 4
    assert held.fingerprint


def test_the_corpus_read_does_not_spend_the_training_ceiling(tmp_path):
    """Sharing one budget between the corpus read and the optimiser leaves the token ceiling already
    exceeded before the first gradient step, and the run reports zero steps under a reason that reads
    like a training limit."""
    lib = _library(tmp_path, n=40)
    tight = Budget(max_tokens=30_000, max_seconds=60.0, max_rss_mb=2048, check_every=1000)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"), tmp_path / "m.tf.gz", _cfg(), tight, epochs=1.0, batch_size=4
    )
    assert rec.steps > 0, "the corpus read consumed the training budget"
    assert rec.budget_corpus["tokens"] > 0
    assert rec.budget_training["tokens"] <= rec.tokens_seen


def test_a_ceiling_that_binds_is_named_in_the_record(tmp_path):
    lib = _library(tmp_path, n=40)
    stingy = Budget(max_tokens=2_000, max_seconds=60.0, max_rss_mb=2048, check_every=1)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"), tmp_path / "m.tf.gz", _cfg(), stingy, epochs=10.0, batch_size=4
    )
    assert rec.stopped_because != "epochs"
    assert "ceiling" in rec.stopped_because
    assert rec.epochs_completed < 10.0


def test_a_run_that_finishes_its_schedule_says_epochs(tmp_path):
    lib = _library(tmp_path, n=40)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"),
        tmp_path / "m.tf.gz",
        _cfg(),
        Budget(max_tokens=10_000_000, max_seconds=120.0, max_rss_mb=4096),
        epochs=0.2,
        batch_size=4,
    )
    assert rec.stopped_because == "epochs"
    assert rec.epochs_completed == pytest.approx(0.2, abs=0.05)


def test_the_loss_curve_falls(tmp_path):
    lib = _library(tmp_path, n=40)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"),
        tmp_path / "m.tf.gz",
        _cfg(),
        Budget(max_tokens=10_000_000, max_seconds=180.0, max_rss_mb=4096),
        epochs=2.0,
        batch_size=8,
        lr=3e-3,
        warmup=20,
    )
    assert len(rec.loss_curve) >= 5
    assert rec.final_loss < rec.loss_curve[0], f"loss curve {rec.loss_curve}"


def test_max_train_tokens_caps_the_materialised_array(tmp_path):
    lib = _library(tmp_path, n=40)
    rec = train_transformer(
        SplitLibrary(lib, every=10, side="train"),
        tmp_path / "m.tf.gz",
        _cfg(),
        Budget.smoke(),
        epochs=0.1,
        batch_size=4,
        max_train_tokens=5_000,
    )
    assert rec.train_tokens < 5_000 + 200  # the cap binds at a sentence boundary, not mid-sentence


def test_an_empty_corpus_fails_loudly(tmp_path):
    empty = tmp_path / "nothing"
    empty.mkdir()
    lib = Library([Source(name="toy", path=empty, include=["*.txt"])])
    with pytest.raises(ValueError, match="no tokens"):
        train_transformer(lib, tmp_path / "m.tf.gz", _cfg(), Budget.smoke())


def test_a_corpus_shorter_than_the_context_fails_loudly(tmp_path):
    d = tmp_path / "tiny"
    d.mkdir()
    (d / "a.txt").write_text("one two three .\n")
    lib = Library([Source(name="toy", path=d, include=["*.txt"])])
    with pytest.raises(ValueError, match="too few for a context"):
        train_transformer(lib, tmp_path / "m.tf.gz", _cfg(context=64), Budget.smoke())


def test_the_schedule_warms_up_then_decays():
    lr = 1e-3
    assert cosine_schedule(0, 1000, lr, 100) == pytest.approx(lr / 100)
    assert cosine_schedule(99, 1000, lr, 100) == pytest.approx(lr)
    mid = cosine_schedule(550, 1000, lr, 100)
    assert lr * 0.1 < mid < lr
    assert cosine_schedule(999, 1000, lr, 100) == pytest.approx(lr * 0.1, rel=0.05)
    # A schedule shorter than its own warmup must not divide by zero or go negative.
    assert cosine_schedule(5, 10, lr, 100) > 0
    assert cosine_schedule(5, 5, lr, 5) == pytest.approx(lr)


def test_progress_writes_to_stderr_and_can_be_silenced(tmp_path, capsys):
    """stderr, not stdout: stdout carries the record's JSON and a caller pipes it."""
    lib = _library(tmp_path, n=40)
    kw = dict(
        out=tmp_path / "m.tf.gz",
        config=_cfg(),
        budget=Budget(max_tokens=10_000_000, max_seconds=120.0, max_rss_mb=4096),
        epochs=0.3,
        batch_size=4,
    )
    train_transformer(SplitLibrary(lib, every=10, side="train"), **kw, progress=2)
    noisy = capsys.readouterr()
    assert "step " in noisy.err and "tok/s" in noisy.err
    assert noisy.out == ""

    train_transformer(SplitLibrary(lib, every=10, side="train"), **kw, progress=0)
    assert capsys.readouterr().err == ""
