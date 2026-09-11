#!/usr/bin/env python3
"""Copy a training or evaluation record into `analysis/records/`, which is tracked.

`analysis/models/` and `runs/` are gitignored, for good reasons: a model is 160MB and the corpus is
licence-encumbered. The consequence nobody noticed is that **every figure this repository publishes
had no checked-in evidence.** 25.82, E6's 30.7 and 64.1, the 64,419,427 tokens the README quotes —
all of them lived in JSON that exists only on the machine that produced it and vanishes when the
container is reclaimed. From a clean checkout none of it could be verified, and a figure drifting
away from its record would be invisible.

A record is 2.6KB of metadata about a corpus rather than any of the corpus, so tracking it costs
nothing and carries no licence. `tests/test_published_figures.py` then reads these and fails when a
number in the prose stops matching the run it came from.

Absolute paths are rewritten relative to the repository root on the way in. They are not secret, but
they differ per machine, and an artifact that produces a spurious diff on every machine is an
artifact people stop reading.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECORDS = ROOT / "analysis" / "records"


def relativise(value):
    """Rewrite any absolute path under the repository root as a repo-relative one."""
    if isinstance(value, dict):
        return {k: relativise(v) for k, v in value.items()}
    if isinstance(value, list):
        return [relativise(v) for v in value]
    if isinstance(value, str) and value.startswith(str(ROOT)):
        rel = Path(value).relative_to(ROOT)
        return str(rel) if str(rel) != "." else "."
    return value


def publish(src: Path, name: str | None = None) -> Path:
    record = json.loads(src.read_text())
    # The machine that produced it is worth keeping and is not worth diffing: a record re-published
    # from a different container should differ in its measurements, not in its hostname.
    record.pop("platform", None)
    out = RECORDS / (name or src.name)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(relativise(record), indent=2, sort_keys=True) + "\n")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("records", nargs="+", type=Path)
    ap.add_argument("--name", default=None, help="store under this filename instead of the source's")
    args = ap.parse_args(argv)
    if args.name and len(args.records) > 1:
        ap.error("--name takes one record")
    for src in args.records:
        if not src.exists():
            print(f"missing: {src}", file=sys.stderr)
            return 1
        print(publish(src, args.name).relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
