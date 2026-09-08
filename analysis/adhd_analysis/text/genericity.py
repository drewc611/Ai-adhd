"""What the background model is for: putting a number on T1.

T1 is the consensus trap — a branch that reproduces the answer anyone would give. Its detector is
a written rule over the artifact's own fields, and it works, but it cannot see the thing the trap
is actually about: prose that reads like every other document on the subject. A background model
trained on a document library can. Mean surprisal under that model is low exactly where the
writing is predictable from everything else ever written on the topic.

Two properties of the measure decide whether it is worth anything, and both are reported rather
than assumed:

  - **It is relative to the corpus.** Against this repository's own docs, the sentence "it is
    important to note that this is a comprehensive solution" scores as *surprising*, because the
    docs never write like that. Against a general document library it scores as generic. The
    measure means nothing without naming what it was trained on, so `score_corpus` carries the
    model's source list into its output.
  - **Out-of-vocabulary tokens are not evidence of originality.** A closed vocabulary maps every
    unseen word to `<unk>`, and `<unk>` is common in the training data by construction, so a
    sentence of invented words scores as unremarkable rather than as maximally surprising. Mean
    surprisal is therefore reported over in-vocabulary tokens only, with the OOV rate beside it.

Nothing here changes a run. It reads `evals/recorded/` after the fact, exactly like the rest of
the analysis package, and its output is a report. Moving it into the prune decision would put a
trained model on the deciding side of D9.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from pathlib import Path

import yaml

from ..corpus import Corpus, _forwarder
from ..resample import permutation_test
from .ngram import KneserNey
from .tokenize import tokens

#: `position` and `reasoning` are the argued prose. `forecloses` and `falsifier` are list-shaped
#: and formulaic by contract, so including them would measure the schema, which is the mistake
#: D8 finding 5 caught the rubric making.
SCORED_FIELDS = ("position", "reasoning")


@dataclass
class Scored:
    run: str
    frame: str
    status: str
    fired: list[str]
    words: int
    mean_surprisal: float
    oov_rate: float

    @property
    def pruned(self) -> bool:
        return self.status == "pruned"


def artifact_text(path: Path) -> str:
    doc = yaml.safe_load(path.read_text()) or {}
    return "\n".join(str(doc.get(f, "")) for f in SCORED_FIELDS)


def score_text(model: KneserNey, text: str) -> tuple[float, float, int]:
    ts = tokens(text)
    if not ts:
        return float("nan"), 0.0, 0
    known = [t in model.vocab.stoi for t in ts]
    ids = model.vocab.encode(ts)
    bits = model.surprisal(ids)
    in_vocab = [b for b, k in zip(bits, known) if k]
    oov = 1.0 - (sum(known) / len(known))
    return (statistics.fmean(in_vocab) if in_vocab else float("nan")), oov, len(ts)


def score_corpus(corpus: Corpus, model: KneserNey) -> list[Scored]:
    forward = _forwarder(corpus.root)
    out: list[Scored] = []
    for art in corpus.artifacts:
        branches = corpus.root / "evals" / "recorded" / art.run / "branches"
        p = branches / f"{art.frame}.yaml"
        if not p.exists():
            # The loader forwards `former_ids`; the filesystem does not. A run that wrote
            # END_USER.yaml still holds the frame now called SUPPLICANT, and dropping it here
            # would silently shrink the sample by the frames that were ever renamed.
            p = next((c for c in sorted(branches.glob("*.yaml")) if forward(c.stem) == art.frame), None)
            if p is None:
                continue
        mean, oov, n = score_text(model, artifact_text(p))
        if mean != mean:
            continue
        out.append(Scored(art.run, art.frame, art.status, list(art.fired), n, mean, oov))
    return out


def report(corpus: Corpus, model: KneserNey, resamples: int = 10_000) -> str:
    rows = score_corpus(corpus, model)
    if not rows:
        return "## Genericity\n\nNo artifact could be scored: the model and the corpus do not overlap.\n"

    sources = ", ".join(f"{s['name']} ({s['files']} files)" for s in model.meta.get("sources", []))
    lines = [
        "## Genericity under the background model",
        "",
        f"Trained on: {sources or 'unrecorded'}",
        f"Order {model.order}, vocabulary {len(model.vocab):,}, "
        f"{sum(len(t) for t in model.counts):,} n-grams, OOV rate at training {model.meta.get('oov_rate', '?')}.",
        "",
        "Mean surprisal in bits over in-vocabulary tokens. Lower means the prose was more",
        "predictable from the training library, which is what T1 is about.",
        "",
        f"{'run':22} {'frame':18} {'status':9} {'bits':>6} {'oov':>6} {'words':>6}",
    ]
    for r in sorted(rows, key=lambda x: x.mean_surprisal):
        lines.append(
            f"{r.run:22} {r.frame:18} {r.status:9} {r.mean_surprisal:6.2f} {r.oov_rate:6.0%} {r.words:6}"
        )

    pruned = [r.mean_surprisal for r in rows if r.pruned]
    kept = [r.mean_surprisal for r in rows if not r.pruned]
    lines += ["", f"pruned n={len(pruned)}, kept n={len(kept)}"]
    if len(pruned) >= 3 and len(kept) >= 3:
        obs, p = permutation_test(pruned, kept, resamples=resamples)
        lines += [
            f"  mean pruned {statistics.fmean(pruned):.2f} bits, mean kept {statistics.fmean(kept):.2f} bits",
            f"  difference {obs:+.3f} bits, permutation p = {p:.4f}",
            "",
            "A difference here would say the critic and the trap detectors are pruning prose the",
            "background model already finds predictable, which is T1 measured instead of asserted.",
            "No difference says the detectors are catching something the surface statistics miss,",
            "which is the better outcome for a repository whose detectors are the product.",
        ]

    t1 = [r.mean_surprisal for r in rows if "T1" in r.fired]
    rest = [r.mean_surprisal for r in rows if "T1" not in r.fired]
    if len(t1) >= 3 and len(rest) >= 3:
        obs, p = permutation_test(t1, rest, resamples=resamples)
        lines += [
            "",
            f"T1 fired on {len(t1)} artifacts: mean {statistics.fmean(t1):.2f} bits against "
            f"{statistics.fmean(rest):.2f} for the rest, difference {obs:+.3f}, p = {p:.4f}.",
        ]
    elif t1:
        lines += ["", f"T1 fired on {len(t1)} artifact(s), too few to test against the rest."]

    lines += [
        "",
        "Read the sign before the size. This measure is relative to the training library: against",
        "a corpus of this repository's own docs, prose that reads like a consultancy report scores",
        "as surprising rather than generic, and the comparison inverts. Name the corpus or do not",
        "quote the number.",
    ]
    return "\n".join(lines) + "\n"
