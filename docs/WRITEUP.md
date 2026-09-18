# What seventeen runs show

A short account of what this repository has actually established, written so the negative results
are as easy to find as the rest. Every number below comes from a command in this checkout and is
pinned by a test; the commands are named so you can rerun them.

Backlog item 49 asked for this at five runs. There are seventeen now, thirteen with a `score.json`,
and the extra twelve did not change the shape of the answer — with five exceptions, all named where
they belong. Two are from `001-seed3`: the first contested decision the rubric actually separates, and
the first run to come in under the token estimate it was quoted. The third is its replicate at the
same seed with byte-identical briefs, and it is the most uncomfortable number here: the critic pruned
two branches the first time and none the second. The fourth is E10's pair of seven-branch runs, which
are the first to exercise the wide path and the first to show the rubric separating a winner by more
than two anchor points twice running. The fifth is E12's pair, `001-seed3-e12-1` and `-e12-2`: the
same fixture and seed a third and fourth time, this time with `adhd-branch` and `adhd-critic`
actually dispatching as themselves rather than falling back to `general-purpose`, and the pair that
settled backlog 102 — the critic's own instability turned out to be the missing instruction, not an
unstable sweep.

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

Seventeen recorded runs over five fixtures, each fixture carrying `must_surface` assertions written
before the run and, on four of the five, a linear chain-of-thought control. Three of the seventeen
are same-fixture, same-seed, same-brief reruns of `001-seed3`: the deliberate replicate that measured
the noise floor, and the E12 pair that put the critic's own instructions genuinely in force for the
first time. Two are fixture 014 at seven branches, the widest path the router can produce.
The mechanics — verbatim passthrough, `problem_hash`, blind pass A, the pruned block — are enforced
by 510 tests rather than by inspection. `docs/EXPERIMENTS.md` registers each experiment, with its readings fixed in advance,
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

**The recommendation is usually a near-tie the rubric does not settle.** `adhd learn --sensitivity`
reports that no shipped representative changes under any single-dimension weight move of ±1 — which
reads as stability until you read the next line. 5 of the 8 contested decisions were settled by two
anchor points or fewer, two of them by exactly one, and one by nothing at all. Those representatives
are not stable because the rubric is decisive; they are close enough that any of them could ship.

Three clear two anchor points: `001-seed3` and `014-seed1` at 0.1042, and `014-seed14` at 0.0625.
That was read here as the wide path separating better — both seven-branch runs above the line where
five of the six five-branch decisions were below it — and **that reading is withdrawn.** Two anchor
points is not the line that matters. The line that matters is the noise floor, which is 0.10 (E1a
and E11), and against it `014-seed14`'s 0.0625 is not a margin at all. `001-seed3` and `014-seed1`
clear it by 0.0042, which is to say they do not clear it either.

**The corpus contains no comfortably separated contested decision.** One of the eight is above the
floor by a rounding error and the rest are below it. Whether `n` has anything to do with it is
untested and was never tested by these two runs; the paragraph this replaces was reading a gap
between two numbers that are both inside the measurement error of the thing producing them.

**And the corpus now has an exact tie, which is the same finding with the floor taken out.** In
`001-seed3-repeat`, `ACTOR_CENSUS` and `FRAME_BREAKER` both scored 0.8810 in the same cluster. The
margin is 0.0000: the rubric did not choose, and the frame that ships does so because its id sorts
first. That is recorded in the run's notes rather than hidden, which is D40, and the decision is
worth reading beside the run it came from — the same pack scored at a different session, where the
trap sweep also went from firing twice to firing not at all.

**Two critics scoring the same pack rank it differently every time.** `adhd learn
--agreement-all`, pooled over 7 runs and 305 scored cells: 81% exact agreement, 100% within one
point, and the ranking changed in all seven. In two of them the shipped representative changed with
it: `002-kernel-enduser` from `FRAME_BREAKER` to `PARTICULARIST`, and `001-seed3-repeat` from
`ACTOR_CENSUS` to `FRAME_BREAKER` — which is the exact tie above, broken the other way by a critic
who scored the identical artifacts. A rubric with 81% exact agreement, deciding outcomes separated
by one anchor point, is not deciding them.

**One dimension is near the ceiling and separates almost nothing.** `foreclosure` sits at 2.91 with
91% of scores at the ceiling and two distinct values ever used, and it is retired (D34). The second
suspect named here was `reasoning_carries` at 2.89, 94%, two values, and it is not one: D39 measured
alpha 0.678 on an interval excluding zero, above four dimensions that nobody had flagged. Ceiling
rate cannot tell prevention from dead weight, which is the whole of D39. `committal` was the next
candidate and E11 cleared it too, at `+0.562 [+0.26, +0.85]`.

**A run costs about three times its estimate.** Seven runs with `cost.json` came in at 407k to 519k
tokens against an estimate of 156k — 2.6x to 3.3x. The D5 gate quotes the estimate, so the number a
user confirms is a third of what they spend. Backlog 68 is the recalibration.

## What would change the answer

Backlog 3 and 4 were the most valuable open items here and both are closed, which is why several
paragraphs above now read worse than they did. The floor they measured is 0.10, and `adhd diff`
prints it on every comparison rather than leaving the reader to remember.

**Backlog 102 closed E12, and the answer is that item 4's cause was the missing instruction, not an
unstable sweep.** D41 found that `agents/adhd-critic.md` had never executed in any of the fifteen
recorded runs before it — the permit resolved nowhere, the critique phase fell back to a different
agent and a different system prompt, and the critic's own instruction to sweep every detector
mechanically, eight records per branch, a gap rejects the pass, was simply absent. E12 re-ran
fixture 001 at seed 3 twice with that instruction genuinely in force, everything else held as item
4 held it. The two runs agreed on 39 of 40 (branch, trap) records and pruned an identical set both
times — all five branches, both times, every one carrying a fired T1. Item 4's original pair had
agreed on none of its detector firings. The instability was the missing instruction, and it is gone
once the instruction is actually delivered.

That does not mean fixture 001 passes now — it fails both E12 cells, for a reason item 4's pair
never surfaced: two of its `must_surface` checks assume a recommendation exists to read, and a
mechanically correct total wipeout is not a defect in the run, it is the fixture's own checks
reading the wrong text (backlog 105).

This is not evidence that the frame library picks better answers than one careful pass, and no
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

## Fixture 001, assertion by assertion

The motivating prompt — "what timeouts should I set on this HTTP client?" — ships as
`evals/fixtures/001-http-timeouts.yaml` and is the regression test for the whole system. If a run
only returns the timeout triple, the run failed. **It does not pass reliably, and `adhd eval
--audit` says how unreliably.** Across the seven recorded runs of this fixture, every one of its
four `must_surface` items has now missed at least once, including the one that asks least.

| assertion | rate |
|---|---|
| the human who can cancel | 5/7 |
| the retry target questioned | 4/7 |
| who pays for the retry | 6/7 |
| a trap named | 6/7 |

The four have different dependencies, and E12's pair (`001-seed3-e12-1`, `-e12-2` — the first runs
where `adhd-branch` and `adhd-critic` dispatched as themselves) split them further. *Who pays for
the retry* and *a trap named* both held on both E12 runs, unchanged from the pattern the first five
runs showed: the retry-cost language and the trap ids reach `synthesis.md` regardless of whether a
branch survives, because the pruned block carries detector evidence either way. *The retry target
questioned* now misses for a second reason beyond the frame-set dependency the first five runs
showed (`LEDGER` and `ACTOR_CENSUS` carry it, the alternate set dispatches neither): both E12 runs
pruned every branch, and the retry-storm language that exists in `branches/DOOR_KEEPER.yaml`'s full
`reasoning` never reaches the pruned block, which carries only `position` and detector evidence.
That is a scope gap in the check, not a frame-set gap in the run — see backlog 105. *The human who
can cancel* split one-for-one across the two E12 runs, on top of the reseed sensitivity the first
five runs already showed, which reads as the same incidental-wording sensitivity rather than a new
pattern.

*A trap named* asks almost nothing — any `T[1-8]` anywhere in the pruned block — and the same-seed
repeat (`001-seed3-repeat`) is still its one miss. That run's critic fired no detector on any branch
and pruned nobody, where the byte-identical pack had fired T7 twice. E12 reran that same fixture and
seed with the critic's own instructions actually in force and found the opposite problem: both
critics fired *too much* rather than too little, agreeing with each other on 39 of 40 (branch, trap)
records and pruning every branch both times. D41 names the most economical cause for why the
original pair disagreed as completely as it did: the critic agent's own instructions had never been
in force for any of the fifteen runs before E12. See `docs/EXPERIMENTS.md` E12.

A `sometimes` verdict is not a pattern to loosen. It says nothing in the dispatched set reliably
asks that question.
