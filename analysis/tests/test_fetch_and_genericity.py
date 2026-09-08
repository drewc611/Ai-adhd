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
        ("https://example.com/rfc1.txt", "allowlist"),
        ("https://huggingface.co/model/resolve/main/model.safetensors", "allowlist"),
        ("https://www.rfc-editor.org/x/weights.safetensors", "refused extension"),
        ("https://www.rfc-editor.org/x/corpus.tar", "refused extension"),
        ("https://www.rfc-editor.org/x/lib.so", "refused extension"),
    ],
)
def test_the_fetcher_refuses_before_it_connects(url, why):
    """Each of these is checked from the URL alone, so a refusal costs no request.

    The host allowlist is the load-bearing one. D10's argument is that a job which can fetch is a
    job which can fetch weights, and the answer was not "we would not do that" but a list of one
    host that cannot serve them.
    """
    with pytest.raises(fetch_corpus.FetchRefused):
        fetch_corpus._check_url(url)


def test_the_allowlist_is_one_host_and_the_refusal_list_covers_the_weight_formats():
    assert fetch_corpus.ALLOWED_HOSTS == {"www.rfc-editor.org"}
    for ext in [".safetensors", ".gguf", ".ggml", ".ckpt", ".pt", ".pth", ".onnx", ".bin", ".h5", ".pb"]:
        assert ext in fetch_corpus.REFUSED_SUFFIXES, ext


def test_the_permitted_url_shape_passes():
    fetch_corpus._check_url("https://www.rfc-editor.org/rfc/rfc9000.txt")
    fetch_corpus._check_url(fetch_corpus.INDEX_URL)


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
