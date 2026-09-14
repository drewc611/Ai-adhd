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


def test_the_readmes_quote_post_d26_figures_where_they_say_they_do():
    """The README asserts "Every figure here is post-D26" and quoted the pre-D26 ones. D27 recorded
    both columns; only one of them belongs in a README.

    D27's rule is asymmetric on purpose and both halves are checked here. `docs/DECISIONS.md` keeps
    D21's and D24's text — a recorded result is what the reader was shown — while the READMEs move,
    "because the figures they warned about no longer describe anything published". So a stale figure
    is a defect in a README and evidence in the decisions log, and a test that treated them alike
    would force one of the two to be wrong.

    Ratios are checked unbolded as well as bolded. The first version of this test looked only for
    `\\*\\*2.09x\\*\\*`, and `analysis/README.md` writes "a 2.09x loss" and "Neither covers 2.09x" — two
    stale ratios in the file, inside the test's remit, invisible to it.
    """
    for where in ("README.md", "analysis/README.md"):
        text = (ROOT / where).read_text()
        for stale, current in (("64.1", "64.29"), ("30.7", "30.95"), ("159.3", "154.81")):
            assert f"**{stale}**" not in text, f"{where} still quotes the pre-D26 {stale}, not {current}"
        # A stale ratio is allowed in a paragraph that also carries its replacement, because stating
        # the move is exactly what D27 asks a README to do — "E6's ratio moved 2.086x to 2.077x" is
        # correct and a blanket ban would forbid it. Stating it *alone* is the defect.
        #
        # The unit is the paragraph, not the line. Per line was the first attempt and it failed on
        # that very sentence: these files are hard-wrapped, so "moved 2.086x to" ends one line and
        # "**2.077x**" begins the next. A prose rule enforced per line is a rule about where the
        # author pressed return.
        for stale, current in (("2.09x", "2.077x"), ("2.086x", "2.077x"),
                               ("2.49x", "2.408x"), ("2.485x", "2.408x"), ("5.18x", "5.00x")):
            for para in re.split(r"\n\s*\n", text):
                if stale in para:
                    assert current in para, (
                        f"{where} quotes the pre-D26 {stale} without {current} in the same paragraph:\n"
                        f"  {' '.join(para.split())[:200]}"
                    )
        assert "2.077x" in text, f"{where} does not quote E6's post-D26 ratio"
    root = (ROOT / "README.md").read_text()
    assert "Every figure here is **post-D26**" in root, "the claim this checks has moved"
    for current in ("64.29", "30.95", "154.81"):
        assert f"**{current}**" in root, f"the README does not quote the post-D26 {current}"

    # The other half of D27's rule: the decisions log keeps what it recorded.
    decisions = docs("docs/DECISIONS.md")
    for kept in ("64.1", "30.7", "2.086x"):
        assert kept in decisions, f"D21's recorded {kept} was rewritten; D27 says it stays"


def test_both_readmes_carry_the_e9_result_that_removes_the_cap_excuse():
    """D21's figures are all at 8,192 types, a vocabulary reached by capping the n-gram. A README
    that states them without D28 leaves the reader with E6's open question and no answer to it."""
    for where in ("README.md", "analysis/README.md"):
        text = (ROOT / where).read_text()
        assert "142.41" in text, f"{where} does not carry E9's result"
        assert "0.915101%" in text, f"{where} does not say why the pair is comparable"
        assert "3.5" in text and "less text" in text, f"{where} states the ratio without its asymmetry"


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


# --- E9 / D28: the transformer at the n-gram's own vocabulary ------------------------------------

#: Measured. Cell D and the shipped model on frozen set `1446762140db7f1a`, all targets.
D28_CELL_D = 142.408
D28_SHIPPED = 25.815
#: The sampled estimator against the full softmax on the same final batch. Reported, not assumed away.
D28_SAMPLED_LOSS, D28_FULL_LOSS = 4.6145, 3.9352


def test_d28_cell_d_ran_at_the_shipped_vocabulary_with_no_ceiling_binding():
    """E9's first fixed reading: a ceiling that binds voids the cell."""
    d = record("e9-cellD")
    assert d["vocab_size"] == 148_114, "cell D is the transformer at the n-gram's vocabulary or it is nothing"
    assert d["stopped_because"] == "epochs", f"a budget bound and the cell is void: {d['stopped_because']}"
    assert d["epochs_completed"] > 0.999, f"cell D saw less text than registered: {d['epochs_completed']}"
    assert d["config"]["d_model"] == 128 and d["config"]["n_layers"] == 2, "the shape moved from E6's"


def test_d28_reports_the_sampled_softmax_gap_rather_than_assuming_it_away():
    """The gap is 0.68 nats and it is large. It does not touch the perplexity, because scoring uses
    the full normalised distribution — but a cell trained against the full softmax might land
    elsewhere, and that is the caveat D28 has to carry rather than bury."""
    d = record("e9-cellD")
    assert d["full_loss_on_last_batch"] is not None, "the full-softmax reading was not taken"
    assert abs(d["final_loss"] - D28_SAMPLED_LOSS) < 0.01
    assert abs(d["full_loss_on_last_batch"] - D28_FULL_LOSS) < 0.01
    gap = d["final_loss"] - d["full_loss_on_last_batch"]
    assert gap > 0, "the estimator reported the model as better than it is, which is the dangerous sign"
    assert f"{gap:.3f}" in docs("docs/DECISIONS.md"), f"D28 does not quote the gap it measured ({gap:.3f})"


def test_d28_quotes_its_result_and_the_asymmetry_that_qualifies_it():
    decisions = docs("docs/DECISIONS.md")
    assert "## D28." in decisions
    for figure in (f"{D28_CELL_D:.3f}", f"{D28_SHIPPED:.3f}", f"{D28_CELL_D / D28_SHIPPED:.3f}x"):
        assert figure in decisions, f"D28 no longer quotes {figure}"
    # The asymmetry is registered as something quoted with every cell D figure, so it is checked
    # rather than trusted: a ratio published without it reads as a fair fight and is not.
    d = record("e9-cellD")
    assert f"{d['budget_corpus']['tokens']:,}" in decisions, "D28 does not say how much text cell D read"
    assert "64,347,232" in decisions, "D28 does not say how much text the shipped model read"
    assert "3.51x less" in decisions, "D28 does not state the text asymmetry"


def test_d28_records_that_comparable_heldout_accepted_the_pair():
    """The reason the cell exists. E6 could compare only by capping the n-gram; this pair needs no
    handicap, and the acceptance is what makes the 5.52x mean anything."""
    from adhd_analysis.text.evaluate import HeldOut, comparable_heldout

    def held(ppl, oov):
        return HeldOut(truncated=None, documents=366, sentences=148_153, tokens=3_443_116,
                       in_vocabulary=3_411_608, oov_rate=oov, perplexity=ppl,
                       in_vocabulary_only=False, restricted_to_types=None, fingerprint="1446762140db7f1a")

    oov = 0.009151013210127124
    assert comparable_heldout(held(D28_SHIPPED, oov), held(D28_CELL_D, oov)) is None, \
        "the pair D28 rests on is no longer comparable, which would void the decision"
    # And the pair the amendment wrongly claimed, which is refused: cell B at 5.797% against cell D.
    why = comparable_heldout(held(64.285, 0.05797277814630697), held(D28_CELL_D, oov))
    assert why is not None, "cell B against cell D is comparable now, so D28's correction is stale"
    assert "out-of-vocabulary" in why


#: The shared-vocabulary decomposition: both cells re-scored over the same 8,192 targets.
D28_RESTRICTED_B, D28_RESTRICTED_D = 69.120, 89.229
D28_NAIVE_B, D28_NAIVE_D = 64.285, 142.408


def test_d28_restricted_pair_is_comparable_and_the_naive_one_is_not():
    """The whole decomposition rests on `comparable_heldout` accepting the restricted pair while
    refusing the unrestricted one. If either verdict flips, the 1.291x is not a measurement of
    anything and D28's correction is wrong rather than merely reworded."""
    from adhd_analysis.text.evaluate import HeldOut, comparable_heldout

    def held(ppl, oov, restricted=None, in_vocab=3_411_608):
        return HeldOut(truncated=None, documents=366, sentences=148_153, tokens=3_443_116,
                       in_vocabulary=in_vocab, oov_rate=oov, perplexity=ppl, in_vocabulary_only=False,
                       restricted_to_types=restricted, fingerprint="1446762140db7f1a")

    oov_b, oov_d = 0.05797277814630697, 0.009151013210127124
    assert comparable_heldout(held(D28_NAIVE_B, oov_b, in_vocab=3_243_509), held(D28_NAIVE_D, oov_d)) is not None, \
        "the unrestricted pair is comparable now, so D28's correction is stale"
    assert comparable_heldout(held(D28_RESTRICTED_B, oov_b, 8192, 3_243_509), held(D28_RESTRICTED_D, oov_d, 8192)) is None, \
        "the restricted pair is refused now, so the decomposition cannot be made"
    # And a restriction applied to only one side is refused, which is what makes the pair meaningful.
    assert comparable_heldout(held(D28_RESTRICTED_B, oov_b, 8192, 3_243_509), held(D28_NAIVE_D, oov_d)) is not None


def test_d28_quotes_the_decomposition_and_which_way_each_figure_moved():
    """Both numbers move in opposite directions under restriction and that is the mechanism, not a
    detail: cell B rises because it loses cheap `<unk>` targets, cell D falls because it stops being
    charged for 140,000 rare types. A writeup quoting only the ratio hides why it changed."""
    decisions = docs("docs/DECISIONS.md")
    for figure in (f"{D28_RESTRICTED_B:.3f}", f"{D28_RESTRICTED_D:.3f}",
                   f"{D28_RESTRICTED_D / D28_RESTRICTED_B:.3f}x", f"{D28_NAIVE_D / D28_NAIVE_B:.3f}x"):
        assert figure in decisions, f"D28 no longer quotes {figure}"
    assert "rises" in decisions and "falls" in decisions, "D28 states the ratio without the mechanism"
    # The share of the gap that was the question rather than the model.
    naive_gap = D28_NAIVE_D - D28_NAIVE_B
    moved = naive_gap - (D28_RESTRICTED_D - D28_RESTRICTED_B)
    assert f"{moved:.1f}" in decisions and f"{moved / naive_gap:.0%}" in decisions, \
        f"D28 does not say that {moved:.1f} of {naive_gap:.1f} points ({moved / naive_gap:.0%}) was the question"


def test_the_restricted_result_does_not_touch_the_headline():
    """D28's 5.516x needed no restriction — both models already sat at the same OOV — and a reader
    must not come away thinking the decomposition weakened it."""
    decisions = docs("docs/DECISIONS.md")
    assert "5.516x" in decisions
    tail = decisions[decisions.index("Restricted, the answer is 1.291x"):]
    assert "None of this touches the 5.516x" in tail, "D28 does not say the headline is unaffected"


# --- D29 / backlog 76: what count-pruning actually costs on held-out text --------------------------

D29_UNPRUNED, D29_PRUNED = 25.815, 34.973
D29_UNPRUNED_NGRAMS, D29_PRUNED_NGRAMS = 40_206_913, 16_412_030


def test_d29_the_pruned_cell_differs_from_the_unpruned_one_only_in_pruning():
    """The whole value of 1.355x is that nothing else moved. D14's 2.9x came from a pair that shared
    no split; the original b76 pair read text differing by 846 tokens and one type."""
    pruned, unpruned = record("b76-pruned-heldout"), record("b82-shipped")
    assert pruned["prunes"] > 0, "the pruned cell did not prune, so there is nothing to price"
    assert unpruned.get("prunes", 0) == 0 or "prunes" not in unpruned, "the unpruned cell pruned"
    for field in ("order", "min_count", "vocab_size", "tokens_seen", "corpus_fingerprint"):
        assert pruned[field] == unpruned[field], f"{field} differs, so pruning is not the only variable"
    assert pruned["split"] == unpruned["split"], "the two cells used different splits"
    assert pruned["ngrams"] == D29_PRUNED_NGRAMS and unpruned["ngrams"] == D29_UNPRUNED_NGRAMS


def test_d29_quotes_its_result_and_says_the_prediction_was_wrong():
    """Backlog 76 recorded a prediction — larger than 2.9x — so that it could be wrong. It was wrong
    in the opposite direction, and a decision that quietly drops a failed prediction is worth less
    than the prediction was."""
    decisions = docs("docs/DECISIONS.md")
    assert "## D29." in decisions
    ratio = D29_PRUNED / D29_UNPRUNED
    for figure in (f"{D29_UNPRUNED:.3f}", f"{D29_PRUNED:.3f}", f"{ratio:.3f}x", f"{D29_PRUNED_NGRAMS:,}"):
        assert figure in decisions, f"D29 no longer quotes {figure}"
    assert "2.9x" in decisions, "D29 does not name the figure it supersedes"
    assert "wrong" in decisions.split("## D29.")[1].split("---")[0], "D29 does not say the prediction failed"


def test_d29_pruning_leaves_the_vocabulary_alone_so_the_pair_is_comparable():
    """Pruning drops n-grams and not types, which is why the two OOV rates are identical to every
    digit and why this comparison needs no shared-vocabulary restriction — unlike E9's."""
    from adhd_analysis.text.evaluate import HeldOut, comparable_heldout

    def held(ppl):
        return HeldOut(truncated=None, documents=366, sentences=148_153, tokens=3_443_116,
                       in_vocabulary=3_411_608, oov_rate=0.009151013210127124, perplexity=ppl,
                       in_vocabulary_only=False, restricted_to_types=None, fingerprint="1446762140db7f1a")

    assert comparable_heldout(held(D29_UNPRUNED), held(D29_PRUNED)) is None, \
        "the pair D29 rests on is no longer comparable"
    assert record("b76-pruned-heldout")["vocab_size"] == record("b82-shipped")["vocab_size"]


def test_the_governor_quotes_the_measured_cost_rather_than_the_memorisation_one():
    """`agents/adhd-governor.md` told a reader not to quote 2.9x as measured. It now has a measured
    figure, and a caution that outlives its cause is noise."""
    gov = (ROOT / "agents" / "adhd-governor.md").read_text()
    assert f"{D29_PRUNED / D29_UNPRUNED:.3f}x" in gov, "the governor does not quote the measured cost"
    assert "Do not quote" not in gov or "superseded" in gov, "the superseded caution is still standing alone"
    assert "D29" in gov, "the governor does not say where its figure comes from"


# --- D31 / backlog 77: what reading a genre is worth, with the vocabulary controlled --------------

D31_SHIPPED_ALL, D31_NOPEP_ALL = 53.422, 147.467
D31_SHIPPED_SHARED, D31_NOPEP_SHARED = 49.066, 148.983


def test_d31_the_pair_is_controlled_where_d17s_was_not():
    """D17's pair had min_count 2 against 3 and no split, so the OOV gap was the rare-word difference
    and the PEP difference added together. This pair differs in the `pep` source and nothing else the
    command line controls."""
    nopep, shipped = record("b77-nopep"), record("b82-shipped")
    assert nopep["min_count"] == shipped["min_count"] == 3, "min_count is the confound D17 had"
    assert nopep["split"] == shipped["split"], "the two models trained on different splits"
    assert nopep["order"] == shipped["order"]
    sources = {s["name"] for s in nopep["sources"]}
    assert "pep" not in sources, "the nopep model read PEPs"
    assert {"rfc", "eip", "erc"} <= sources, "the nopep model is missing more than the pep source"
    # And it read less text, which is the confound this pair cannot remove. Recorded, not hidden.
    assert nopep["tokens_seen"] < shipped["tokens_seen"]
    shortfall = 1 - nopep["tokens_seen"] / shipped["tokens_seen"]
    assert f"{shortfall:.1%}" in docs("docs/DECISIONS.md"), f"D31 does not state the {shortfall:.1%} text shortfall"


def test_d31_restriction_widens_the_gap_rather_than_shrinking_it():
    """The opposite of E9's decomposition, and the reason this decision exists. If the direction ever
    flips, the finding is different and the prose is wrong."""
    naive = D31_NOPEP_ALL / D31_SHIPPED_ALL
    restricted = D31_NOPEP_SHARED / D31_SHIPPED_SHARED
    assert restricted > naive, "the gap no longer widens under restriction; D31's finding is inverted"
    decisions = docs("docs/DECISIONS.md")
    for figure in (f"{naive:.3f}x", f"{restricted:.3f}x", f"{D31_SHIPPED_SHARED:.3f}", f"{D31_NOPEP_SHARED:.3f}"):
        assert figure in decisions, f"D31 no longer quotes {figure}"
    # Both halves move, in opposite directions, and each says something different.
    assert D31_SHIPPED_SHARED < D31_SHIPPED_ALL, "shipped should improve when its PEP-only types are dropped"
    assert D31_NOPEP_SHARED > D31_NOPEP_ALL, "nopep should worsen when its cheap <unk> targets are dropped"
    assert "2.83x" in decisions, "D31 does not name the figure it supersedes"


def test_d31_only_the_restricted_pair_is_comparable():
    """The all-targets pair is refused at 1.57% against 3.14% OOV, which is why the restriction is the
    measurement rather than a robustness check."""
    from adhd_analysis.text.evaluate import HeldOut, comparable_heldout

    def held(ppl, oov, restricted=None):
        return HeldOut(truncated=None, documents=31, sentences=0, tokens=128_856,
                       in_vocabulary=int(128_856 * (1 - oov)), oov_rate=oov, perplexity=ppl,
                       in_vocabulary_only=False, restricted_to_types=restricted,
                       fingerprint="8e2d77cbe8901b1e")

    oov_s, oov_n = 0.0157, 0.031392
    assert comparable_heldout(held(D31_SHIPPED_ALL, oov_s), held(D31_NOPEP_ALL, oov_n)) is not None, \
        "the all-targets pair is comparable now, so D31's restriction is unnecessary"
    assert comparable_heldout(held(D31_SHIPPED_SHARED, oov_s, 141_899),
                              held(D31_NOPEP_SHARED, oov_n, 141_899)) is None, \
        "the restricted pair is refused, so the 3.036x is not a measurement of anything"
