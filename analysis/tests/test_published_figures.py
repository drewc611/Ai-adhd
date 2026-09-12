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
    """A record with no `split` and no sources cannot back any claim, whatever numbers it holds."""
    for path in sorted(RECORDS.glob("*.json")):
        r = json.loads(path.read_text())
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
    in a README is one of the figures a checked-in record can account for."""
    known = {"25.82", "30.7", "64.1", "19.9", "6.06", "26.29", "2.09"}
    quoted = set(re.findall(r"perplexity \*\*([\d.]+)\*\*", readmes))
    unknown = quoted - known
    assert not unknown, f"the READMEs quote perplexities nothing accounts for: {sorted(unknown)}"
    assert "25.82" in readmes, "the shipped figure is no longer stated"
    assert "26.29" not in (ROOT / "README.md").read_text(), "26.29 is two revisions stale"
