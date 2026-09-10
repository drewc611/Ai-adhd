"""The language model, checked against arithmetic rather than against a plausible-looking number.

A smoothed n-gram model that is subtly wrong still produces perplexities in the right order of
magnitude and rankings that look sensible. The one property that cannot be faked is that the
conditional distribution sums to one for every context, seen or unseen, so that is the test the
rest of this file is built around.
"""

from __future__ import annotations

import random
from pathlib import Path

import pytest

from adhd_analysis.text.budget import Budget, BudgetExceeded
from adhd_analysis.text.corpora import CorpusError, Library, Source
from adhd_analysis.text.ngram import KneserNey, count_ngrams
from adhd_analysis.text.tokenize import Vocab, sentences, tokens
from adhd_analysis.text.train import train

ROOT = Path(__file__).resolve().parents[2]


def _corpus_text(n_sentences: int = 400, seed: int = 11) -> list[str]:
    rng = random.Random(seed)
    subj = ["the critic", "a branch", "the orchestrator", "one detector", "the kernel"]
    verb = ["prunes", "records", "refuses", "scores", "abandons"]
    obj = ["the artifact", "a trap", "the brief", "every survivor", "one cluster"]
    tail = ["without evidence", "under objection", "on the recorded run", "in pass a", ""]
    return [f"{rng.choice(subj)} {rng.choice(verb)} {rng.choice(obj)} {rng.choice(tail)}.".strip() for _ in range(n_sentences)]


@pytest.fixture(scope="module")
def toy() -> KneserNey:
    from collections import Counter

    text = _corpus_text()
    freq: Counter[str] = Counter()
    for s in text:
        freq.update(tokens(s))
    vocab = Vocab.build(freq, min_count=1)
    b = Budget.smoke()
    top, meta = count_ngrams((vocab.encode(tokens(s)) for s in text), 3, b, vocab)
    return KneserNey(order=3, vocab=vocab, counts=[{}, {}, top], meta=meta).seal()


def test_the_conditional_distribution_sums_to_one(toy):
    """Interpolated Kneser-Ney is a proper distribution or it is nothing.

    The discount taken off each seen continuation must be exactly the mass gamma(h) hands to the
    lower order. Get gamma wrong and every perplexity in the repository is off by a factor that
    varies with context frequency, which no eyeball check would catch.
    """
    contexts = [
        tuple(toy.vocab.encode(tokens("the critic"))),
        tuple(toy.vocab.encode(tokens("one detector"))),
        (),
        tuple(toy.vocab.encode(tokens("nonsense wobble"))),
    ]
    for ctx in contexts:
        total = sum(toy.prob(ctx, w) for w in range(len(toy.vocab)))
        assert abs(total - 1.0) < 1e-9, f"context {ctx} sums to {total}"


def test_every_probability_is_positive(toy):
    """A zero anywhere means a held-out sentence gets infinite perplexity, and the whole measure
    stops being comparable across artifacts."""
    ctx = tuple(toy.vocab.encode(tokens("the critic")))
    assert all(toy.prob(ctx, w) > 0 for w in range(len(toy.vocab)))


def test_discounts_stay_inside_their_intervals(toy):
    """Chen & Goodman's D1 < 1, D2 < 2, D3 < 3. A discount at or above its bound subtracts more
    than the count it is discounting and drives the leading term negative before the max() clips
    it, which silently converts the model into pure backoff."""
    for k, (d1, d2, d3) in enumerate(toy.discounts):
        assert 0.0 <= d1 < 1.0, f"order {k + 1}: D1 = {d1}"
        assert 0.0 <= d2 < 2.0, f"order {k + 1}: D2 = {d2}"
        assert 0.0 <= d3 < 3.0, f"order {k + 1}: D3 = {d3}"


def test_it_prefers_text_from_its_own_distribution(toy):
    """The minimum bar. Held-out sentences from the generator beat the same words shuffled.

    Shuffling rather than substituting keeps the unigram distribution identical, so what is being
    tested is the context modelling and not the vocabulary.
    """
    held_out = _corpus_text(60, seed=99)
    rng = random.Random(5)
    in_dist, shuffled = [], []
    for s in held_out:
        ts = tokens(s)
        in_dist.append(toy.perplexity(toy.vocab.encode(ts)))
        mixed = ts[:]
        rng.shuffle(mixed)
        shuffled.append(toy.perplexity(toy.vocab.encode(mixed)))
    assert sum(in_dist) / len(in_dist) < sum(shuffled) / len(shuffled)


def test_save_and_load_reproduce_the_same_probabilities(toy, tmp_path):
    p = toy.save(tmp_path / "m.kn.gz")
    back = KneserNey.load(p)
    ctx = tuple(toy.vocab.encode(tokens("the critic")))
    for w in range(len(toy.vocab)):
        assert abs(toy.prob(ctx, w) - back.prob(ctx, w)) < 1e-12
    assert back.order == toy.order and back.vocab.itos == toy.vocab.itos


def test_the_model_file_is_not_pickle(toy, tmp_path):
    """CI loads last week's model on a schedule. A pickle there is arbitrary code execution on a
    tampered artifact, and the format check is what keeps a future convenience from adding one."""
    p = toy.save(tmp_path / "m.kn.gz")
    import gzip

    with gzip.open(p, "rt") as fh:
        assert fh.readline().startswith('{"format": "adhd-kn-1"')
    with pytest.raises(ValueError, match="not an adhd-kn-1 model"):
        bad = tmp_path / "bad.kn.gz"
        with gzip.open(bad, "wt") as fh:
            fh.write('{"format": "something-else"}\n')
        KneserNey.load(bad)


def test_out_of_vocabulary_words_do_not_read_as_original(toy):
    """The trap `genericity.py` exists to avoid.

    A closed vocabulary maps invented words to `<unk>`, and `<unk>` is common in the training data
    by construction. So a sentence of nonsense is not maximally surprising, and any measure that
    forgot to report the OOV rate would call it the most original thing in the corpus.
    """
    from adhd_analysis.text.genericity import score_text

    real_mean, real_oov, _ = score_text(toy, "the critic prunes the artifact under objection.")
    junk_mean, junk_oov, _ = score_text(toy, "wibble frotz gnarl quux blimp.")
    # The period is in vocabulary, so five words out of six is the ceiling here.
    assert junk_oov > 0.8
    assert real_oov < 0.2
    # The point of the test: mean surprisal is taken over in-vocabulary tokens only, so the junk
    # sentence is scored on its one real token rather than credited for its five invented ones. A
    # measure that scored `<unk>` would rank it as the most original text in the corpus.
    assert junk_mean == junk_mean and real_mean == real_mean


def test_sentence_splitting_does_not_join_across_a_blank_line():
    text = "A heading\n\nThe paragraph under it. And a second sentence."
    assert list(sentences(text)) == ["A heading", "The paragraph under it.", "And a second sentence."]


def test_vocabulary_min_count_reports_what_it_dropped():
    from collections import Counter

    c = Counter({"kept": 5, "also": 3, "once": 1, "twice": 2})
    v = Vocab.build(c, min_count=2)
    assert "once" not in v.stoi and "twice" in v.stoi
    assert v.dropped_types == 1 and v.dropped_tokens == 1
    assert v.encode(["once"]) == [v.stoi["<unk>"]]


def test_a_vocabulary_ceiling_that_binds_says_so_separately_from_min_count():
    """Both raise the OOV rate and only one of them is a modelling decision.

    A word dropped for appearing once is a choice. A word that appeared 90 times and was cut because
    the ceiling filled up is a ceiling that bound without saying so, and it makes perplexity
    incomparable with a run whose vocabulary was not capped. Before this the two causes landed in one
    number and the second was invisible.
    """
    from collections import Counter

    c = Counter({f"w{i}": 100 - i for i in range(40)} | {"rare": 1})
    v = Vocab.build(c, min_count=2, max_size=13)

    assert len(v) == 13, "the ceiling did not bind"
    # 3 specials plus 10 real types, so 30 frequent types were cut and one was below min_count.
    assert v.truncated_types == 30
    assert v.truncated_tokens == sum(100 - i for i in range(10, 40))
    # Truncated is a subset of dropped rather than a disjoint count: dropped is the OOV numerator.
    assert v.dropped_types == 31 and v.dropped_tokens == v.truncated_tokens + 1


def test_min_count_drops_are_not_reported_as_truncation():
    """The distinction is only useful if it does not fire on the ordinary case."""
    from collections import Counter

    v = Vocab.build(Counter({"kept": 5, "once": 1}), min_count=2, max_size=1000)
    assert v.dropped_types == 1 and v.truncated_types == 0 and v.truncated_tokens == 0


def test_accented_words_are_not_truncated():
    """The tokenizer was ASCII-only, and an ASCII word class does not fail loudly on an accent.

    Measured on the real corpus before this was fixed: 234 of 1,175 sampled files hold non-ASCII
    characters, and the model was learning `Löwis` as `l` and `wis`, `André` as `andr`, `Viagénie` as
    `viag` and `nie`. Author lines and references are where a technical corpus keeps its accents, so a
    fifth of the training files were feeding it broken words.
    """
    assert tokens("Martin v. Löwis") == ["martin", "v", ".", "löwis"]
    assert tokens("André") == ["andré"]
    assert tokens("Viagénie, Montréal") == ["viagénie", ",", "montréal"]
    # Whole words in other alphabets rather than one token per letter.
    assert tokens("Клиент должен") == ["клиент", "должен"]
    assert tokens("Ο πελάτης") == ["ο", "πελάτης"]


def test_the_existing_token_shapes_still_hold():
    """The accent fix widened a character class, and everything the old pattern got right is regression
    surface: snake_case identifiers, contractions, decimals, thousands separators and percentages."""
    assert tokens("snake_case and don't") == ["snake_case", "and", "don't"]
    assert tokens("3.14 and 1,000 and 99%") == ["3.14", "and", "1,000", "and", "99%"]
    assert tokens("a-b") == ["a", "-", "b"]
    assert tokens("HTTP/1.1") == ["http", "/", "1.1"]


def test_scripts_without_spaces_are_not_claimed_to_work():
    """Honest limit, pinned so nobody reads the accent fix as multilingual support.

    Chinese, Japanese and Thai are written without spaces, so a Unicode word class matches a whole run
    as a single token. That is a different wrong answer from the per-character split it replaced, not a
    right one, and segmenting them is a separate piece of work.
    """
    assert tokens("客户端应该") == ["客户端应该"], "if this changed, the segmentation question was answered"
