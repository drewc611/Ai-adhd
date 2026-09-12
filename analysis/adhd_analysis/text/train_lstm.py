"""Training entry point for the LSTM.

Thin on purpose. An LSTM and a transformer share the entire training contract — `params`,
`loss_and_grads`, `save`, and a config carrying `context` and `vocab_size` — so this passes a model
factory to the loop in `train_transformer.py` rather than copying it. That loop already learned two
things the hard way, and a third copy would be a third place to relearn them: that the corpus read and
the optimiser need separate budgets (D20), and that a silent run is indistinguishable from a hung one.

The trainer's own module name is now the only misleading thing about the arrangement, and renaming it
would break a CLI the README and `docs/DECISIONS.md` both name. Left as it is, with this sentence.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .budget import Budget
from .corpora import Library
from .lstm import LSTM, LSTMConfig
from .train_transformer import TransformerRecord, train_transformer


def train_lstm(
    library: Library,
    out: str | Path,
    config: LSTMConfig | None = None,
    budget: Budget | None = None,
    **kw,
) -> TransformerRecord:
    cfg = config or LSTMConfig()
    return train_transformer(library, out, cfg, budget, make_model=LSTM, **kw)  # type: ignore[arg-type]


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json

    ap = argparse.ArgumentParser(
        prog="adhd_analysis.text.train_lstm",
        description="Train an LSTM language model from scratch on the document library in corpora.yaml. "
        "Nothing is downloaded, no pretrained weights are loaded and no model is called.",
    )
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--out", default="models/background.lstm.gz")
    ap.add_argument("--vocab-size", type=int, default=8192)
    ap.add_argument("--d-model", type=int, default=128)
    ap.add_argument("--n-layers", type=int, default=2)
    ap.add_argument("--context", type=int, default=128, help="truncated-BPTT length; not a ceiling on "
                    "what the model remembers at scoring time, where the state carries across windows")
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--warmup", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--max-train-tokens", type=int, default=None)
    ap.add_argument("--max-tokens", type=int, default=None)
    ap.add_argument("--max-seconds", type=float, default=None)
    ap.add_argument("--max-rss-mb", type=int, default=None)
    ap.add_argument("--progress", type=int, default=200, metavar="STEPS")
    ap.add_argument("--held-out-file", default=None, metavar="PATH")
    ap.add_argument("--held-out-every", type=int, default=None, metavar="N")
    ap.add_argument("--record", default=None)
    args = ap.parse_args(argv)

    cfg = LSTMConfig(
        vocab_size=args.vocab_size, d_model=args.d_model, n_layers=args.n_layers, context=args.context
    )
    b = Budget.weekly()
    for attr, val in [("max_tokens", args.max_tokens), ("max_seconds", args.max_seconds), ("max_rss_mb", args.max_rss_mb)]:
        if val is not None:
            setattr(b, attr, val)

    library = Library.load(args.manifest)
    if args.held_out_file is not None:
        from .evaluate import FrozenSplit

        library = FrozenSplit.load(library, args.held_out_file, side="train")
    elif args.held_out_every is not None:
        from .evaluate import SplitLibrary

        library = SplitLibrary(library, every=args.held_out_every, side="train")

    rec = train_lstm(
        library, args.out, cfg, b,
        epochs=args.epochs, batch_size=args.batch_size, lr=args.lr, warmup=args.warmup,
        seed=args.seed, max_train_tokens=args.max_train_tokens, progress=args.progress,
    )
    if args.record:
        Path(args.record).parent.mkdir(parents=True, exist_ok=True)
        Path(args.record).write_text(rec.to_json() + "\n")
    print(rec.to_json())
    return 0


if __name__ == "__main__":
    sys.exit(main())
