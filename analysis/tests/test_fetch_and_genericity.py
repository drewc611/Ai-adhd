"""The fetcher's refusals, and the genericity report's honesty about its own numbers.

Nothing here touches the network. What is worth testing about a downloader is what it refuses,
and every refusal is a pure function of the URL or the response headers.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

_spec = importlib.util.spec_from_file_location("fetch_corpus", ROOT / "analysis" / "scripts" / "fetch_corpus.py")
fetch_corpus = importlib.util.module_from_spec(_spec)
sys.modules["fetch_corpus"] = fetch_corpus
_spec.loader.exec_module(fetch_corpus)  # type: ignore[union-attr]


@pytest.mark.parametrize(
    "url,why",
    [
        ("http://www.rfc-editor.org/rfc/rfc1.txt", "not https"),
        ("https://example.com/rfc1.txt", "no allowlisted prefix"),
        ("https://huggingface.co/model/resolve/main/model.safetensors", "no allowlisted prefix"),
        # The host is allowlisted for one repository and serves every public repository on GitHub.
        ("https://raw.githubusercontent.com/evil/repo/master/x.md", "another repository on an allowed host"),
        # Inside an allowed prefix, resolving outside it. A raw `startswith` passes this.
        ("https://raw.githubusercontent.com/python/peps/main/peps/../../../evil/repo/main/x.md", "traversal"),
        # The same, percent-encoded. A check that forgot to decode passes this.
        ("https://raw.githubusercontent.com/python/peps/main/peps/%2e%2e/%2e%2e/evil/x.md", "encoded traversal"),
        ("https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/weights.safetensors", "refused extension"),
        ("https://www.rfc-editor.org/rfc/corpus.tar", "refused extension"),
    ],
)
def test_the_fetcher_refuses_before_it_connects(url, why):
    """Each of these is refused from the URL alone, so a refusal costs no request.

    The last two traversal cases were found by testing the allowlist against its own bypasses rather
    than against the URLs it was written for. Both passed the first version of the check.
    """
    with pytest.raises(fetch_corpus.FetchRefused):
        fetch_corpus._check_url(url)


def test_the_allowlist_is_prefixes_and_covers_every_declared_source():
    """Prefixes rather than hosts, and derived from the sources rather than restated.

    A host allowlist containing `raw.githubusercontent.com` would allow every public repository on
    GitHub. Every prefix here names a repository and a directory inside it.
    """
    prefixes = fetch_corpus.allowed_prefixes()
    assert prefixes, "the allowlist is empty"
    for p in prefixes:
        assert p.startswith("https://"), p
        assert p.endswith("/"), f"{p} is not a directory prefix, so it matches sibling paths"
        assert p.count("/") >= 4, f"{p} is a bare host, which allows more than one corpus"

    # Every source's own template must satisfy the allowlist its prefixes contribute to. A source
    # whose template does not match its prefix is a source that can never fetch anything.
    for source in fetch_corpus.SOURCES.values():
        fetch_corpus._check_url(source.template.format(n=1))
        assert any(source.template.startswith(p) for p in source.prefixes), source.name


def test_every_source_records_a_licence_and_where_it_was_verified():
    """A corpus whose terms nobody wrote down is a corpus nobody checked."""
    for source in fetch_corpus.SOURCES.values():
        assert source.licence, f"{source.name} has no licence"
        assert source.licence_url.startswith("https://"), f"{source.name} has no verifiable licence url"
    # The one source that is not under a free licence must say so rather than reading like the rest.
    assert "not a free licence" in fetch_corpus.SOURCES["rfc"].licence
    for name in ("pep", "eip"):
        assert "CC0" in fetch_corpus.SOURCES[name].licence

    # Recorded rather than guessed at: licence verified, enumeration not implemented.
    assert set(fetch_corpus.UNIMPLEMENTED) == {"rust-rfcs", "k8s-keps"}
    for lic, url in fetch_corpus.UNIMPLEMENTED.values():
        assert lic and url.startswith("https://")


def test_the_refusal_list_covers_the_weight_formats():
    for ext in [".safetensors", ".gguf", ".ggml", ".ckpt", ".pt", ".pth", ".onnx", ".bin", ".h5", ".pb"]:
        assert ext in fetch_corpus.REFUSED_SUFFIXES, ext


def test_the_permitted_url_shapes_pass():
    for source in fetch_corpus.SOURCES.values():
        fetch_corpus._check_url(source.template.format(n=42))


def test_candidates_spread_across_the_range_rather_than_taking_the_lowest():
    """The early documents in every one of these series are short procedural memos.

    Taking the first N would train a model of 1970s teletype conventions and call it technical prose.
    """
    source = fetch_corpus.SOURCES["eip"]
    spread = fetch_corpus.candidates(source, 20, spread=True)
    lowest = fetch_corpus.candidates(source, 20, spread=False)
    assert lowest == list(range(1, 21))
    assert max(spread) > source.highest // 2, "the spread never reaches the modern half of the range"
    assert spread == sorted(spread) and len(set(spread)) == len(spread)


def test_the_genericity_report_names_its_corpus_and_counts_its_comparisons():
    """Both are things the report gets wrong by omission rather than by error.

    A surprisal figure without the corpus beside it is uninterpretable, because the measure
    inverts with what it trained on. And two unpreregistered comparisons on 35 artifacts is the
    setting where a nominal 0.048 gets quoted as a finding.
    """
    from collections import Counter

    from adhd_analysis.corpus import load
    from adhd_analysis.text.genericity import report
    from adhd_analysis.text.ngram import KneserNey, count_ngrams
    from adhd_analysis.text.budget import Budget
    from adhd_analysis.text.tokenize import Vocab, tokens

    text = ["the critic prunes an artifact under objection ."] * 60 + ["a branch records one trap ."] * 60
    freq: Counter[str] = Counter()
    for s in text:
        freq.update(tokens(s))
    vocab = Vocab.build(freq, min_count=1)
    b = Budget.smoke()
    top, meta = count_ngrams((vocab.encode(tokens(s)) for s in text), 3, b, vocab)
    m = KneserNey(order=3, vocab=vocab, counts=[{}, {}, top], meta={**meta, "sources": [{"name": "toy", "files": 1}]}).seal()

    out = report(load(ROOT), m, resamples=200)
    assert "`toy`" in out, "the report quotes surprisal without naming what produced it"
    assert "comparison(s) are reported above and neither is preregistered" in out
    assert "Name the corpus or do not quote the number." in out
