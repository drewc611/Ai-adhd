# Failure gallery

Every recorded run that failed, why, and what it changed. Backlog 50.

Eleven recorded runs. **Six fail**, and four of those six are *supposed* to: they are linear
chain-of-thought controls, and a control that passes means the fixture or the harness is broken. That
leaves two real failures, both kept rather than deleted, both with a `note` in
`evals/recorded/*/expect.json` saying what they miss.

`adhd eval` prints this list live and `adhd matrix` grids it by assertion. This file is the reading,
not the data — if the two disagree the data is right.

## The two real failures

### `001-seed2` — the same fixture, a different seed, two assertions lost

Fixture 001 at seed 2 misses `human_cancel` (T6) and names no T1/T2/T3 trap in its pruned block. Seed
1 passes both. Nothing about the frame library changed between them; the seed reshuffles which frames
are dispatched, and the ones that surfaced the cancel path at seed 1 were not asked at seed 2.

**What it taught.** This is the strongest evidence in the repository that five runs is not a sample.
Backlog 3 — the same fixture at seeds 2 and 3 — exists because of it, and it is still open: one
reshuffle is an anecdote.

It also produced a correction worth more than the failure. `retry_cost` was listed as a third missing
item until E3 checked: the run *did* surface it, LEDGER's pruned position priced retries as a share of
traffic and the T7 detector output named the payer. The assertion's patterns only recognised seed 1's
wording. **An assertion that matches one run's phrasing is a test of phrasing.** The note records the
correction rather than quietly dropping the item.

### `002-first-run` — the frame library has a hole, and it is named

Fixture 002 misses `who_is_hurt`: no frame in the `fuzzy_debugging` set asks who the p99 tail latency
lands on. Not a scoring accident and not a bad run — the question is absent from the library for that
class.

**What it taught.** It is recorded as the baseline the frame library must beat rather than hidden, and
`002-kernel-enduser` is the run that beats it. Two runs of one fixture where the second fixes what the
first exposed is the only shape of evidence here that shows the library improving.

## The four controls, which fail on purpose

`001-linear-cot`, `002-linear-cot`, `003-linear-cot`, `004-linear-cot`. Each is the competent,
conventional answer to its fixture, written as a good engineer would give it — with real citations in
003's case and a balanced case on both sides.

They exist because a fixture that only ever sees divergent runs cannot tell you whether it is measuring
divergence or measuring fluency. **If a control passes, the fixture is broken and not the control.**
That has not happened.

## The one that fails and is neither

`004-kernel-naming` misses `false_means` (T2): the answer never says what the flag name asserts when
the flag is off. Backlog 17 is the item — no frame asks what a name asserts in its negative case.

D47 tried the fix `docs/AUTHORING-FRAMES.md` suggested — a probe on FRAME_BREAKER rather than a new
frame — and re-dispatched the fixture as `004-frame-breaker-probe`. It still misses: FRAME_BREAKER's
reasoning gets close (it names the implicit "old checkout" fallback state the flag's name does not
carry as fact), but the phrasing doesn't match the detector, and the branch was independently pruned
for T1 and T7 before it could reach the recommendation anyway. Both runs are recorded as observed.
Backlog 17 stays open.

## What has never failed

No recorded run has ever failed on `problem_hash`. No recorded run has ever shipped without a pruned
block. T3 and T5 have never fired in a real run, on any frame, across all seven scored runs — which
`docs/RETIREMENT.md` says is either well-designed prevention or dead weight, and which the counts
cannot distinguish at this sample size.
