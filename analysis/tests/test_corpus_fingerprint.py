"""The training side gets the same identity the scoring side has had since D16.

`HeldOut.fingerprint` exists because two perplexities from different text are two numbers about two
tests. The training side had no equivalent, and on this repository that is a live hazard rather than a
tidiness complaint: `docs/`, `prompts/` and `README.md` are sources in `corpora.yaml`, so **writing
down an experiment changes the corpus that experiment is about.**

E8 walked into it. Its registration planned to reuse E6's cell A' unchanged; the commit carrying that
registration added 94 lines to `docs/EXPERIMENTS.md`, and `docs/SECURITY-OPS.md` had arrived in the
meantime as a fourteenth document. Between them the training read moved from 20,000,029 tokens to
20,000,139 and the types clearing `min_count` 3 moved from 71,883 to 71,934. The only reason it was
caught is that E8 registered the expected type count in advance. Nothing in the code said a word.

These tests are what says a word.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from adhd_analysis.text.budget import Budget
from adhd_analysis.text.corpora import Library, Source
from adhd_analysis.text.corpusread import sentence_tokens
from adhd_analysis.text.evaluate import comparable_training
from adhd_analysis.text.train import train

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "analysis" / "corpora.yaml"


def digest_of(library: Library, budget: Budget | None = None) -> str:
    d = hashlib.sha256()
    b = budget or Budget(max_tokens=10**9, max_seconds=120, max_ngrams=10**9, max_rss_mb=10**6)
    for _ in sentence_tokens(library, b, d):
        pass
    return d.hexdigest()[:16]


def corpus(root: Path, *docs: str) -> Library:
    root.mkdir(parents=True, exist_ok=True)
    for i, text in enumerate(docs):
        (root / f"{i:03d}.txt").write_text(text)
    return Library([Source(name="t", path=root, include=["*.txt"])])


def test_the_same_corpus_read_twice_gives_the_same_digest(tmp_path):
    lib = corpus(tmp_path / "c", "The reviewer prunes the artifact.", "A second document here.")
    assert digest_of(lib) == digest_of(lib)


def test_one_changed_character_changes_the_digest(tmp_path):
    a = corpus(tmp_path / "a", "The reviewer prunes the artifact.")
    b = corpus(tmp_path / "b", "The reviewer prunes the artifacts.")
    assert digest_of(a) != digest_of(b)


def test_the_digest_sees_a_regrouping_no_token_count_would_show(tmp_path):
    """Why the digest carries a separator between tokens.

    `["ab", "c"]` and `["a", "bc"]` are two tokens either way and four characters either way. Without a
    separator they hash identically, which would make the digest blind to exactly the failure it is
    here to catch: `comparable_heldout` carries a comment about a tokenizer change that moved the
    shipped baseline from 25.65 to 25.82 with the content fingerprint and the document count agreeing
    throughout.
    """
    a = corpus(tmp_path / "a", "ab c")
    b = corpus(tmp_path / "b", "a bc")
    da, db = digest_of(a), digest_of(b)
    assert da != db
    # And the thing that would have hidden it: same token count, same character count.
    lens = []
    for lib in (a, b):
        bud = Budget(max_tokens=10**9, max_seconds=120, max_ngrams=10**9, max_rss_mb=10**6)
        lens.append([len(ts) for ts in sentence_tokens(lib, bud)])
    assert lens[0] == lens[1] == [[2]][0], lens


def test_document_order_changes_the_digest(tmp_path):
    """A stream digest, not a set digest. Two corpora holding the same documents in a different order
    train differently under a ceiling that stops partway, so they are not the same read."""
    a = corpus(tmp_path / "a", "alpha one.", "beta two.")
    b = corpus(tmp_path / "b", "beta two.", "alpha one.")
    assert digest_of(a) != digest_of(b)


def test_a_tighter_ceiling_gives_a_different_digest(tmp_path):
    """The digest stops where the budget stopped, partway through a document, which is the property a
    per-document digest cannot have.

    Two things about the ceiling are worth knowing while reading a digest, and writing this test found
    both. It is *polled*, not enforced — at the default 20,000-token interval a 50-token ceiling over
    an 800-token corpus is never consulted and the read runs to the end. And `sentences()` splits on
    newlines rather than on sentence punctuation, so a document written as one long line is one
    sentence and **no ceiling can cut it**: the budget is spent before the yield and checked after it.
    The first version of this test made both mistakes at once and passed a corpus of 400 periods that
    the tokenizer read as a single 800-token sentence.
    """
    lib = corpus(tmp_path / "c", "\n".join(f"Word{i} thing{i}." for i in range(400)))
    whole = digest_of(lib)
    tight = digest_of(
        lib, Budget(max_tokens=50, max_seconds=120, max_ngrams=10**9, max_rss_mb=10**6, check_every=1)
    )
    assert whole != tight


def test_a_real_training_run_records_both_digests_and_they_agree(tmp_path):
    """The invariant this module's docstring has promised since it was written, now mechanical.

    "Both passes read files in sorted order under the same ceilings, so a budget that stops pass one
    halfway through a directory stops pass two at the same place." Equal token counts were the only
    evidence for that, and equal token counts are not equal tokens.
    """
    tight = Budget(max_tokens=6000, max_seconds=120, max_ngrams=10**9, max_rss_mb=10**6, check_every=500)
    rec = train(Library.load(MANIFEST), tmp_path / "t.kn.gz", order=3, min_count=1, budget=tight)
    assert rec.corpus_fingerprint and len(rec.corpus_fingerprint) == 16
    assert rec.corpus_fingerprint == rec.vocabulary_fingerprint
    assert rec.to_dict()["vocabulary_covers_counts"] is True


def test_two_runs_over_one_corpus_are_comparable_and_an_edited_one_is_not(tmp_path):
    """The E8 failure, reproduced small: a corpus document is edited between two runs, both report the
    same token count, and only the fingerprint tells them apart."""
    root = tmp_path / "c"
    text = " ".join(f"clause{i} holds and the actor waits." for i in range(200))
    lib = corpus(root, text)
    budget = lambda: Budget(max_tokens=10**9, max_seconds=120, max_ngrams=10**9, max_rss_mb=10**6)

    a = train(lib, tmp_path / "a.kn.gz", order=3, min_count=1, budget=budget()).to_dict()
    b = train(lib, tmp_path / "b.kn.gz", order=3, min_count=1, budget=budget()).to_dict()
    assert comparable_training(a, b) is None

    # Two clause numbers traded with each other, so every type still appears exactly once and the
    # token count, the type count and the n-gram count all hold still. This is the shape of the real
    # thing: nothing in any other field moves.
    swapped = text.replace("clause7 ", "\x00 ").replace("clause8 ", "clause7 ").replace("\x00 ", "clause8 ")
    assert swapped != text
    (root / "000.txt").write_text(swapped)
    c = train(lib, tmp_path / "c.kn.gz", order=3, min_count=1, budget=budget()).to_dict()
    assert c["tokens_seen"] == a["tokens_seen"]
    assert c["vocab_size"] == a["vocab_size"]
    why = comparable_training(a, c)
    assert why is not None and "different text" in why
    assert "Equal token counts are not equal tokens" in why


def test_comparable_training_refuses_a_record_from_before_the_fingerprint():
    old = {"tokens_seen": 20_000_029}
    new = {"corpus_fingerprint": "abcd1234abcd1234", "tokens_seen": 20_000_139}
    assert "before the training corpus carried a fingerprint" in comparable_training(old, new)
    assert "the second of these" in comparable_training(new, old)


def test_comparable_training_refuses_a_vocabulary_that_does_not_cover_its_counts():
    bad = {"corpus_fingerprint": "aaaa", "vocabulary_covers_counts": False}
    good = {"corpus_fingerprint": "aaaa"}
    why = comparable_training(bad, good)
    assert why is not None and "vocabulary does not cover" in why
    # A neural record carries the two digests with no boolean, because its corpus pass stops at
    # `max_train_tokens` while its vocabulary pass does not. Absence must not read as False.
    assert comparable_training(good, good) is None


# --- D26: mutable sources stay out of a measurement -------------------------------------------


def test_the_manifest_marks_the_repositorys_own_prose_mutable():
    """One place for the fact, and it is `corpora.yaml`. It used to be a set literal in
    `cut_heldout.py` and in two tests, which is three places for one fact about the corpus."""
    lib = Library.load(MANIFEST)
    assert lib.mutable_names() == {"repo-docs", "repo-prompts", "repo-readme"}
    assert {s.name for s in lib.stable().sources}.isdisjoint(lib.mutable_names())
    assert lib.stable().sources, "the manifest declares nothing repeatable to train on"


def test_the_trainer_excludes_mutable_sources_unless_asked(tmp_path, capsys):
    """The guard D26 turns on, at the only layer that can enforce it.

    `train()` itself takes whatever library it is handed — deliberately, because leave-one-source-out
    evaluation needs that — so the exclusion lives in the CLI, which is what every measurement in this
    repository actually invokes.
    """
    from adhd_analysis.text.train import main

    out = tmp_path / "m.kn.gz"
    rec = tmp_path / "m.json"
    argv = [
        "--manifest", str(MANIFEST), "--out", str(out), "--record", str(rec),
        "--order", "3", "--min-count", "1", "--max-tokens", "4000", "--max-seconds", "120",
    ]
    assert main(argv) == 0
    capsys.readouterr()
    names = {s["name"] for s in json.loads(rec.read_text())["sources"]}
    assert names.isdisjoint(Library.load(MANIFEST).mutable_names()), (
        f"a measurement read text a commit can rewrite: {sorted(names)}"
    )

    # And the opt-in really does opt in, or the smoke test on a clean checkout has no way to run.
    rec2 = tmp_path / "m2.json"
    assert main(argv[:2] + ["--out", str(tmp_path / "m2.kn.gz"), "--record", str(rec2)]
               + argv[6:] + ["--include-mutable-sources"]) == 0
    capsys.readouterr()
    names2 = {s["name"] for s in json.loads(rec2.read_text())["sources"]}
    assert names2 & Library.load(MANIFEST).mutable_names()


def test_a_manifest_of_nothing_but_mutable_sources_refuses_rather_than_trains(tmp_path, capsys):
    """The one case where excluding by default could silently train on nothing. It says so instead."""
    from adhd_analysis.text.train import main

    (tmp_path / "prose").mkdir()
    (tmp_path / "prose" / "a.md").write_text("One document, and a commit can rewrite it.\n")
    manifest = tmp_path / "only-mutable.yaml"
    manifest.write_text(
        "corpora:\n"
        "  - name: repo-docs\n"
        f"    path: {tmp_path / 'prose'}\n"
        '    include: ["**/*.md"]\n'
        "    mutable: true\n"
    )
    with pytest.raises(SystemExit) as e:
        main(["--manifest", str(manifest), "--out", str(tmp_path / "x.kn.gz")])
    assert "nothing repeatable to train on" in str(e.value)
    assert "--include-mutable-sources" in str(e.value)


def test_the_frozen_held_out_set_and_the_training_read_now_agree_on_what_is_unfit():
    """`cut_heldout.py` excluded mutable sources from the frozen set from the start and left them in the
    training half on purpose. D26 removes the asymmetry, and this asserts both halves read the same
    rule from the same place."""
    lib = Library.load(MANIFEST)
    spec = json.loads((ROOT / "analysis" / "heldout.json").read_text())
    held_sources = {n.split("/")[0] for n in spec["documents"]}
    assert held_sources.isdisjoint(lib.mutable_names())
    assert held_sources <= {s.name for s in lib.stable().sources}
