"""The split, and the leak it exists to prevent.

A held-out perplexity is only worth quoting if the model never saw the documents it is scored on,
and the way that quietly stops being true is the vocabulary: build it over everything, evaluate on
part of it, and the model has been handed every word it is about to be tested on. The number then
improves for a reason that has nothing to do with the model.

So the load-bearing test here is not that perplexity is finite. It is that a word appearing only
in the held-out half is out of vocabulary.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from adhd_analysis.text.budget import Budget
from adhd_analysis.text.corpora import Library, Source
from adhd_analysis.text.evaluate import (
    SplitLibrary,
    compare_orders,
    evaluate,
    in_sample_refusal,
    report,
)
from adhd_analysis.text.ngram import KneserNey
from adhd_analysis.text.train import train

ROOT = Path(__file__).resolve().parents[2]


def _library(tmp_path: Path, n: int = 60) -> Library:
    """`n` documents of ordinary prose, plus one word that lives only in a held-out document.

    Document 0 is held out at every stride, so `zqxwv` is the probe: a train-half vocabulary that
    contains it has been built over the whole corpus.
    """
    d = tmp_path / "docs"
    d.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        # Each document's text is unique. Repeating it every seventh file would put identical
        # strings on both sides of a stride-10 split and make the disjointness check below fail
        # on the fixture rather than on the code.
        body = " ".join(f"the critic prunes artifact {i} under objection ." for _ in range(20))
        if i == 0:
            body += " zqxwv zqxwv zqxwv ."
        (d / f"doc{i:03d}.txt").write_text(body + "\n")
    return Library([Source(name="toy", path=d, include=["*.txt"])])


def test_the_split_partitions_the_corpus_exactly_once(tmp_path):
    lib = _library(tmp_path, n=60)
    train_docs = [t for _n, t in SplitLibrary(lib, every=10, side="train").documents()]
    held_docs = [t for _n, t in SplitLibrary(lib, every=10, side="heldout").documents()]
    everything = [t for _n, t in lib.documents()]

    assert len(train_docs) + len(held_docs) == len(everything), "the split lost or duplicated a document"
    assert len(held_docs) == 6, "a stride of 10 over 60 documents should hold out 6"
    assert not (set(train_docs) & set(held_docs)), "a document is on both sides"


def test_a_word_only_in_the_heldout_half_is_out_of_vocabulary(tmp_path):
    """The leak this module exists to prevent, stated as the one assertion that catches it."""
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    assert "critic" in model.vocab.stoi, "the training half produced no vocabulary"
    assert "zqxwv" not in model.vocab.stoi, "the vocabulary was built over the held-out half too"

    held = evaluate(model, SplitLibrary(lib, every=10, side="heldout"), Budget.smoke())
    assert held.documents == 6
    assert held.oov_rate > 0, "a held-out OOV rate of zero means the split leaked"
    assert held.perplexity > 1.0


def test_a_stride_below_two_is_refused(tmp_path):
    lib = _library(tmp_path, n=10)
    with pytest.raises(ValueError, match="leaves one side empty"):
        SplitLibrary(lib, every=1, side="train")
    with pytest.raises(ValueError, match="side must be"):
        SplitLibrary(lib, every=10, side="test")


def test_held_out_is_harder_than_what_the_model_memorised(tmp_path):
    """A model always fits its own training data better. If it does not, the split is not a split.

    Deliberately weak as an inequality and strong as a check: the two numbers being equal, or the
    held-out one being lower, means the evaluation is scoring text the model was trained on.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    # `allow_in_sample` because scoring the training side is the whole point here. Everywhere else
    # it is refused, which is what this test was asserting at the unit level while two published
    # figures did it anyway.
    seen = evaluate(model, SplitLibrary(lib, every=10, side="train"), Budget.smoke(), allow_in_sample=True)
    unseen = evaluate(model, SplitLibrary(lib, every=10, side="heldout"), Budget.smoke())
    assert unseen.perplexity > seen.perplexity


def test_comparing_orders_uses_one_split_and_one_ceiling_each(tmp_path):
    """The comparison is between orders, so everything else has to be held constant.

    Sharing a budget across orders would give the first the whole corpus and the last whatever was
    left, and the table would be a comparison of corpus sizes wearing order labels.
    """
    lib = _library(tmp_path, n=80)
    results = compare_orders(lib, [2, 3], str(tmp_path / "orders"), every=10, min_count=1, budget=Budget.smoke())

    assert [r.order for r in results] == [2, 3]
    seen = {r.record.tokens_seen for r in results}
    assert len(seen) == 1, f"the orders read different amounts of corpus: {seen}"
    held = {r.held.tokens for r in results}
    assert len(held) == 1, f"the orders were scored on different held-out text: {held}"
    assert results[1].record.ngrams >= results[0].record.ngrams, "a higher order has no more contexts"

    text = report(results)
    assert "Held-out perplexity by order" in text
    assert "order 2 -> 3" in text, "the report does not state the cost of the increment"


def test_loading_a_model_is_under_the_ceiling_too(tmp_path):
    """The gap the order comparison found in this module's own first real run.

    `Budget` governed reading a corpus and counting n-grams, and nothing about loading the result.
    A model trained under a 9.5GB ceiling was then loaded into a process that reached 11.9GB,
    because the table is rebuilt in memory and nobody was watching that path.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())

    # No ceiling passed: loads, as it always did.
    assert KneserNey.load(rec.model_path) is not None

    # A ceiling already breached: refused rather than loaded anyway. `check_every` is 1 so the
    # first batch boundary is the first check, and 1MB is under any interpreter's resident set.
    tight = Budget(max_tokens=10**9, max_seconds=10**6, max_ngrams=10**9, max_rss_mb=1, check_every=1)
    tight.touch()
    assert not tight.allows(), "the fixture ceiling did not bite, so the next assertion proves nothing"


def test_touch_forces_a_check_without_charging_tokens():
    """`spend(0)` never advances the counter, so the periodic checks would never fire on a load."""
    b = Budget(max_tokens=10**9, max_seconds=0.0, max_ngrams=10**9, max_rss_mb=10**6, check_every=5000)
    b.spend(0)
    assert b.allows(), "a zero-token spend should not have triggered the periodic check"
    b.touch()
    assert not b.allows() and "wall clock" in b.stopped_because
    assert b.tokens == 0, "touch charged tokens it did not spend"


def test_orders_scored_on_different_text_are_refused_a_ranking(tmp_path):
    """The defect the first real order comparison shipped with, caught by its own output.

    Scoring is deeper per token at a higher order, so a wall-clock ceiling shared with training
    truncated order 5's evaluation and not order 3's. The table then showed identical vocabularies
    and different OOV rates, which is impossible on one held-out set, and named a best order from
    numbers about three different slices of text.
    """
    from adhd_analysis.text.evaluate import OrderResult, comparable

    lib = _library(tmp_path, n=40)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    full = evaluate(KneserNey.load(rec.model_path), SplitLibrary(lib, every=10, side="heldout"), Budget.smoke())
    short = replace(full, tokens=full.tokens // 2)

    same = [OrderResult(3, rec, full), OrderResult(4, rec, full)]
    assert comparable(same) is None
    assert "Best held-out perplexity" in report(same)

    mixed = [OrderResult(3, rec, full), OrderResult(4, rec, short)]
    assert "different held-out text" in (comparable(mixed) or "")
    text = report(mixed)
    assert "cannot be ranked" in text
    assert "Best held-out perplexity" not in text, "a ranking was printed over incomparable rows"

    truncated = [OrderResult(3, rec, full), OrderResult(4, rec, full, truncated="wall clock: 5s >= 5s")]
    assert "truncated" in (comparable(truncated) or "")


def test_a_heldout_number_carries_the_identity_of_the_text_it_was_scored_on(tmp_path):
    """Two perplexities from different held-out sets are two numbers about two different tests.

    The repository nearly published exactly that mistake: 38.6 on 1,974 RFCs against 17.4 on 6,067
    mixed documents, read as the model improving. The explanation recorded at the time — that the
    added sources were more formulaic — was wrong, and D16 has the real one: 38.6 was measured out of
    sample and 17.4 was not. The fingerprint is still the right mechanism and is still carried rather
    than derived at comparison time; only the incident that motivated it was misdiagnosed.
    """
    from adhd_analysis.text.evaluate import comparable_heldout

    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    held = SplitLibrary(lib, every=10, side="heldout")
    first = evaluate(model, held, Budget.smoke())
    again = evaluate(model, held, Budget.smoke())
    assert first.fingerprint and len(first.fingerprint) == 16
    assert first.fingerprint == again.fingerprint, "the same held-out set fingerprinted differently"
    assert comparable_heldout(first, again) is None

    # A different stride is a different set of documents, so the numbers stop being comparable even
    # though the corpus and the model did not change. `allow_in_sample` because a stride-7 held-out
    # set overlaps a stride-10 training half — documents where i%7==0 and i%10!=0 are in both — so
    # this number is partly a memorisation score. It is here for its fingerprint and not its value,
    # and the refusal was right to point that out.
    other = evaluate(model, SplitLibrary(lib, every=7, side="heldout"), Budget.smoke(), allow_in_sample=True)
    assert other.fingerprint != first.fingerprint
    why = comparable_heldout(first, other)
    assert why and "different held-out text" in why

    # A bigger corpus is a different set too, which is the case that nearly got published.
    bigger = evaluate(model, SplitLibrary(_library(tmp_path / "more", n=90), every=10, side="heldout"), Budget.smoke())
    assert comparable_heldout(first, bigger) is not None

    # A number from before fingerprints existed is refused rather than assumed to match.
    from dataclasses import replace

    assert "before held-out sets carried a fingerprint" in (comparable_heldout(first, replace(first, fingerprint="")) or "")


def test_a_full_corpus_model_is_refused_as_a_held_out_score(tmp_path):
    """The check that would have caught 6.06 and 6.396.

    Training on `Library` rather than on one side of a split and then scoring one document in twenty
    of the same manifest produces a plausible-looking number that is a memorisation score. Measured
    on the real corpus it was off by a factor of four, and the tell — OOV collapsing from 0.79% to
    0.15% — was printed next to it every time and read as good news.
    """
    lib = _library(tmp_path, n=60)
    rec = train(lib, tmp_path / "full.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    assert rec.to_dict()["split"] is None, "a full-manifest run must record no split"
    with pytest.raises(ValueError, match="every subset of that manifest is training text"):
        evaluate(model, SplitLibrary(lib, every=10, side="heldout"), Budget.smoke())

    # Still measurable on purpose, which is how the factor of four was measured.
    got = evaluate(model, SplitLibrary(lib, every=10, side="heldout"), Budget.smoke(), allow_in_sample=True)
    assert got.perplexity > 0


def test_the_complementary_split_is_the_one_case_that_passes(tmp_path):
    """Same stride, other side. Anything else is refused, including the same side twice."""
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    assert rec.to_dict()["split"] == {"every": 10, "side": "train"}

    assert in_sample_refusal(model, SplitLibrary(lib, every=10, side="heldout")) is None
    assert "the train side and this is the train side" in (
        in_sample_refusal(model, SplitLibrary(lib, every=10, side="train")) or ""
    )
    assert "do not complement" in (in_sample_refusal(model, SplitLibrary(lib, every=5, side="heldout")) or "")


def test_a_model_from_before_the_split_was_recorded_is_refused_rather_than_guessed_at(tmp_path):
    """An older model file carries no `split` key, and absent is not the same as None.

    None means "trained on everything", which is a fact. Absent means nothing knows, and a scorer
    that treats the two alike would silently accept exactly the models whose provenance is unclear.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    del model.meta["split"]

    why = in_sample_refusal(model, SplitLibrary(lib, every=10, side="heldout"))
    assert why is not None and "before the training split was recorded" in why
