"""Load the recorded corpus into arrays.

This package reads `evals/recorded/` and nothing else. It never calls a model, never runs
during a run, and nothing in `src/` imports it — the whole of D2 rests on the reasoning being
done by isolated subagents, and a Python process that scored or clustered anything would be an
inference client with a different accent. What it does instead is measure what the corpus can
support, which at seven runs is the question the repository most needs answered about itself.

The loader is deliberately strict about one thing: a frame id is forwarded through
`former_ids` before anything is counted. Two runs wrote `END_USER` for the frame now called
`SUPPLICANT`, and an analysis that pooled them as two frames would report per-frame statistics
for a library that does not exist.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import yaml

# Raters are files, in this order. `pass-a.yaml` is the one that shipped; the rest were scored
# later from the same blind brief, by fresh critics instructed to read no other file.
RATER_FILES = ["pass-a.yaml", "pass-a.rater2.yaml", "pass-a.rater3.yaml", "pass-a.rater4.yaml"]


@dataclass(frozen=True)
class Dimension:
    id: str
    weight: int
    anchors: int


@dataclass
class Artifact:
    """One frame's output in one run, with whatever the corpus knows about it."""

    run: str
    frame: str
    status: str
    pass_a: float | None
    cluster: str | None
    fired: list[str] = field(default_factory=list)
    words: int = 0


@dataclass
class Corpus:
    root: Path
    dimensions: list[Dimension]
    artifacts: list[Artifact]
    #: (run, rater, blind letter, dimension) -> score. Blind letters, because pass A is blind and
    #: the whole point of the second rater is that it never saw which frame it was scoring.
    scores: dict[tuple[str, int, str, str], int]
    #: run -> {blind letter: frame id}, forwarded through former_ids.
    blind_maps: dict[str, dict[str, str]]

    @property
    def runs(self) -> list[str]:
        return sorted({a.run for a in self.artifacts})

    def raters_for(self, run: str) -> list[int]:
        return sorted({r for (rn, r, _, _) in self.scores if rn == run})

    def multi_rated_runs(self) -> list[str]:
        return [r for r in self.runs if len(self.raters_for(r)) > 1]


def _forwarder(root: Path):
    """frame id -> the id the library uses now, via `former_ids` in config/frames.yaml."""
    frames = yaml.safe_load((root / "config" / "frames.yaml").read_text())["frames"]
    fwd: dict[str, str] = {}
    for f in frames:
        fwd[f["id"]] = f["id"]
        for old in f.get("former_ids", []) or []:
            fwd[old] = f["id"]
    return lambda fid: fwd.get(fid, fid)


def load(root: str | Path = ".") -> Corpus:
    root = Path(root)
    forward = _forwarder(root)

    rubric = yaml.safe_load((root / "config" / "critic-rubric.yaml").read_text())
    dimensions = [
        Dimension(id=d["id"], weight=int(d["weight"]), anchors=len(d["anchors"]))
        for d in rubric["dimensions"]
    ]

    artifacts: list[Artifact] = []
    scores: dict[tuple[str, int, str, str], int] = {}
    blind_maps: dict[str, dict[str, str]] = {}

    recorded = root / "evals" / "recorded"
    for run_dir in sorted(p for p in recorded.iterdir() if p.is_dir()):
        run = run_dir.name
        score_path = run_dir / "score.json"
        if not score_path.exists():
            continue  # a negative control is a hand-written answer, not a run

        score = json.loads(score_path.read_text())
        branches = run_dir / "branches"
        for f in score.get("frames", []):
            frame = forward(f["frame"])
            art = branches / f"{f['frame']}.yaml"
            artifacts.append(
                Artifact(
                    run=run,
                    frame=frame,
                    status=f["status"],
                    pass_a=f.get("pass_a"),
                    cluster=f.get("cluster"),
                    fired=[t["trap"] for t in (f.get("fired") or [])],
                    words=len(art.read_text().split()) if art.exists() else 0,
                )
            )

        bm_path = run_dir / "critic" / "blind-map.json"
        if bm_path.exists():
            blind_maps[run] = {k: forward(v) for k, v in json.loads(bm_path.read_text()).items()}

        for rater, name in enumerate(RATER_FILES, start=1):
            p = run_dir / "critic" / name
            if not p.exists():
                continue
            doc = yaml.safe_load(p.read_text())
            for letter, row in (doc.get("scores") or {}).items():
                for dim, cell in row.items():
                    scores[(run, rater, letter, dim)] = int(cell["score"])

    return Corpus(root=root, dimensions=dimensions, artifacts=artifacts, scores=scores, blind_maps=blind_maps)
