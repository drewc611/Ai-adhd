"""The ceiling, the manifest, and one real training run over the repository's own prose.

The end-to-end test trains on `docs/` rather than on a fabricated fixture. A pipeline that works
on generated sentences and falls over on real markdown has not been tested, and markdown is what
this will actually be pointed at.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from adhd_analysis.text.budget import Budget, BudgetExceeded
from adhd_analysis.text.corpora import CorpusError, Library, Source
from adhd_analysis.text.ngram import KneserNey
from adhd_analysis.text.train import train

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "analysis" / "corpora.yaml"


def test_each_ceiling_refuses_and_names_itself():
    b = Budget(max_tokens=1000, max_seconds=999, max_ngrams=500, max_rss_mb=99999, check_every=10)
    b.spend(1001)
    assert not b.allows()
    assert "token ceiling" in b.stopped_because

    b = Budget(max_tokens=10**9, max_seconds=999, max_ngrams=50, max_rss_mb=99999, check_every=10)
    b.spend(100)
    assert not b.allows(ngrams=51)
    assert "n-gram ceiling" in b.stopped_because

    b = Budget(max_tokens=10**9, max_seconds=0.0, max_ngrams=10**9, max_rss_mb=99999, check_every=1)
    b.spend(5)
    assert not b.allows()
    assert "wall clock" in b.stopped_because

    b = Budget(max_tokens=10**9, max_seconds=999, max_ngrams=10**9, max_rss_mb=1, check_every=1)
    b.spend(5)
    assert not b.allows()
    assert "resident set" in b.stopped_because


def test_relieve_clears_a_size_refusal_and_cannot_clear_a_real_one():
    """Pruning the n-gram table genuinely resolves the size ceiling, so `relieve` lets the read
    continue. It must not be able to buy back wall-clock time, which `allows` re-derives."""
    b = Budget(max_tokens=10**9, max_seconds=10**6, max_ngrams=10, max_rss_mb=10**6, check_every=10**6)
    b.spend(1)
    assert not b.allows(ngrams=11)
    b.relieve()
    assert b.allows(ngrams=5)

    b = Budget(max_tokens=10**9, max_seconds=0.0, max_ngrams=10**9, max_rss_mb=10**6, check_every=1)
    b.spend(1)
    assert not b.allows()
    b.relieve()
    assert not b.allows(), "a cleared wall-clock refusal must be re-derived on the next call"


def test_require_raises_for_callers_that_cannot_degrade():
    b = Budget(max_tokens=1, max_seconds=999, max_ngrams=10**9, max_rss_mb=10**6)
    b.spend(2)
    with pytest.raises(BudgetExceeded, match="token ceiling"):
        b.require("second pass")


def test_restart_keeps_the_ceilings_and_drops_the_counters():
    b = Budget.weekly()
    b.spend(1_000_000)
    time.sleep(0.01)
    fresh = b.restart()
    assert fresh.tokens == 0 and fresh.elapsed < b.elapsed
    assert (fresh.max_tokens, fresh.max_ngrams, fresh.max_rss_mb) == (b.max_tokens, b.max_ngrams, b.max_rss_mb)


def test_a_manifest_naming_a_missing_path_fails_loudly():
    """A corpus that silently resolves to zero files trains a model on the remainder and reports a
    perplexity that looks like a result. `required: false` is the only way to opt out."""
    s = Source(name="gone", path=Path("/nonexistent/corpus"))
    with pytest.raises(CorpusError, match="does not exist"):
        list(s.files())

    optional = Source(name="gone", path=Path("/nonexistent/corpus"), required=False)
    assert list(optional.files()) == []


def test_the_shipped_manifest_trains_on_a_clean_checkout(tmp_path):
    """The first three entries are the repository's own prose, so `pip install && train` works with
    nothing configured. If this fails, a new contributor's first run of the weekly job fails too.

    The `rfc` entry is `required: false` and is empty until `scripts/fetch_corpus.py` has run, so
    this asserts the checked-in sources have files and that an optional absent one contributes zero
    without stopping the load. Asserting every source is non-empty is what a clean CI checkout
    fails on, and it fails there rather than on a laptop where the corpus happens to exist.
    """
    lib = Library.load(MANIFEST)
    described = lib.describe()
    always = [d for d in described if d["name"] in {"repo-docs", "repo-prompts", "repo-readme"}]
    assert [d["name"] for d in always] == ["repo-docs", "repo-prompts", "repo-readme"]
    assert all(d["files"] > 0 for d in always), always

    optional = {d["name"]: d for d in described} .get("rfc")
    assert optional is not None, "the manifest no longer declares the fetched corpus"
    assert optional["files"] >= 0

    rec = train(lib, tmp_path / "bg.kn.gz", order=3, min_count=2, budget=Budget.smoke())
    assert rec.vocab_size > 500
    assert rec.tokens_seen > 20_000
    assert rec.model_path.exists()

    m = KneserNey.load(rec.model_path)
    total = sum(m.prob((), w) for w in range(len(m.vocab)))
    assert abs(total - 1.0) < 1e-9, "a model trained on real markdown must still be a distribution"


def test_a_budget_that_stops_the_read_still_produces_a_sealed_model(tmp_path):
    """The reason the ceiling is an object the trainer consults rather than a timeout around it.

    A refused read seals what it has. A killed process has nothing, and a weekly job that produces
    nothing on the week the corpus grew looks like flake rather than like a ceiling.
    """
    tight = Budget(max_tokens=3000, max_seconds=120, max_ngrams=10**9, max_rss_mb=10**6, check_every=500)
    rec = train(Library.load(MANIFEST), tmp_path / "tiny.kn.gz", order=3, min_count=1, budget=tight)
    assert rec.budget_pass1["stopped_because"] is not None
    assert "token ceiling" in rec.budget_pass1["stopped_because"]
    assert rec.model_path.exists()
    m = KneserNey.load(rec.model_path)
    assert abs(sum(m.prob((), w) for w in range(len(m.vocab))) - 1.0) < 1e-9


def test_both_passes_read_the_same_prefix_of_the_corpus(tmp_path):
    """Files are globbed in sorted order and both passes get the same ceiling, so a truncated read
    truncates identically. If it did not, pass two would count n-grams over words pass one never
    saw, the `<unk>` rate would climb through training, and perplexity would improve the less of
    the corpus the model read."""
    tight = Budget(max_tokens=6000, max_seconds=120, max_ngrams=10**9, max_rss_mb=10**6, check_every=500)
    rec = train(Library.load(MANIFEST), tmp_path / "t.kn.gz", order=3, min_count=1, budget=tight)
    assert rec.budget_pass2["tokens"] == rec.budget_pass1["tokens"]
    assert rec.oov_rate == 0.0, "min_count=1 over the same prefix leaves nothing out of vocabulary"
