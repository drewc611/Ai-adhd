"""The split, and the leak it exists to prevent.

A held-out perplexity is only worth quoting if the model never saw the documents it is scored on,
and the way that quietly stops being true is the vocabulary: build it over everything, evaluate on
part of it, and the model has been handed every word it is about to be tested on. The number then
improves for a reason that has nothing to do with the model.

So the load-bearing test here is not that perplexity is finite. It is that a word appearing only
in the held-out half is out of vocabulary.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from adhd_analysis.text.budget import Budget
from adhd_analysis.text.corpora import Library, Source
from adhd_analysis.text.evaluate import (
    FrozenSplit,
    SplitLibrary,
    comparable_heldout,
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


def test_a_source_the_model_never_had_needs_no_split(tmp_path):
    """Leave-one-source-out. The split field cannot express it and `meta["sources"]` already can.

    A model trained on a library that never contained a source cannot have seen that source's text,
    whatever stride it used. Without this branch E2b would have to pass `allow_in_sample=True`, which
    would be a lie about what the measurement is.
    """
    lib = _library(tmp_path, n=40)
    assert len(lib.sources) >= 1
    other = tmp_path / "other"
    other.mkdir()
    for i in range(12):
        (other / f"o{i}.txt").write_text(f"an unrelated document about topic {i} and nothing else.\n" * 8)
    outside = Library([Source(name="outside", path=other, include=["*.txt"])])

    rec = train(lib, tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    assert rec.to_dict()["split"] is None, "this run read a whole manifest"
    # Refused on its own corpus, permitted on a source it never had.
    assert in_sample_refusal(model, SplitLibrary(lib, every=10, side="heldout")) is not None
    assert in_sample_refusal(model, outside) is None
    assert evaluate(model, outside, Budget.smoke()).perplexity > 0


def test_sharing_one_source_is_enough_to_be_refused(tmp_path):
    """The disjointness has to be total. Overlapping on any source puts the stride rules back in charge."""
    lib = _library(tmp_path, n=40)
    rec = train(lib, tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    names = {s["name"] for s in model.meta["sources"]}
    assert names, "the model records no sources, so nothing can be checked"
    why = in_sample_refusal(model, Library(lib.sources))
    assert why is not None and "every subset of that manifest is training text" in why


def test_in_vocabulary_only_scoring_drops_exactly_the_oov_targets(tmp_path):
    """Backlog 77's instrument: separate "words it does not have" from "words it predicts badly".

    `genericity.py` has used this definition for surprisal since it was written — drop OOV targets,
    leave contexts alone — and `evaluate.py` did not, so the perplexity figures added the two
    together. The direction is not obvious either: `<unk>` is common in training by construction, so
    an OOV target can be less surprising than a real word and dropping those can push perplexity up.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=3, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    held = SplitLibrary(lib, every=10, side="heldout")

    everything = evaluate(model, held, Budget.smoke())
    known_only = evaluate(model, held, Budget.smoke(), in_vocabulary_only=True)

    assert everything.oov_rate > 0, "this corpus has no out-of-vocabulary tokens, so nothing is being tested"
    assert known_only.oov_rate == everything.oov_rate, "the OOV rate is the other half of the answer and must not move"
    assert known_only.tokens == everything.tokens
    assert known_only.perplexity != everything.perplexity
    assert everything.in_vocabulary_only is False and known_only.in_vocabulary_only is True


def test_two_scorings_of_one_set_are_not_comparable_when_they_asked_different_questions(tmp_path):
    """A fingerprint says the text is the same. It does not say the measurement is."""
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=3, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    held = SplitLibrary(lib, every=10, side="heldout")

    everything = evaluate(model, held, Budget.smoke())
    known_only = evaluate(model, held, Budget.smoke(), in_vocabulary_only=True)

    assert everything.fingerprint == known_only.fingerprint, "the text differed, so this tests nothing"
    why = comparable_heldout(everything, known_only)
    assert why is not None and "in-vocabulary targets only" in why


def _frozen(dirpath: Path, lib: Library, every: int = 10) -> Path:
    """Cut a frozen set the way `scripts/cut_heldout.py` does, without shelling out to it."""
    import hashlib

    names = [f"{s}/{i}" for n, (s, i, _) in enumerate(lib.identified()) if n % every == 0]
    dirpath.mkdir(parents=True, exist_ok=True)
    p = dirpath / f"heldout-{every}.json"
    p.write_text(json.dumps({"fingerprint": hashlib.sha256("\n".join(names).encode()).hexdigest()[:16], "documents": names}))
    return p


def test_a_frozen_set_does_not_move_when_the_corpus_grows(tmp_path):
    """The property the whole thing exists for, and the one a stride cannot have.

    `SplitLibrary` picks every Nth document by position, so adding anything reshuffles which
    documents are held out: the fingerprint changes and this week's perplexity stops being comparable
    to last week's. That is why the weekly job trained every week and learned nothing from its own
    number. Names do not move, so the corpus can keep growing — and everything new lands in the
    training half, which is the other half of the point.
    """
    lib = _library(tmp_path, n=40)
    spec = _frozen(tmp_path / "sets", lib)
    before = {d for _, d in FrozenSplit.load(lib, spec, side="heldout").documents()}
    stride_before = {d for _, d in SplitLibrary(lib, every=10, side="heldout").documents()}

    for i in range(40, 60):
        (tmp_path / "docs" / f"doc{i}.txt").write_text(" ".join(f"a later document {i} arrives ." for _ in range(20)))
    grown = Library(lib.sources)

    after = {d for _, d in FrozenSplit.load(grown, spec, side="heldout").documents()}
    stride_after = {d for _, d in SplitLibrary(grown, every=10, side="heldout").documents()}

    assert after == before, "the frozen set moved when the corpus grew"
    assert stride_after != stride_before, "the stride did not move, so this test is not testing anything"

    train_after = {d for _, d in FrozenSplit.load(grown, spec, side="train").documents()}
    assert any("a later document" in d for d in train_after), "new documents did not reach the training half"
    assert not any("a later document" in d for d in after), "a new document leaked into the frozen test set"


def test_the_two_frozen_sides_are_disjoint_and_complete(tmp_path):
    lib = _library(tmp_path, n=40)
    spec = _frozen(tmp_path / "sets", lib)
    held = [d for _, d in FrozenSplit.load(lib, spec, side="heldout").documents()]
    train = [d for _, d in FrozenSplit.load(lib, spec, side="train").documents()]

    assert held and train
    assert set(held).isdisjoint(train)
    assert len(held) + len(train) == len(list(lib.documents()))


def test_a_frozen_model_may_be_scored_on_its_complement_and_nothing_else(tmp_path):
    lib = _library(tmp_path, n=40)
    spec = _frozen(tmp_path / "sets", lib)
    rec = train(FrozenSplit.load(lib, spec, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    assert rec.to_dict()["split"] == {"frozen": json.loads(spec.read_text())["fingerprint"], "side": "train"}
    assert in_sample_refusal(model, FrozenSplit.load(lib, spec, side="heldout")) is None
    assert "the train side and this is the train side" in (
        in_sample_refusal(model, FrozenSplit.load(lib, spec, side="train")) or ""
    )
    # A stride split is not this model's complement whatever its size: the record names no stride.
    assert in_sample_refusal(model, SplitLibrary(lib, every=10, side="heldout")) is not None


def test_a_model_trained_against_a_different_frozen_set_is_refused(tmp_path):
    """Re-cutting the set invalidates every model measured against the old one, and says so."""
    lib = _library(tmp_path, n=40)
    mine = _frozen(tmp_path / "sets", lib, every=10)
    other = _frozen(tmp_path / "sets", lib, every=7)

    rec = train(FrozenSplit.load(lib, mine, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)

    why = in_sample_refusal(model, FrozenSplit.load(lib, other, side="heldout"))
    assert why is not None and "was not trained against frozen set" in why

def test_the_shipped_frozen_set_holds_out_no_document_a_commit_can_rewrite():
    """A frozen set fixes which documents are scored. It cannot fix what they say.

    The first cut of `analysis/heldout.json` put `docs/ARCHITECTURE.md` and `README.md` in the set,
    and those are rewritten whenever a decision is recorded — so writing one would have moved the
    next perplexity for a reason that has nothing to do with the model, silently, because the
    fingerprint is over names. Repository prose stays in the training half, where mutating text is
    harmless.
    """
    spec = json.loads((ROOT / "analysis" / "heldout.json").read_text())
    assert spec["documents"], "the shipped frozen set is empty"
    mutable = {"repo-docs", "repo-prompts", "repo-readme"}
    offenders = [n for n in spec["documents"] if n.split("/")[0] in mutable]
    assert not offenders, f"the frozen set holds documents this repository rewrites: {offenders}"
    assert len(spec["fingerprint"]) == 16


def test_a_truncated_score_says_so_rather_than_looking_finished(tmp_path):
    """A perplexity over a prefix is not a perplexity over the set, and it used to look identical.

    Measured on the real corpus: the shipped model scores 25.65 over 366 documents, and under a
    resident-set ceiling it already exceeds it returns **97.19 over one document**, with every other
    field ordinary. `compare_orders` learned this once — `OrderResult.truncated` exists because a
    shared wall-clock ceiling cut order 5's evaluation short and produced a table naming the wrong
    winner — and the fix went on the wrapper rather than on `HeldOut`, leaving every other caller
    exposed.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    held = SplitLibrary(lib, every=10, side="heldout")

    whole = evaluate(model, held, Budget.smoke())
    assert whole.truncated is None
    assert "TRUNCATED" not in str(whole)

    # A token ceiling that stops the loop after the first document.
    tight = Budget(max_tokens=1, max_seconds=10**6, max_ngrams=10**12, max_rss_mb=10**6, check_every=1)
    cut = evaluate(model, held, tight)
    assert cut.truncated, "a scoring run the budget stopped reported itself as complete"
    assert cut.documents < whole.documents
    assert "TRUNCATED" in str(cut)


def test_a_truncated_score_is_refused_before_the_fingerprint_is_blamed(tmp_path):
    """The reason has to be the real one.

    A truncated run has a different fingerprint *because* it was truncated, so a fingerprint-first
    check reports "different held-out text" and sends the reader hunting for a corpus change. That
    happened, and it cost real time.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    held = SplitLibrary(lib, every=10, side="heldout")

    whole = evaluate(model, held, Budget.smoke())
    cut = evaluate(model, held, Budget(max_tokens=1, max_seconds=10**6, max_ngrams=10**12, max_rss_mb=10**6, check_every=1))

    why = comparable_heldout(whole, cut)
    assert why is not None
    assert "truncated" in why, why
    assert "different held-out text" not in why, "the fingerprint got blamed for a truncation"
    # Either way round.
    assert "truncated" in (comparable_heldout(cut, whole) or "")


def test_the_same_text_counted_differently_is_refused(tmp_path):
    """The fingerprint hashes document content and cannot see how that content was tokenized.

    Demonstrated on the real corpus: fixing the ASCII word class re-based the baseline from 25.65 to
    25.82 on fingerprint `1446762140db7f1a`, with the token count moving 3,455,268 to 3,443,116 — the
    accented words that used to split in two now counting as one. Every other field agreed and this
    function called the pair comparable.

    Identical fingerprints with unequal token counts cannot happen unless the tokenizer moved, so the
    counts already sitting on the record are enough to catch it.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    held = SplitLibrary(lib, every=10, side="heldout")

    before = evaluate(model, held, Budget.smoke())
    after = replace(before, tokens=before.tokens - 1234, perplexity=before.perplexity * 1.01)

    assert before.fingerprint == after.fingerprint, "the fixture no longer models a tokenizer change"
    why = comparable_heldout(before, after)
    assert why is not None
    assert "the tokenizer changed" in why, why
    # Unchanged pairs stay comparable, so the check is not simply refusing everything.
    assert comparable_heldout(before, before) is None


def test_a_wide_oov_gap_is_not_comparable(tmp_path):
    """Two vocabularies, one test set, and an all-targets perplexity that silently favours the smaller
    vocabulary.

    Every OOV target is charged as a prediction of `<unk>`, and `<unk>` is among the most frequent
    symbols a closed-vocabulary model holds. So the model that knows fewer words is asked an easier
    question on a larger share of the same text. This is the confound E6 runs into: a transformer
    capped at 8,192 types cannot be put next to a 148,353-type n-gram on all targets, even though the
    fingerprint, the token count and `in_vocabulary_only` all agree.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    held = SplitLibrary(lib, every=10, side="heldout")

    wide = evaluate(model, held, Budget.smoke())
    narrow = replace(wide, oov_rate=wide.oov_rate + 0.09)

    assert wide.fingerprint == narrow.fingerprint
    assert wide.tokens == narrow.tokens
    why = comparable_heldout(wide, narrow)
    assert why is not None
    assert "out-of-vocabulary" in why, why
    # Symmetric: the order of the arguments is not a way past it.
    assert comparable_heldout(narrow, wide) is not None


def test_the_min_count_pair_e4_compared_stays_comparable(tmp_path):
    """The threshold has to let through the comparison the repo already made and stands by.

    E4 ranked `min_count` 2 against 3 on all targets at 0.63% and 0.85% OOV and adopted 3 on the
    strength of it. A refusal calibrated so tightly that it voids E4 retroactively is a worse
    instrument than no refusal, so that gap is the lower bound this is set above.
    """
    lib = _library(tmp_path, n=60)
    rec = train(SplitLibrary(lib, every=10, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    held = SplitLibrary(lib, every=10, side="heldout")

    at_mc2 = replace(evaluate(model, held, Budget.smoke()), oov_rate=0.0063)
    at_mc3 = replace(at_mc2, oov_rate=0.0085, perplexity=at_mc2.perplexity * 0.98)
    assert comparable_heldout(at_mc2, at_mc3) is None


def test_an_empty_held_out_side_is_refused_not_scored(tmp_path):
    """`perplexity inf, OOV 100.0%, over 0 tokens` is what an empty set used to return, with
    `truncated` None and nothing saying the set was empty rather than the model terrible.

    Found by dry-running the E6 pipeline on a toy corpus whose frozen-set names omitted the file
    extension. Every name missed, the held-out side yielded nothing, and the scoring script printed a
    `nanx` ratio and exited 0.

    The live version of this is not a typo. `heldout.json` names 366 documents as `rfc/rfc1017.txt`, so
    any change to how `Library.identified()` forms an id makes all 366 miss at once and the weekly job
    reports `inf` every week with no field explaining it.
    """
    lib = _library(tmp_path, n=60)
    # Names without the `.txt` the loader actually produces, which is the real mistake: ids come back
    # as `toy/doc000.txt`, so every one of these misses.
    spec = tmp_path / "nothing-matches.json"
    spec.write_text(json.dumps({"documents": ["toy/doc000", "toy/doc010"], "fingerprint": "0" * 16}))

    rec = train(FrozenSplit.load(lib, spec, side="train"), tmp_path / "m.kn.gz", order=3, min_count=1, budget=Budget.smoke())
    model = KneserNey.load(rec.model_path)
    empty = FrozenSplit.load(lib, spec, side="heldout")
    assert [n for n, _d in empty.documents()] == [], "the fixture no longer models a name mismatch"

    # `in_sample_refusal` has no objection: the fingerprints match and the sides are complementary.
    # Nothing before this checked that the held-out side of that split contained anything.
    assert in_sample_refusal(model, empty) is None
    with pytest.raises(ValueError, match="nothing to score"):
        evaluate(model, empty, Budget.smoke())
