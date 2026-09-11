"""Training entry point for the transformer, under the same budget and the same split as the n-gram.

Deliberately parallel to `train.py` rather than folded into it. The two model classes share the
vocabulary pass and nothing else: Kneser-Ney reads the corpus twice and is finished, while a
transformer reads it many times and its stopping point is a compute ceiling rather than the end of the
text. Merging them would mean a `train()` whose second half is an `if` on the model class, and the
branch that is taken once per week would be the one nobody reads.

What this records, because it is the part that is easy to overstate: **how much text the model actually
saw.** The n-gram either finishes the corpus or stops on a ceiling that `stopped_because` names. A
transformer on this machine stops on a ceiling essentially always, so `tokens_seen` is not "the corpus"
and a perplexity from a run that saw a twentieth of the training side has to say so. The record carries
`epochs_completed` as a fraction for exactly that reason.
"""

from __future__ import annotations

import json
import math
import sys
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterator

import numpy as np

from .budget import Budget
from .corpora import Library
from .tokenize import BOS, EOS, Vocab, sentences, tokens
from .transformer import Adam, Transformer, TransformerConfig, array_batches

#: int32, not int64. The materialised training array is the second largest thing in the process and
#: no vocabulary this model can afford comes near 2^31.
ID_DTYPE = np.int32


@dataclass
class TransformerRecord:
    model_path: Path
    config: dict
    vocab_size: int
    min_count: int
    documents: int
    sentences: int
    #: Tokens in the materialised training array, which is what an epoch is measured against.
    train_tokens: int
    #: Tokens pushed through the model. `train_tokens * epochs_completed`, up to packing.
    tokens_seen: int
    epochs_completed: float
    steps: int
    final_loss: float
    #: Mean loss over each tenth of the run, so a diverged run is visible without a separate log.
    loss_curve: list[float]
    oov_rate: float
    vocab_truncated_types: int
    vocab_truncated_tokens: int
    split: dict | None
    #: Why training stopped: a budget ceiling, or "epochs" when it ran the schedule out.
    stopped_because: str
    budget_vocabulary: dict
    budget_corpus: dict
    budget_training: dict
    sources: list[dict]
    seconds: float

    def to_json(self) -> str:
        d = asdict(self)
        d["model_path"] = str(self.model_path)
        return json.dumps(d, indent=2, sort_keys=True)

    def __str__(self) -> str:
        return (
            f"transformer {self.config['n_layers']}L d{self.config['d_model']} "
            f"ctx{self.config['context']} vocab {self.vocab_size:,}\n"
            f"  {self.steps:,} steps over {self.tokens_seen:,} tokens "
            f"({self.epochs_completed:.2f} epochs of {self.train_tokens:,})\n"
            f"  loss {self.loss_curve[0]:.3f} -> {self.final_loss:.3f}  "
            f"stopped on {self.stopped_because}  in {self.seconds:.0f}s"
        )


def _sentence_tokens(library: Library, budget: Budget) -> Iterator[list[str]]:
    for _name, doc in library.documents():
        for s in sentences(doc):
            ts = tokens(s)
            if not ts:
                continue
            budget.spend(len(ts))
            yield ts
            if not budget.allows():
                return


def cosine_schedule(step: int, total: int, lr: float, warmup: int) -> float:
    """Linear warmup then cosine decay to a tenth of the peak.

    Not a tuning choice so much as a bug fix waiting to happen without it: pre-norm blocks at
    `init_std` 0.02 survive a cold start, but Adam's second moment is near zero for the first few
    dozen steps and a full-rate update there is the difference between a model that trains and one
    whose loss sits at `log(vocab_size)` for the whole run.
    """
    if step < warmup:
        return lr * (step + 1) / warmup
    if total <= warmup:
        return lr
    frac = (step - warmup) / (total - warmup)
    return lr * (0.1 + 0.45 * (1.0 + math.cos(math.pi * min(1.0, frac))))


def train_transformer(
    library: Library,
    out: str | Path,
    config: TransformerConfig | None = None,
    budget: Budget | None = None,
    *,
    epochs: float = 1.0,
    batch_size: int = 16,
    lr: float = 3e-4,
    warmup: int = 100,
    seed: int = 0,
    max_train_tokens: int | None = None,
    progress: int = 0,
) -> TransformerRecord:
    """`progress`, in steps, writes a line to stderr every that many. Zero is silent.

    Worth a parameter rather than a print: an epoch over the training side is hours here, and a run
    with no output is a run nobody can tell apart from a hung one. The line goes to stderr so that
    stdout stays the record's JSON and a caller can still pipe it.
    """
    started = time.monotonic()
    cfg = config or TransformerConfig()
    b1 = budget or Budget.weekly()
    # Three ceilings, not two. The n-gram's second pass *is* its training, so `train()` needs one
    # restart. Here the corpus read and the optimisation are separate spends, and sharing a budget
    # between them charges the corpus against the training ceiling — on this corpus that leaves the
    # token ceiling already exceeded before the first gradient step, and the run stops at zero steps
    # with a reason that reads like a training limit.
    b2 = b1.restart()
    b3 = b2.restart()

    freq: Counter[str] = Counter()
    n_sentences = 0
    for ts in _sentence_tokens(library, b1):
        freq.update(ts)
        n_sentences += 1
    if not freq:
        raise ValueError("the corpus produced no tokens; check the paths in the manifest")
    # `max_size` is the whole reason a transformer needs its own vocabulary pass: the softmax is
    # `d_model x vocab_size` and every token's loss touches all of it, so the cap that the n-gram
    # treats as a safety rail is here a hard shape constraint. `evaluate` then refuses to compare the
    # two on all targets, because their OOV rates differ — see `comparable_heldout`.
    vocab = Vocab.build(freq, min_count=cfg_min_count(cfg), max_size=cfg.vocab_size)

    # Materialised once as ids, because a transformer reads the corpus many times and re-tokenising
    # per epoch costs more than the matmuls do. int32 at 64M tokens is 256MB, which the budget's
    # resident-set ceiling accounts for like anything else.
    bos, eos = vocab.stoi[BOS], vocab.stoi[EOS]
    flat: list[int] = []
    cap = max_train_tokens
    for ts in _sentence_tokens(library, b2):
        flat.append(bos)
        flat.extend(vocab.encode(ts))
        flat.append(eos)
        if cap is not None and len(flat) >= cap:
            break
    ids = np.asarray(flat, dtype=ID_DTYPE)
    del flat
    if ids.size < cfg.context + 2:
        raise ValueError(f"the training side produced {ids.size} ids, too few for a context of {cfg.context}")

    model = Transformer(cfg, vocab, seed=seed)
    opt = Adam(lr=lr)
    per_step = batch_size * cfg.context
    total_steps = max(1, int(epochs * ids.size / per_step))

    losses: list[float] = []
    steps = 0
    stopped = "epochs"
    b3.touch()
    while steps < total_steps:
        for x, y in array_batches(ids, cfg.context, batch_size):
            loss, grads = model.loss_and_grads(x, y)
            opt.lr = cosine_schedule(steps, total_steps, lr, warmup)
            opt.step(model.params, grads)
            losses.append(loss)
            steps += 1
            b3.spend(x.size)
            if progress and steps % progress == 0:
                done = steps * per_step
                rate = done / max(b3.elapsed, 1e-9)
                left = (total_steps - steps) * per_step / rate if rate else float("inf")
                print(
                    f"step {steps:,}/{total_steps:,}  loss {np.mean(losses[-progress:]):.4f}  "
                    f"lr {opt.lr:.2e}  {rate:,.0f} tok/s  {left / 60:.0f} min left",
                    file=sys.stderr,
                    flush=True,
                )
            if steps >= total_steps:
                break
            if not b3.allows():
                stopped = b3.stopped_because or "a ceiling that did not say which"
                break
        if stopped != "epochs":
            break

    oov = vocab.dropped_tokens / max(sum(freq.values()), 1)
    model.meta.update(
        {
            "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model_class": "transformer",
            "config": asdict(cfg),
            "min_count": cfg_min_count(cfg),
            "oov_rate": round(oov, 5),
            "vocab_truncated": {"types": vocab.truncated_types, "tokens": vocab.truncated_tokens},
            # The same field `train()` records and for the same reason: `in_sample_refusal` reads it
            # and will not score a model on text it trained on.
            "split": (
                {"frozen": library.fingerprint, "side": library.side}
                if hasattr(library, "fingerprint") and hasattr(library, "side")
                else {"every": library.every, "side": library.side}
                if hasattr(library, "every") and hasattr(library, "side")
                else None
            ),
            "sources": library.describe(),
            "steps": steps,
            "tokens_seen": steps * per_step,
            "stopped_because": stopped,
            "budget": {"vocabulary": b1.report(), "corpus": b2.report(), "training": b3.report()},
        }
    )
    path = model.save(out)

    chunk = max(1, len(losses) // 10)
    curve = [float(np.mean(losses[i : i + chunk])) for i in range(0, len(losses), chunk)]
    return TransformerRecord(
        model_path=path,
        config=asdict(cfg),
        vocab_size=len(vocab),
        min_count=cfg_min_count(cfg),
        documents=sum(s["files"] for s in model.meta["sources"]),
        sentences=n_sentences,
        train_tokens=int(ids.size),
        tokens_seen=steps * per_step,
        epochs_completed=steps * per_step / max(1, int(ids.size)),
        steps=steps,
        final_loss=float(np.mean(losses[-chunk:])) if losses else float("inf"),
        loss_curve=curve,
        oov_rate=oov,
        vocab_truncated_types=vocab.truncated_types,
        vocab_truncated_tokens=vocab.truncated_tokens,
        split=model.meta["split"],
        stopped_because=stopped,
        budget_vocabulary=b1.report(),
        budget_corpus=b2.report(),
        budget_training=b3.report(),
        sources=model.meta["sources"],
        seconds=time.monotonic() - started,
    )


def cfg_min_count(cfg: TransformerConfig) -> int:
    """The vocabulary threshold this model class uses.

    Fixed at 3 to match the shipped n-gram (E4 adopted it), and read through a function so that the
    coupling is visible rather than a bare literal in the middle of the vocabulary pass. It is not a
    `TransformerConfig` field because it describes the corpus, not the model shape, and putting it on
    the config would make it look like something the architecture search may move.
    """
    return 3


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(
        prog="adhd_analysis.text.train_transformer",
        description="Train a transformer language model from scratch on the document library in "
        "corpora.yaml. Nothing is downloaded, no pretrained weights are loaded and no model is called: "
        "every parameter comes from the corpus this manifest names.",
    )
    ap.add_argument("--manifest", default="corpora.yaml")
    ap.add_argument("--out", default="models/background.tf.gz")
    ap.add_argument("--vocab-size", type=int, default=8192, help="the softmax is d_model x this, and "
                    "every token's loss touches all of it, so this is a shape constraint and not a rail")
    ap.add_argument("--d-model", type=int, default=128)
    ap.add_argument("--n-heads", type=int, default=4)
    ap.add_argument("--n-layers", type=int, default=2)
    ap.add_argument("--context", type=int, default=128)
    ap.add_argument("--d-ff", type=int, default=None, help="default 4 x d_model")
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--warmup", type=int, default=100)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--max-train-tokens", type=int, default=None,
                    help="cap the materialised training array. Use it to hold two runs to the same "
                    "text when one model class reads the corpus far faster than the other")
    ap.add_argument("--max-tokens", type=int, default=None)
    ap.add_argument("--max-seconds", type=float, default=None)
    ap.add_argument("--max-rss-mb", type=int, default=None)
    ap.add_argument("--held-out-file", default=None, metavar="PATH",
                    help="train on everything except the documents named in this frozen set")
    ap.add_argument("--held-out-every", type=int, default=None, metavar="N",
                    help="train on all but every Nth document")
    ap.add_argument("--progress", type=int, default=200, metavar="STEPS",
                    help="write a progress line to stderr every STEPS steps; 0 for silence. An epoch "
                    "here is hours, and a silent run is indistinguishable from a hung one")
    ap.add_argument("--record", default=None, help="write the training record here as JSON")
    args = ap.parse_args(argv)

    cfg = TransformerConfig(
        vocab_size=args.vocab_size,
        d_model=args.d_model,
        n_heads=args.n_heads,
        n_layers=args.n_layers,
        context=args.context,
        d_ff=args.d_ff if args.d_ff is not None else 4 * args.d_model,
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
    rec = train_transformer(
        library,
        args.out,
        cfg,
        b,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        warmup=args.warmup,
        seed=args.seed,
        max_train_tokens=args.max_train_tokens,
        progress=args.progress,
    )
    if args.record:
        Path(args.record).parent.mkdir(parents=True, exist_ok=True)
        Path(args.record).write_text(rec.to_json() + "\n")
    print(rec.to_json())
    return 0


if __name__ == "__main__":
    sys.exit(main())
