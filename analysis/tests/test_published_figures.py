"""Every figure the prose quotes, checked against the record it came from.

This repository's practice is to measure rather than assert, and until `analysis/records/` existed it
was not keeping its own rule about its own measurements. `analysis/models/` and `runs/` are
gitignored — rightly, a model is 160MB and the corpus is licence-encumbered — so **every published
number had no checked-in evidence**. From a clean checkout nobody could verify 25.82, or E6's 30.7
and 64.1, or the 64,419,427 tokens the README quotes. A number drifting from its run was invisible,
which is exactly how 6.06 survived, then 26.29, then 25.65.

A record is 2.6KB of metadata about a corpus rather than any of the corpus, so tracking it costs
nothing. These tests read those records and fail when the prose stops agreeing with them.

They deliberately do not re-train anything. A test that needs 14 minutes and 10GB is a test that gets
skipped, and the drift being caught here is prose drifting from a finished run, not a run changing.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
RECORDS = ROOT / "analysis" / "records"


def record(name: str) -> dict:
    path = RECORDS / f"{name}.json"
    assert path.exists(), f"{path} is missing; publish it with analysis/scripts/publish_record.py"
    return json.loads(path.read_text())


def docs(*names: str) -> str:
    return "\n".join((ROOT / n).read_text() for n in names)


def commas(n: int) -> str:
    return f"{n:,}"


#: Files that describe the shipped model and must therefore agree with its record.
SHIPPED_CLAIM_SITES = ("README.md", "analysis/README.md")


@pytest.fixture(scope="module")
def readmes() -> str:
    return docs(*SHIPPED_CLAIM_SITES)


@pytest.mark.parametrize("where", SHIPPED_CLAIM_SITES)
def test_the_shipped_model_is_described_by_its_own_record(where):
    """The numbers both READMEs use for the shipped model, read off the record rather than trusted,
    and checked **per file**.

    Checked per file because the first version of this test concatenated the two and asked whether
    the figure appeared anywhere in the result. It passed a deliberate corruption: changing
    `64,419,427` to `64,419,999` in one README left the other one still carrying the right value, and
    the combined string still contained it. That version proved some document quoted the record, not
    that the documents agreed with it, which is the drift it exists to catch.
    """
    r = record("shipped")
    assert r["order"] == 4
    assert r["min_count"] == 3
    assert r["split"] == {"frozen": "8e2d77cbe8901b1e", "side": "train"}
    text = (ROOT / where).read_text()
    for field in ("tokens_seen", "vocab_size", "ngrams"):
        assert commas(r[field]) in text, (
            f"{where} does not quote {field} = {commas(r[field])} from records/shipped.json"
        )


@pytest.mark.parametrize("where", SHIPPED_CLAIM_SITES)
def test_no_document_quotes_a_near_miss_of_a_recorded_figure(where):
    """A figure one digit away from the record is drift, not a different measurement, and it reads as
    authoritative. Catching it needs the wrong values refused, not just the right one required."""
    r = record("shipped")
    text = (ROOT / where).read_text()
    for field in ("tokens_seen", "vocab_size", "ngrams"):
        truth = r[field]
        # Same magnitude, same comma grouping, different value: what a typo or a stale copy looks like.
        for delta in (-572, -1, 1, 572):
            near = commas(truth + delta)
            assert near not in text, f"{where} quotes {near}, which is not {field} = {commas(truth)}"


def test_the_shipped_model_trained_on_one_side_of_the_split(readmes):
    """A record whose `split` is None is a model trained on everything, and its perplexity is a
    memorisation score. D16 is the entry about publishing one of those by accident."""
    r = record("shipped")
    assert r["split"] is not None, "a model trained on the whole manifest cannot back a held-out figure"
    assert r["split"]["side"] == "train"


@pytest.mark.parametrize("cell,tokens,vocab", [
    ("e6-cellA", 64_420_728, 8192),
    ("e6-cellAprime", 20_000_029, 8192),
])
def test_the_e6_ngram_cells_match_their_records(cell, tokens, vocab):
    r = record(cell)
    assert r["tokens_seen"] == tokens
    assert r["vocab_size"] == vocab
    assert r["order"] == 4 and r["min_count"] == 3


def test_the_e6_transformer_cell_matches_its_record():
    r = record("e6-cellB")
    assert r["config"]["d_model"] == 128 and r["config"]["n_layers"] == 2
    assert r["config"]["context"] == 128 and r["config"]["vocab_size"] == 8192
    assert r["stopped_because"] == "epochs", "a cell that stopped on a ceiling is void, not a result"
    assert r["epochs_completed"] == pytest.approx(1.0, abs=0.01)


def test_the_matched_pair_really_was_matched():
    """E6's whole claim rests on A′ and B sharing a vocabulary rather than merely a cap. If that
    stops being true the 2.086x is measuring two things at once."""
    a, b = record("e6-cellAprime"), record("e6-cellB")
    assert a["vocab_size"] == b["vocab_size"]
    assert a["min_count"] == b["min_count"]
    assert abs(a["oov_rate"] - b["oov_rate"]) < 1e-4, (
        f"training OOV drifted apart: {a['oov_rate']} against {b['oov_rate']}"
    )


def test_the_transformer_saw_less_text_and_the_docs_say_so():
    """The one asymmetry in E6 runs against the loser, so it is quoted rather than rounded away. If
    the gap changes, the sentence describing it has to change too."""
    a, b = record("e6-cellAprime"), record("e6-cellB")
    real_b = b["budget_corpus"]["tokens"]
    assert real_b < a["tokens_seen"]
    gap = 1 - real_b / a["tokens_seen"]
    assert 0.07 < gap < 0.09, f"the text handicap is now {gap:.1%}, and the docs say 8.3%"
    assert commas(real_b) in docs("docs/DECISIONS.md", "analysis/README.md")


def test_no_cell_reports_a_ceiling_it_did_not_declare():
    """Cell A read the whole training side; A′ stopped exactly on the registered 20M token cap. A
    cell that stopped for some other reason is a different experiment."""
    assert record("e6-cellA")["budget"]["counts"]["stopped_because"] is None
    stopped = record("e6-cellAprime")["budget"]["counts"]["stopped_because"]
    assert stopped is not None and "token ceiling" in stopped


def test_every_published_record_carries_its_provenance():
    """A record that cannot say where its numbers came from cannot back any claim, whatever numbers it
    holds. Two shapes live in `records/` and the bar is different for each rather than waived for one:
    a training record has to name its corpus and its side of the split, an evaluation record has to
    name the held-out text it scored and the models it scored there.
    """
    for path in sorted(RECORDS.glob("*.json")):
        r = json.loads(path.read_text())
        if "points" in r:
            assert r.get("fit"), f"{path.name} reads as an evaluation record with no fit"
            assert r["points"], f"{path.name} scored nothing"
            for point in r["points"]:
                assert point.get("model"), f"{path.name} has a point naming no model"
                assert point["all_targets"]["fingerprint"], f"{path.name} names no held-out text"
            continue
        assert r.get("sources"), f"{path.name} names no corpus"
        assert "split" in r, f"{path.name} does not say which side it trained on"
        assert r.get("tokens_seen") or r.get("train_tokens"), f"{path.name} reports no tokens"


def test_records_are_portable_between_machines():
    """Absolute paths differ per machine, and an artifact that diffs on every machine is one people
    stop reading. `publish_record.py` rewrites them relative to the repository root."""
    for path in sorted(RECORDS.glob("*.json")):
        text = path.read_text()
        assert "/home/" not in text and "/Users/" not in text, f"{path.name} carries an absolute path"
        assert "platform" not in json.loads(text), f"{path.name} carries the producing machine"


def test_the_decisions_log_quotes_the_e6_result_it_recorded():
    d = docs("docs/DECISIONS.md")
    for figure in ("19.9", "30.7", "64.1", "2.086x"):
        assert figure in d, f"D21 no longer quotes {figure}"


def test_every_readme_perplexity_belongs_to_a_recorded_run(readmes):
    """The check that would have caught 26.29 surviving two replacements: every headline perplexity
    in a README is one of the figures a checked-in record can account for.

    The pattern used to be `perplexity \\*\\*N\\*\\*` alone, and it missed the paragraph that matters most.
    The transformer section writes its figures as "scores **64.1** against Kneser-Ney's **30.7**", so
    three pre-D26 numbers sat directly above a sentence reading "Every figure here is post-D26" and
    this test could not see any of them. A guard whose regex does not reach the prose it guards is
    indistinguishable from no guard, and it passed for as long as the drift existed.
    """
    # D17's per-genre pair is here on purpose. D25 refuses it and `analysis/README.md` says so beside
    # the figures; a number the repository still quotes has to be accounted for whether or not the
    # comparison it came from currently stands.
    known = {"25.82", "30.95", "64.29", "154.81", "142.41", "19.94", "6.06", "2.077", "153.53", "54.30"}
    quoted = set(re.findall(r"(?:perplexity|scores)\s+\*\*([\d.]+)\*\*", readmes))
    unknown = quoted - known
    assert not unknown, f"the READMEs quote perplexities nothing accounts for: {sorted(unknown)}"
    assert "25.82" in readmes, "the shipped figure is no longer stated"
    assert "26.29" not in (ROOT / "README.md").read_text(), "26.29 is two revisions stale"


def test_the_readme_quotes_post_d26_figures_where_it_says_it_does(readmes):
    """The README asserts "Every figure here is post-D26" and quoted the pre-D26 ones. D27 recorded
    both columns; only one of them belongs above that sentence."""
    readme = (ROOT / "README.md").read_text()
    assert "Every figure here is **post-D26**" in readme, "the claim this checks has moved"
    for stale, current in (("64.1", "64.29"), ("30.7", "30.95"), ("159.3", "154.81")):
        assert f"**{stale}**" not in readme, f"the README still quotes the pre-D26 {stale}, not {current}"
        assert f"**{current}**" in readme, f"the README does not quote the post-D26 {current}"
    # And the ratios that follow from them.
    assert "**2.077x**" in readme and "**2.09x**" not in readme, "E6's ratio is the pre-D26 one"


# --- E8: the vocabulary sweep, the slope, and the threshold derived from it ---------------------

E8_CELLS = ("e8-v0", "e8-v1", "e8-v2", "e8-v3")


@pytest.fixture(scope="module")
def slope() -> dict:
    return record("e8-slope")


def test_the_e8_cells_differ_in_the_cap_and_in_nothing_else(slope):
    """E8's whole claim is that the vocabulary cap is the only independent variable. If any other
    field moves, the slope is measuring two things and the threshold derived from it is wrong."""
    cells = [record(c) for c in E8_CELLS]
    assert [c["vocab_size"] for c in cells] == [8192, 16384, 32768, 71603]
    for c in cells:
        assert c["order"] == 4 and c["min_count"] == 3
        assert c["tokens_seen"] == 20_000_007, "the cells read different amounts of text"
        assert c["split"] == {"frozen": "8e2d77cbe8901b1e", "side": "train"}
        stopped = c["budget"]["counts"]["stopped_because"]
        assert stopped and "token ceiling" in stopped, "a cell that stopped elsewhere is void"
    # The arithmetic E8 registered in advance, now as a standing check: every type the cap discards
    # plus every type it keeps is the same number of types clearing `min_count` 3.
    totals = {c["vocab_size"] + c["vocab_truncated"]["types"] for c in cells}
    assert totals == {71_603}, f"the cells disagree on how many types clear min_count 3: {totals}"


def test_every_e8_cell_read_one_corpus_and_none_of_it_was_repository_prose(slope):
    """What D26 bought, asserted rather than described.

    The pre-D26 sweep could only offer indirect evidence that its four cells read one corpus — equal
    token counts and equal per-source byte counts — because the digest did not exist yet and the prose
    that made the question urgent was still in the read. Both halves are direct now.
    """
    from adhd_analysis.text.corpora import Library
    from adhd_analysis.text.evaluate import comparable_training

    cells = [record(c) for c in E8_CELLS]
    prints = {c["corpus_fingerprint"] for c in cells}
    assert prints == {"080865e040e7b88d"}, f"the cells trained on different text: {prints}"
    for other in cells[1:]:
        assert comparable_training(cells[0], other) is None
        assert other["vocabulary_covers_counts"] is True

    mutable = Library.load(ROOT / "analysis" / "corpora.yaml").mutable_names()
    for c in cells:
        names = {s["name"] for s in c["sources"]}
        assert names.isdisjoint(mutable), f"{c['model']} read text a commit can rewrite: {sorted(names)}"


def test_the_pre_d26_sweep_agrees_with_the_one_that_replaced_it(slope):
    """Two measurements of the same four cells, on corpora 0.105% apart. If they ever diverge by more
    than a rounding difference, D26 re-based something and the claim that it did not is wrong."""
    for cell in E8_CELLS:
        old, new = record(f"{cell}-pre-d26"), record(cell)
        assert old["min_count"] == new["min_count"] and old["order"] == new["order"]
        assert old["vocab_size"] == new["vocab_size"] or cell == "e8-v3", cell
        # The prose contributed 331 types of its own, which only the uncapped cell can show.
        if cell == "e8-v3":
            assert old["vocab_size"] - new["vocab_size"] == 331, cell
    # And the perplexities, which is what anyone actually quotes.
    post = [p["all_targets"]["perplexity"] for p in slope["points"]]
    pre = [30.7312, 35.2888, 39.1747, 42.5024]
    for a, b in zip(pre, post):
        assert abs(b - a) / a < 0.01, f"D26 moved a published figure by more than 1%: {a} -> {b}"


def test_the_drift_records_show_four_different_corpora_which_is_why_d26_exists():
    """The evidence D26 rests on, kept as a test rather than quoted once and forgotten.

    Retraining E8's four cells *while E8's result was being written up* gave each cell a different
    corpus, because `docs/` was a corpus source. This is the record of that, measured against the
    pre-D26 cells it was a retrain of, and the assertions are the three things it shows: four distinct
    digests, `comparable_training` refusing every pair, and the drift growing with write-up order.
    """
    from adhd_analysis.text.evaluate import comparable_training

    drift = [record(f"{c}-drift") for c in E8_CELLS]
    for r in drift:
        assert r["corpus_fingerprint"], "a drift record with no digest shows nothing"
        assert r["vocabulary_covers_counts"] is True

    prints = {r["corpus_fingerprint"] for r in drift}
    assert len(prints) == 4, (
        "the drift records now agree on a corpus, so they no longer demonstrate what D25 says they do"
    )
    for i in range(len(drift)):
        for j in range(i + 1, len(drift)):
            assert comparable_training(drift[i], drift[j]) is not None, (
                f"comparable_training accepts {E8_CELLS[i]} against {E8_CELLS[j]}, which had different "
                "corpus digests. The refusal D26 rests on has stopped working."
            )

    # Monotone in the order they were retrained, which is the order the write-up was committed in. The
    # cell trained first drifted by one n-gram and the cell trained last by 4,807 — the number D25 and
    # D26 both quote. Measured against the pre-D26 cells, which is what the retrain was a retrain of.
    moved = [abs(d["ngrams"] - record(f"{c}-pre-d26")["ngrams"]) for c, d in zip(E8_CELLS, drift)]
    assert moved == sorted(moved), f"the drift is no longer monotone in write-up order: {moved}"
    assert moved[0] == 1 and moved[-1] == 4807, moved
    assert commas(moved[-1]) in docs("docs/DECISIONS.md"), "the decisions log no longer quotes the drift"


def test_the_e8_perplexities_are_scored_on_the_shipped_held_out_set(slope):
    reading = [p["all_targets"] for p in slope["points"]]
    assert {r["fingerprint"] for r in reading} == {"1446762140db7f1a"}
    assert {r["documents"] for r in reading} == {366}
    assert {r["tokens"] for r in reading} == {3_443_116}
    assert [round(r["perplexity"], 2) for r in reading] == [30.95, 35.52, 39.31, 42.77]
    # Formatted the way the documents format it, not rounded a second way. The first version of this
    # test compared `round(rate * 100, 3)` against figures copied off the script's progress output, and
    # the two disagreed on the last cell: 2.391 against 2.392, because the progress line formatted the
    # unrounded rate and the record stored the rounded one.
    assert [f"{r['oov_rate']:.3%}" for r in reading] == ["5.797%", "4.044%", "3.063%", "2.391%"]
    for r in reading:
        assert f"{r['oov_rate']:.3%}" in docs("docs/DECISIONS.md"), (
            f"the decisions log does not quote {r['oov_rate']:.3%}, which its own record carries"
        )


def test_the_docs_quote_the_slope_they_recorded(slope):
    d = docs("docs/DECISIONS.md", "docs/EXPERIMENTS.md")
    assert f"{slope['fit']['slope_perplexity_per_oov_point']:.3f}" in d
    assert f"{slope['fit']['r_squared']:.3f}" in d
    for p in slope["points"]:
        assert f"{p['all_targets']['perplexity']:.2f}" in d, p["model"]


def test_the_worst_case_is_taken_unconditionally_because_the_registered_test_did_not_discriminate(slope):
    """The reading that paid for itself, and the one place a stale assumption could creep back.

    E8 registered a 2x pairwise spread as the line past which the fit cannot be used. The stable corpus
    measures **1.972x** — under the line, where the rule says use the fit — and the pre-D26 corpus
    measured **2.005x**, over it. The two corpora differ by 0.105%. So the rule decides nothing, the
    threshold takes the worst pairwise slope unconditionally as the conservative side of a coin toss,
    and `linear` is a reading wired to nothing.

    An earlier version of this test asserted the spread was *over* 2.0 and that the registration had
    therefore selected the worst case. That was true of one measurement and false of the next.
    """
    assert slope["threshold"]["slope_used"] == "worst_pairwise"
    worst = max(abs(p["slope"]) for p in slope["fit"]["pairwise"])
    assert slope["threshold"]["worst_pairwise_slope"] == pytest.approx(worst)
    # The fit is *not* what sizes the threshold, whichever side of 2.0 the spread lands on.
    assert abs(slope["fit"]["slope_perplexity_per_oov_point"]) < worst

    # The straddle itself, so nobody has to take the paragraph on trust. The pre-D26 cells carry no
    # digest — they predate the mechanism they motivated — which is the other half of why the sweep had
    # to be measured again rather than compared across.
    assert not record("e8-v0-pre-d26").get("corpus_fingerprint"), (
        "the pre-D26 cells predate the digest; if one has appeared, this test's premise changed"
    )
    assert slope["fit"]["pairwise_spread"] < 2.0, "the stable corpus should read under the line"
    for figure in ("1.972", "2.005"):
        assert figure in docs("docs/DECISIONS.md"), f"D25 no longer quotes the {figure} straddle"

    # And it is the highest-vocabulary pair, which is the regime the shipped model sits in.
    steepest = max(slope["fit"]["pairwise"], key=lambda p: abs(p["slope"]))
    assert (steepest["a"], steepest["b"]) == ("e8c-v2.kn.gz", "e8c-v3.kn.gz")


def test_the_threshold_in_the_code_is_the_one_the_record_measured(slope):
    """The constant and the measurement cannot drift apart silently."""
    from adhd_analysis.text import evaluate as ev

    assert ev.OOV_PERPLEXITY_SLOPE == pytest.approx(slope["threshold"]["worst_pairwise_slope"])
    assert ev.OOV_RELATIVE_BUDGET == slope["threshold"]["relative_budget"]
    assert ev.OOV_MAX_GAP == 0.01, "the cap is the pre-E8 threshold, so E8 never loosens the guard"

    # The floor is not the record's to fix — it comes from E4, which the record knows nothing about. So
    # this asserts the two things that actually matter: the floor covers E4's gap, and it did not bind
    # when the slope was derived, which is what makes the recorded derivation independent of it.
    assert ev.OOV_FLOOR_GAP >= ev.E4_GAP, "the floor no longer admits the comparison it exists for"
    assert slope["threshold"]["floor_bound"] is False
    assert slope["threshold"]["derived_gap"] > ev.OOV_FLOOR_GAP, (
        "the floor now binds, so the threshold is E4's gap rather than the measured one and D25's "
        '"today it does not bind" is stale'
    )


def test_the_unk_discount_changes_sign_across_the_sweep(slope):
    """D25 claims the `<unk>` discount is real, small, and not the dominant term, on the strength of
    an in-vocabulary-only score that crosses over. If the crossover goes away, that paragraph is
    wrong and the reason written beside the threshold is wrong with it."""
    deltas = [p["in_vocabulary_only"]["perplexity"] - p["all_targets"]["perplexity"] for p in slope["points"]]
    assert deltas[0] > 0.5, "at 8,192 types `<unk>` should be cheaper than the average real token"
    assert deltas[-1] < -0.5, "at 71,934 types it should be dearer"
    assert deltas == sorted(deltas, reverse=True), f"the crossover is not monotone: {deltas}"
    # Meanwhile all-targets perplexity rises throughout, which is what makes the discount the minor term.
    all_targets = [p["all_targets"]["perplexity"] for p in slope["points"]]
    assert all_targets == sorted(all_targets)


def test_the_derived_threshold_still_admits_e4_and_still_refuses_e6():
    """The two comparisons that fix the threshold from either side."""
    from adhd_analysis.text.evaluate import HeldOut, comparable_heldout

    def held(ppl: float, oov: float) -> HeldOut:
        return HeldOut(
            documents=366, sentences=1, tokens=3_443_116, in_vocabulary=1, oov_rate=oov,
            perplexity=ppl, fingerprint="1446762140db7f1a",
        )

    # E4: min_count 2 against 3, at 0.63% and 0.85%. Sound, and must stay sound.
    assert comparable_heldout(held(25.0, 0.0063), held(25.4, 0.0085)) is None
    # E6: cells A and A′ at 4.71% and 5.80%, refused before E8 and refused after it.
    why = comparable_heldout(held(19.9, 0.0471), held(30.7, 0.0580))
    assert why is not None and "out-of-vocabulary" in why
    # The matched pair E6 relies on shares an OOV rate and passes.
    assert comparable_heldout(held(30.7, 0.05798), held(64.1, 0.05798)) is None


#: The re-measured cells, and the perplexity each scored on the frozen set. Backlog 82 / D27.
B82_CELLS = {"b82-shipped": 25.82, "b82-cellA": 19.94, "b82-cellB": 64.29, "b82-cellC": 154.81}


def test_the_re_measured_cells_carry_a_fingerprint_and_read_no_prose():
    """D26 took the repository's own prose out of every measurement. These are the runs that make that
    true of the figures as well as of the code."""
    from adhd_analysis.text.corpora import Library

    mutable = Library.load(ROOT / "analysis" / "corpora.yaml").mutable_names()
    for name in B82_CELLS:
        r = record(name)
        assert r["corpus_fingerprint"], f"{name} carries no training fingerprint"
        names = {s["name"] for s in r["sources"]}
        assert names.isdisjoint(mutable), f"{name} read text a commit can rewrite: {sorted(names)}"
    # The two n-gram cells read the whole training side and the two neural cells a 20M-token prefix, so
    # two digests are expected and three would mean something moved mid-run.
    prints = {record(n)["corpus_fingerprint"] for n in B82_CELLS}
    assert len(prints) == 2, f"the re-measurement did not hold two corpus reads: {prints}"


def test_d27_quotes_the_figures_it_re_measured(readmes):
    """Every re-measured perplexity appears in the decisions log, and the pre-D26 caveat is gone from
    both READMEs — it warned about figures that no longer describe anything published."""
    decisions = docs("docs/DECISIONS.md")
    assert "## D27." in decisions
    for name, ppl in B82_CELLS.items():
        assert f"{ppl:g}" in decisions, f"D27 no longer quotes {name}'s {ppl}"
    for where in SHIPPED_CLAIM_SITES:
        text = (ROOT / where).read_text()
        assert "post-D26" in text, f"{where} does not say which corpus its figures come from"
        assert "pre-D26 figures" not in text, f"{where} still carries the superseded caveat"
    assert "25.82" in readmes, "the shipped figure is no longer stated"


def test_the_re_measurement_left_every_registered_band_intact():
    """The claims, not the numbers. E6 registered 1.5x-to-3x before it ran; if the re-measurement had
    pushed the ratio out of that band, D21 would be a different decision rather than a rounded one."""
    shipped, a, b, c = (record(n) for n in ("b82-shipped", "b82-cellA", "b82-cellB", "b82-cellC"))
    aprime = record("e8-v0")  # A′'s configuration exactly, so E8's sweep re-measured it
    assert aprime["vocab_size"] == 8192 and aprime["min_count"] == 3 and aprime["order"] == 4
    ppl = B82_CELLS
    e6 = ppl["b82-cellB"] / 30.95
    assert 1.5 < e6 < 3.0, f"E6's ratio left its registered band at {e6:.3f}x"
    assert f"{e6:.3f}x" in docs("docs/DECISIONS.md"), f"D27 does not quote E6's new ratio {e6:.3f}x"
    # E7 predicted C between 40 and 60. It was wrong before and it is wrong the same way now.
    assert ppl["b82-cellC"] > 60, "E7's prediction stopped being wrong, which would be a new result"
    # And the shape of each cell is unchanged, or the comparison is between different models.
    assert b["config"]["d_model"] == c["config"]["d_model"] == 128
    assert b["config"]["n_layers"] == c["config"]["n_layers"] == 2
    assert b["stopped_because"] == c["stopped_because"] == "epochs"
    assert a["vocab_size"] == 8192 and shipped["vocab_size"] > 100_000


def test_the_manifest_marks_the_prose_mutable_and_the_docs_say_why():
    """The manifest is `config/`, which this repository treats as the product. A `mutable: true` nobody
    explained is a flag someone deletes."""
    from adhd_analysis.text.corpora import Library

    manifest_path = ROOT / "analysis" / "corpora.yaml"
    # Parsed, not grepped: the file's own header explains the flag, so counting the string counts the
    # explanation too. The first version of this test did, and asserted 4 == 3.
    assert Library.load(manifest_path).mutable_names() == {"repo-docs", "repo-prompts", "repo-readme"}
    manifest = manifest_path.read_text()
    assert "D26" in manifest, "the manifest does not say which decision put the flag there"
    decisions = docs("docs/DECISIONS.md")
    assert "## D26." in decisions
    for figure in ("4,807", "0.105%", "mutable: true"):
        assert figure in decisions, f"D26 no longer quotes {figure}"
