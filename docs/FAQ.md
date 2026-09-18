# FAQ

Backlog 47. Short answers with the evidence attached; every number here is checked by
`analysis/tests/test_published_figures.py` or by `test/docs.test.ts`.

## Why not just prompt the model to consider multiple perspectives?

Because that is one context, and one context anchors.

A single model asked for five perspectives writes five perspectives *after* having written the first
one. Everything after it is conditioned on it. The divergence you get is stylistic, and the agreement
you get at the end is the model agreeing with itself — which reads as the strongest signal the system
can emit and is worth nothing.

The mechanism here is that a branch runs in a **genuinely separate context window**, as a Claude Code
subagent, and never sees a sibling's output, the branch count, or the phrase "so far". `CLAUDE.md` is
blunt about why: *"An instruction to 'ignore what you read above' is not isolation, and every
in-context divergence technique is built on exactly that."*

The control is in the repository. `evals/recorded/001-linear-cot/` is the competent linear answer to
fixture 001 — 15s to first token, 30s between tokens, 90s absolute, one auto retry, Google SRE Book
ch. 22. It is fluent and it fails the fixture, which is the point of keeping it.

## Does this call a model?

No. Not once, anywhere in the package. `test/boundary.test.ts` fails if anything imports `torch`,
`tensorflow` or `transformers`, exactly one file in `analysis/` may touch the network, and it is not
importable from the package. The library compiles briefs, validates contracts, scores deterministically
and runs evals; a **host** spawns the subagents.

That is also why `npm run demo` cannot show you a run. It shows everything either side of that
boundary, which is what this repository actually is.

## Seven subagents sounds expensive. What does a run cost?

About **460,000 tokens**, and the D5 gate quotes you roughly a third of that before spending anything.
`adhd cost` measured it across seven recorded runs at 2.6x to 3.3x the estimate, mean 3.0x. Backlog 68
is the open item to recalibrate the quote, and it is the owner's call because a consent gate that
under-quotes and a consent gate that over-quotes fail differently.

You can stop a run. D5 confirms before spending, and cancelling mid-flight renders whatever returned,
unscored, with the pruned block **absent and said to be absent** rather than quietly missing.

## Why a critic rubric instead of a quality rubric?

Because a quality rubric rewards the consensus trap, which is T1, which is the thing this exists to
catch. `CLAUDE.md` lists replacing it under **Do not**.

The rubric is not above suspicion either. Corrected for chance, `foreclosure` scores Krippendorff's
alpha of **-0.017** with a 95% interval of [-0.04, +0.00] on 96% exact agreement — an interval spanning
zero, which at seven double-scored packs means *unmeasured*, not weak. It is retired for that reason
(D34). `committal` looked like the same shape on five packs and is not: two more put it at **+0.562
on [+0.26, +0.85]**, clear of chance. `adhd learn --agreement` reports it and D9 has the argument.

## How much evidence is there, honestly?

Eleven recorded runs, seven with `score.json`. That is thin and the repository says so in the places it
would be easiest not to.

`001-seed2` is the sharpest instance: the same fixture at a different seed loses two assertions that
seed 1 passes. Nothing changed but which frames were dispatched. `docs/FAILURES.md` is the gallery, and
backlog 3 — the same fixture at seeds 2 and 3 — is still open, because one reshuffle is an anecdote.

## What is `analysis/` doing in a reasoning repository?

Measuring whether the artifacts read like anything. It trains a Kneser-Ney language model on RFCs, PEPs,
EIPs and ERCs — **held-out perplexity 25.82** — and a transformer and an LSTM from scratch over numpy,
so that "this artifact is generic" is a number rather than an impression.

It is also where most of the mistakes in this repository have been found and written down, because it is
the part that produces numbers somebody can check. D25 measured a threshold that had been a round guess.
D26 found that the repository's own prose was in the training corpus, so **writing down a measurement
changed the corpus the measurement came from**.

## Can I use my own frames?

`adhd init <dir>` copies the shipped library so you can extend it. `docs/AUTHORING-FRAMES.md` is the
guide, and the short version is that the bar is an empty axis rather than a good idea: seven of the ten
axes carry one frame, so a fourteenth frame on a shared axis makes the library worse rather than larger.

Backlog 71 — config overlays, so `init` does not fork the library — is open and is the owner's call.
