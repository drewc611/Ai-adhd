"""Cut a frozen evaluation set: the one-off that turns a moving stride into fixed names.

Run once. The output is checked in, and after that the corpus grows freely — everything fetched
later is training data, because a document is held out only if this file names it.

Re-cutting invalidates every perplexity measured against the old set, which is the point of it
being a script nobody runs weekly rather than a step in the weekly job.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adhd_analysis.text.corpora import Library  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="cut_heldout", description=__doc__)
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--out", default="heldout.json")
    ap.add_argument("--every", type=int, default=20, help="seed the set from this stride, once")
    args = ap.parse_args(argv)

    names: list[str] = []
    for i, (source, ident, _) in enumerate(Library.load(args.manifest).identified()):
        if i % args.every == 0:
            names.append(f"{source}/{ident}")
    if not names:
        raise SystemExit("the corpus produced no documents; check the manifest")

    # Over the names, not the text. The text of a held-out document can legitimately change (a
    # source republishes an RFC); what must not change silently is which documents are in the set.
    digest = hashlib.sha256("\n".join(names).encode()).hexdigest()[:16]
    Path(args.out).write_text(
        json.dumps({"fingerprint": digest, "cut_from_stride": args.every, "documents": names}, indent=2) + "\n"
    )
    print(f"{len(names)} documents, fingerprint {digest} -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
