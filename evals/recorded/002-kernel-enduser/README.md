# Recorded run: 002, kernel-enduser

Run `002-kernel-enduser`, class `fuzzy_debugging`, seed 2, n 5, final state `done`. Driven by the kernel (docs/OS.md); recorded by `adhd os record`.

## Provenance, from the journal

- Workers: claude-main.
- Lease expiries: 0.
- Tokens: 459551 over 767s from confirm.
- Eval outcome as recorded: PASS.

## Why this run exists

The first run of fixture 002 (`002-first-run`) missed `who_is_hurt`: no frame in the
`fuzzy_debugging` set asks who the tail latency lands on. This run swaps END_USER (actors
axis) in for NIGHT_OPERATOR via an explicit `frames` list in the routing decision, leaving
`config/routing.yaml` untouched, to test whether an actors-axis frame closes the gap. It is
also the first run driven end to end by the kernel (`adhd os`), with this session as the only
worker: nine claims, nine returns, four automatic phase advances, zero lease expiries.

## What the run surfaced

- `who_is_hurt` now passes. END_USER asked it directly ("the slowest 1% of users", "what would
  make them give up, and what happens to the system when they do"). Read the next section for
  how it reached the output.
- Three frames on three axes converged on the same first move: measure the period before
  touching anything (PARTICULARIST, FRAME_BREAKER, SABOTEUR). Corroboration across
  particulars, frame validity, and adversary is the strongest signal this run produced.
- Under the critic's objection, the surviving cluster's representative (FRAME_BREAKER) gave
  up its first action (the interval histogram, which a bucketed p99 series cannot resolve) and
  its reading of "or so" as jitter, and replaced both with a cheaper gate: split p99 by
  instance, then correlate. The recommendation is the revised position, labelled as such.
- MECHANIC folded. It had built its whole derivation on "or so" meaning measured drift and
  conceded that a person describing a dashboard says "or so" either way. Folding is a
  reported outcome, and the fold text says what the position should have been.

## What the run did not surface, and one thing to know about how it passed

- The `who_is_hurt` match comes from the pruned block, not the recommendation. The critic
  pruned END_USER for T1 (unchanged if you delete the problem's details), T7, and T8 (the
  appeal was in the angle). The pruned block always ships, with the position and the detector
  output, so the reader sees the question END_USER asked. The recommendation itself does not
  ask who is hurt. Whether that counts as "surfaced" is a judgment the fixture makes by
  scoring the whole output; a reader who only reads the bold line will not see it.
- No branch named fail-over, degraded mode, or partial output. Fixture 002 does not ask for
  that; noted because run 001's README did.
- END_USER's pass A score was the lowest of the five (0.58). The frame produced the missing
  question and a position the rubric scores poorly on specificity and substance. That is
  consistent with the frame's design: it forbids reasoning from the implementer's seat, so it
  cannot say where to look. In this class it is a question-raiser, not an answer-giver.

## What this says about routing (D6)

One run, one seed, explicit frames. It is evidence, not a decision. If END_USER joins the
`fuzzy_debugging` primary set, expect it to be pruned often and to earn its place through the
pruned block. The owner decides.
