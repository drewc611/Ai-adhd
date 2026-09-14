"""Choosing which library a training run reads, in one place.

This existed three times — once in each trainer's `main()` — and D26 patched two of them. The third,
`train_lstm.py`, went on reading the repository's own prose, and the only reason anyone found out is
that the backlog-82 re-measurement script asserted no cell had read a mutable source. A rule enforced
in three copies is a rule enforced in two copies eventually.

Same argument as `corpusread.py`, which is its own module because the corpus read belonged to neither
trainer. This belongs to none of the three.
"""

from __future__ import annotations

from argparse import ArgumentParser, Namespace

from .corpora import Library

#: Written once, quoted in three CLIs' `--help`.
MUTABLE_HELP = (
    "also read the sources `corpora.yaml` marks `mutable: true` — this repository's own docs, prompts "
    "and READMEs. Off by default because a commit changes their text, which makes the run unrepeatable: "
    "E8 wrote up its result and a retrain of its four cells moved by up to 4,807 n-grams with every cell "
    "on a different corpus digest. Pass it for a smoke test on a clean checkout that has no downloaded "
    "corpus; never for a measurement. See D26."
)


def add_library_arguments(ap: ArgumentParser) -> None:
    """The corpus-selection flags every trainer takes."""
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--include-mutable-sources", action="store_true", help=MUTABLE_HELP)
    ap.add_argument(
        "--held-out-file",
        default=None,
        metavar="PATH",
        help="train on everything except the documents named in this frozen set. Unlike a stride, the "
        "names do not move when the corpus grows, so two runs weeks apart are scored on the same text "
        "and their perplexities can be compared. Everything not named here is training data, including "
        "everything fetched after the set was cut.",
    )
    ap.add_argument(
        "--held-out-every",
        type=int,
        default=None,
        metavar="N",
        help="train on all but every Nth document, leaving that Nth for evaluation. Without this the "
        "model trains on the whole manifest and no honest held-out perplexity can be computed from it: "
        "`evaluate` refuses such a model rather than reporting a memorisation score.",
    )


def training_library(args: Namespace) -> Library:
    """The library a measurement should read, given parsed CLI arguments.

    Mutable sources are dropped unless asked for, then the held-out split is applied — in that order,
    because a split wrapper has no `stable()` and reversing the two silently trains on everything.
    """
    library = Library.load(args.manifest)
    if not getattr(args, "include_mutable_sources", False):
        excluded = sorted(library.mutable_names())
        library = library.stable()
        # `describe()` and not a token count: it globs and stats, it reads nothing, and the two cases
        # worth distinguishing are both visible in a file count. Without this the clean-checkout path
        # reached `train()` and died on "the corpus produced no tokens; check the paths in the manifest"
        # — wrong twice, because the paths are right and the reason is that the only sources holding text
        # were excluded a line above. CI found that on D26's first push.
        #
        # The remedy names no script on purpose. `test/boundary.test.ts` asserts nothing in this package
        # contains the fetcher's name, because the package's ban on network is enforced by import and a
        # package that names it is one step from calling it. This message said it on its first draft and
        # that test caught it.
        if not any(d["files"] for d in library.describe()):
            raise SystemExit(
                "nothing repeatable to train on: "
                + (
                    f"the only sources with text are marked `mutable: true` ({', '.join(excluded)}), "
                    "and a commit changes their text, so a run including them cannot be repeated"
                    if excluded
                    else "every source the manifest names is empty"
                )
                + ". Put a corpus at the paths the manifest names, or pass --include-mutable-sources "
                "for a smoke test whose numbers mean nothing. See D26."
            )
    # Imported here rather than at module scope: `evaluate` imports the trainers, and the other
    # direction at import time is a cycle.
    if args.held_out_file is not None:
        from .evaluate import FrozenSplit

        return FrozenSplit.load(library, args.held_out_file, side="train")
    if args.held_out_every is not None:
        from .evaluate import SplitLibrary

        return SplitLibrary(library, every=args.held_out_every, side="train")
    return library
