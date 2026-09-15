# What twelve runs show

A short account of what this repository has actually established, written so the negative results
are as easy to find as the rest. Every number below comes from a command in this checkout and is
pinned by a test; the commands are named so you can rerun them.

Backlog item 49 asked for this at five runs. There are twelve now, eight with a `score.json`, and
the extra seven did not change the shape of the answer — with two exceptions, both from the twelfth
run and both named where they belong: it is the first contested decision the rubric actually
separates, and the first run to come in under the token estimate it was quoted.

## The claim

A single reasoning pass converges. Asked what timeouts to set, a competent model produces a
fluent, balanced answer that would be the same answer to a different question — and produces it in
thirty seconds, which is why it reads as competence rather than as the failure it is.

The claim is that dispatching the problem to several *isolated* reasoning processes, each holding a
different stance, then scoring them against a rubric that rewards none of the things fluency
rewards, surfaces positions the single pass does not reach. Isolation is a separate context window
per branch, because an instruction to ignore what you read above is not isolation, and every
in-context divergence technique is built on exactly that (D2).

## Method

Twelve recorded runs over four fixtures, each fixture carrying `must_surface` assertions written
before the run and a linear chain-of-thought control. The mechanics — verbatim passthrough,
`problem_hash`, blind pass A, the pruned block — are enforced by 476 tests rather than by
inspection. `docs/EXPERIMENTS.md` registers each experiment, with its readings fixed in advance,
before the commit that runs it.

## What holds

**The machinery does what it says.** No recorded run has ever missed on `problem_hash` or shipped
without a pruned block. The same 47-byte problem compiled today produces the hash in a plan written
ten days ago. Briefs contain no sibling output, no branch count and no "so far", and a test fails
the build if they do. `docs/WORKED-EXAMPLE.md` walks one run end to end with real output.

**The controls fail.** `001-linear-cot` is what one careful pass produces on the same problem, and
it misses four assertions the real run holds, including every one that requires naming a trap.
A fixture with no control is a fixture nothing has to beat, and all four have one.

**The critic rubric is not a quality rubric, and it matters.** In `001-first-run`, `MINIMALIST`
scored 3/3 on committal and 3/3 on foreclosure — the marks a quality rubric would reward — and was
pruned on T1, for giving an answer that does not depend on the question. Delete "HTTP" and "this
client" from the problem and its recommendation is unchanged. That is the consensus trap, and it is
the thing the repository exists to catch.

**The problem has an answer the machinery keeps reaching.** Deadline propagation clustered at seed
2 from `LEDGER`, `ACTOR_CENSUS` and `FRAME_BREAKER`, and again under an entirely different frame
set from `SABOTEUR`, `FRAME_BREAKER` and `PRIOR_ART`. Six frames, two runs, one in common.

## What does not hold

**Fixture 001 has passed once, in the run it was written against.**

| assertion | seed 1 | seed 2 | alternate frames |
|---|---|---|---|
| `human_cancel` | ok | **miss** | ok |
| `retry_target_questioned` | ok | ok | **miss** |
| `retry_cost` | ok | **miss** | **miss** |
| `trap_named` | ok | ok | ok |

Different assertions have different dependencies, and none of the three interesting ones is a
property of the frame library on this evidence. `human_cancel` survived a whole new frame set and
not a reseed. `retry_target_questioned` survived the reseed and not the frame set. `retry_cost` has
passed once. The only assertion robust across all three is `trap_named`, which asks almost nothing:
any `T[1-8]` anywhere in the pruned block.

**The recommendation is a near-tie the rubric does not settle.** `adhd learn --sensitivity` reports
that no shipped representative changes under any single-dimension weight move of ±1 — which reads
as stability until you read the next line. 4 of the 5 contested decisions were settled by two anchor
points or fewer, and two of them by exactly one. Those representatives are not stable because the
rubric is decisive; they are close enough that any of them could ship.

The fifth is `001-seed3`, where `DOOR_KEEPER` beat `MINIMALIST` by 0.1042 — four to five anchor
points — and it is the first contested decision in the corpus the rubric actually separates. One
case out of five is not a reversal of the paragraph above, and it is the first evidence that the
narrowness is a property of particular packs rather than of the rubric.

**Two critics scoring the same pack rank it differently every time.** `adhd learn
--agreement-all`, pooled over 5 runs and 225 scored cells: 79% exact agreement, 100% within one
point, and the ranking changed in all five. In `002-kernel-enduser` the shipped representative
changed with it, `FRAME_BREAKER` to `PARTICULARIST`. A rubric with 79% exact agreement, deciding
outcomes separated by one anchor point, is not deciding them.

**Two dimensions are near the ceiling and separate almost nothing.** `foreclosure` sits at 2.91 with
91% of scores at the ceiling and two distinct values ever used; `reasoning_carries` at 2.89, 94%,
two values. Both carry weight. Backlog 60 is the rewrite and it is open.

**A run costs about three times its estimate.** Seven runs with `cost.json` came in at 407k to 519k
tokens against an estimate of 156k — 2.6x to 3.3x. The D5 gate quotes the estimate, so the number a
user confirms is a third of what they spend. Backlog 68 is the recalibration.

## What would change the answer

The single most valuable open item is backlog 3 and 4: the same fixture at two more seeds, and the
same fixture at the same seed on a different day. Nothing in this repository separates run-to-run
noise from signal, so every single-run number here — including the flattering ones — is quoted
against a noise floor nobody has measured. `adhd diff` says so in place, on every comparison it
prints, rather than leaving the reader to remember.

Twelve runs over four fixtures is an existence proof that the machinery runs and the controls lose.
It is not evidence that the frame library picks better answers than one careful pass, and no
sentence in this repository should be read as claiming it does.

## Where the numbers are

```
adhd eval                      the assertions, per run, with the controls
adhd frames --stats            per-frame prune rates, detector counts
adhd learn --sensitivity       how much rubric separated each decision
adhd learn --agreement-all     two critics on the same pack
adhd cost                      actual against estimate
adhd diff <runA> <runB>        two runs of one fixture
adhd matrix                    every assertion against every run
```

`docs/FAILURES.md` catalogues each failure and what it taught. `docs/EXPERIMENTS.md` holds the
registrations, including the readings that turned out half right and were left standing rather than
rewritten.
