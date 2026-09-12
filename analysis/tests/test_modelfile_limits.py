"""What a model file may ask for, pinned by the attacks that used to work.

Both loaders parse a gzip file into memory. That file is untrusted input even though nobody expects
it to be: the weekly job restores a model from a CI cache, `scripts/score_heldout.py` takes a path on
the command line, and a cache is something anyone who can open a pull request can write to.

Every test here was a working attack before the fix, and the numbers in them were measured on this
machine rather than imagined.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

from adhd_analysis.text.budget import Budget
from adhd_analysis.text.modelfile import MAX_HEADER_BYTES, ModelFileRefused, bounded_int
from adhd_analysis.text.ngram import KneserNey
from adhd_analysis.text.transformer import Transformer, TransformerConfig
from adhd_analysis.text.tokenize import Vocab
from collections import Counter


def write(path: Path, *lines: str) -> Path:
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        for line in lines:
            fh.write(line + "\n")
    return path


def test_a_transformer_file_cannot_ask_for_more_memory_than_the_ceiling(tmp_path):
    """Measured: a **187-byte** file declaring `vocab_size: 200000000` and `d_model: 512` asks for a
    **409.6GB** allocation, and `load` performed it before reaching the budget check that sat in the
    loop underneath. A ceiling consulted after the allocation is a ceiling that observes the crash."""
    p = write(
        tmp_path / "huge.tf.gz",
        json.dumps({"format": "adhd-tf-1", "meta": {},
                    "config": {"vocab_size": 8_000_000, "d_model": 512, "n_heads": 4, "n_layers": 2,
                               "context": 64, "d_ff": 512, "init_std": 0.02}}),
        json.dumps({"itos": ["<unk>", "<s>", "</s>"], "min_count": 2}),
    )
    assert p.stat().st_size < 1024, "the fixture should be tiny; that is the point"
    with pytest.raises(ModelFileRefused, match="against a ceiling"):
        Transformer.load(p, Budget(max_rss_mb=2048))


def test_a_transformer_file_cannot_declare_absurd_dimensions(tmp_path):
    p = write(
        tmp_path / "absurd.tf.gz",
        json.dumps({"format": "adhd-tf-1", "meta": {},
                    "config": {"vocab_size": 200_000_000, "d_model": 512, "n_heads": 4, "n_layers": 2,
                               "context": 64, "d_ff": 512, "init_std": 0.02}}),
        json.dumps({"itos": ["<unk>"], "min_count": 2}),
    )
    with pytest.raises(ModelFileRefused, match="unusable config"):
        Transformer.load(p)


def test_a_header_line_cannot_be_a_decompression_bomb(tmp_path):
    """Measured: **199KB of gzip expands to 200MB on a single `readline()`**, returned in 1.4
    seconds, before either loader's format check had run. The header is the first thing read and was
    the last thing bounded."""
    p = tmp_path / "bomb.kn.gz"
    with gzip.open(p, "wt", encoding="utf-8", compresslevel=9) as fh:
        fh.write("A" * (MAX_HEADER_BYTES + 1024))
    assert p.stat().st_size < 200_000, "the fixture should compress small; that is the attack"
    with pytest.raises(ModelFileRefused, match="exceeds"):
        KneserNey.load(p)
    with pytest.raises(ModelFileRefused, match="exceeds"):
        Transformer.load(p)


def test_an_ngram_order_cannot_size_a_list_from_the_file(tmp_path):
    """Measured: a **120-byte** file declaring `order: 50000000` built a fifty-million-entry list in
    **111 seconds**, because the order sized the list before a single count was read."""
    p = write(
        tmp_path / "order.kn.gz",
        json.dumps({"format": "adhd-kn-1", "order": 50_000_000, "meta": {}}),
        json.dumps({"itos": ["<unk>", "<s>", "</s>"], "min_count": 2}),
    )
    assert p.stat().st_size < 1024
    with pytest.raises(ModelFileRefused, match="order is 50,000,000"):
        KneserNey.load(p)


def test_a_negative_order_cannot_write_into_the_top_table(tmp_path):
    """Python indexes lists from the end on a negative, so `counts[-1]` is the *top* order — a slot
    the format cannot address, landing exactly where the model is read from. Demonstrated before the
    fix: a line reading `-1` loaded without complaint and appeared in `counts[order - 1]`."""
    p = write(
        tmp_path / "neg.kn.gz",
        json.dumps({"format": "adhd-kn-1", "order": 2, "meta": {}}),
        json.dumps({"itos": ["<unk>", "<s>", "</s>", "a"], "min_count": 2}),
        "-1\t3,3\t999999",
    )
    with pytest.raises(ModelFileRefused, match="order is -1"):
        KneserNey.load(p)


def test_an_ngram_cannot_name_a_token_outside_the_vocabulary(tmp_path):
    p = write(
        tmp_path / "oob.kn.gz",
        json.dumps({"format": "adhd-kn-1", "order": 2, "meta": {}}),
        json.dumps({"itos": ["<unk>", "<s>", "</s>", "a"], "min_count": 2}),
        "1\t3,99999\t4",
    )
    with pytest.raises(ModelFileRefused, match="outside the vocabulary"):
        KneserNey.load(p)


def test_an_ngram_must_have_as_many_ids_as_its_order(tmp_path):
    p = write(
        tmp_path / "wrong-arity.kn.gz",
        json.dumps({"format": "adhd-kn-1", "order": 3, "meta": {}}),
        json.dumps({"itos": ["<unk>", "<s>", "</s>", "a"], "min_count": 2}),
        "2\t3,3\t4",
    )
    with pytest.raises(ModelFileRefused, match="filed under order"):
        KneserNey.load(p)


def test_a_transformer_parameter_must_match_the_architecture(tmp_path):
    """A tensor whose shape disagrees with the config used to be reshaped into whatever the file said,
    silently replacing a parameter with one of a different shape."""
    vocab = Vocab.build(Counter({f"w{i}": 9 - i for i in range(6)}), min_count=1)
    cfg = TransformerConfig(vocab_size=len(vocab), d_model=8, n_heads=2, n_layers=1, context=4, d_ff=16)
    good = Transformer(cfg, vocab, seed=1).save(tmp_path / "ok.tf.gz")
    Transformer.load(good)  # the round trip still works

    with gzip.open(good, "rt", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    bent = [line if not line.startswith("pos\t") else "pos\t2,8\t" + ",".join(["0.1"] * 16) for line in lines]
    p = write(tmp_path / "bent.tf.gz", *bent)
    with pytest.raises(ModelFileRefused, match="this architecture needs"):
        Transformer.load(p)


def test_a_transformer_file_must_carry_every_parameter(tmp_path):
    vocab = Vocab.build(Counter({f"w{i}": 9 - i for i in range(6)}), min_count=1)
    cfg = TransformerConfig(vocab_size=len(vocab), d_model=8, n_heads=2, n_layers=1, context=4, d_ff=16)
    good = Transformer(cfg, vocab, seed=1).save(tmp_path / "ok.tf.gz")
    with gzip.open(good, "rt", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    p = write(tmp_path / "short.tf.gz", *[line for line in lines if not line.startswith("ln_f.g\t")])
    with pytest.raises(ModelFileRefused, match="parameters missing"):
        Transformer.load(p)


def test_an_unknown_parameter_name_is_refused(tmp_path):
    vocab = Vocab.build(Counter({f"w{i}": 9 - i for i in range(6)}), min_count=1)
    cfg = TransformerConfig(vocab_size=len(vocab), d_model=8, n_heads=2, n_layers=1, context=4, d_ff=16)
    good = Transformer(cfg, vocab, seed=1).save(tmp_path / "ok.tf.gz")
    with gzip.open(good, "rt", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    p = write(tmp_path / "extra.tf.gz", *lines, "b9.qkv\t2,2\t1,2,3,4")
    with pytest.raises(ModelFileRefused, match="unknown parameter"):
        Transformer.load(p)


def test_bounded_int_refuses_a_bool(tmp_path):
    """`bool` is an `int` subclass in Python, so `order: true` would otherwise arrive as 1 and pass a
    range check that starts at 1."""
    with pytest.raises(ModelFileRefused, match="expected an integer"):
        bounded_int(True, "order", 1, 12, tmp_path / "x")
    assert bounded_int(4, "order", 2, 12, tmp_path / "x") == 4


def test_a_header_that_is_not_an_object_is_refused(tmp_path):
    p = write(tmp_path / "list.kn.gz", json.dumps([1, 2, 3]), json.dumps({"itos": []}))
    with pytest.raises(ModelFileRefused, match="expected an object"):
        KneserNey.load(p)


def test_an_empty_file_is_refused(tmp_path):
    p = tmp_path / "empty.kn.gz"
    with gzip.open(p, "wt", encoding="utf-8"):
        pass
    with pytest.raises(ModelFileRefused, match="empty or truncated"):
        KneserNey.load(p)


def test_real_models_still_round_trip(tmp_path):
    """The bound has to admit what the repository actually produces, or it is a denial of service with
    a security rationale."""
    vocab = Vocab.build(Counter({f"w{i}": 30 - i for i in range(20)}), min_count=1)
    cfg = TransformerConfig(vocab_size=len(vocab), d_model=16, n_heads=2, n_layers=2, context=8, d_ff=32)
    model = Transformer(cfg, vocab, meta={"corpus": "toy"}, seed=2)
    ids = vocab.encode(["w0", "w1", "w2", "w3"])
    before = model.perplexity(ids)
    back = Transformer.load(model.save(tmp_path / "rt.tf.gz"))
    assert back.perplexity(ids) == pytest.approx(before, rel=1e-4)
    assert back.meta == {"corpus": "toy"}
