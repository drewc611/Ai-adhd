# Recorded run: 001, E12 cell 1

Run `e12-run1-seed3`, class `design_decision`, seed 3, n 5, rubric version 1. Driven by hand
through `adhd run --phase`, so there is no `os.json` and no kernel provenance. `dispatch.json`
is real for this one: every branch task and both critique passes are recorded, `planned` equal
to `actual` throughout, because this is the first recorded run of fixture 001 where
`adhd-branch` and `adhd-critic` actually launched as themselves rather than falling back to
`general-purpose` (D41).

## What this is

Cell 1 of E12 (`docs/EXPERIMENTS.md`, backlog 102): does the trap sweep reproduce once the
critic agent's own instructions -- blind pass A, mechanical eight-record sweep, a gap rejects
the pass -- are genuinely in force? Item 4's original pair ran the critique phase as
`general-purpose` with the branch system prompt pasted in, which is not what
`agents/adhd-critic.md` says to do. This pair is the first test of the actual instructions.

## What the run surfaced

Every branch fired T1 (consensus trap) in pass B: the reasoning in each of the five artifacts
holds up against the fixture's own bare prompt regardless of which of the prompt's few specific
details are removed, because the prompt supplies almost none to begin with. Four of five
branches also fired T2 (frame trap, ACTOR_CENSUS the exception at pass B time) and T6 (actor
omission, DOOR_KEEPER and ACTOR_CENSUS the exceptions), and four of five fired T7 (reversibility
blindness, DOOR_KEEPER the exception). The run pruned to zero survivors and deepen refused:
"every branch was pruned. Nothing to deepen."

Run-level checks both came back clean: two branches (FRAME_BREAKER, ACTOR_CENSUS) attacked the
load-bearing assumption, so run-level T2 did not fire; every branch named a real, non-null
`missing_actor`, so run-level T6 did not fire either. The wipeout is not a case of every branch
making the same mistake -- it is five different arguments, each individually generic to any bare
timeout question, agreeing on nothing except that none of them earns a pass on specificity.

## What the run did not surface

`must_surface human_cancel` and `retry_target_questioned` fail. Both traits exist in the full
branch reasoning (DOOR_KEEPER's artifact discusses retry storms and duplicate side effects at
length) but the pruned block in `synthesis.md` carries only each branch's `position` line and
the critic's detector-evidence sentences, not its `reasoning` field, and neither the retry
language nor any cancellation language happens to appear in that shorter text. `must_not
triple_only` and `must_not no_verdict` both trip, for a related reason: those checks were
written to catch a shallow recommendation, not the absence of one, and "No recommendation.
Every branch was pruned." is short enough and has no "do X" sentence, so it reads to the checks
like exactly the failure mode they exist to catch, which it is not.

See `docs/EXPERIMENTS.md` E12 for the reading against cell 2 (`001-seed3-e12-2`) and against
item 4's original pair (`001-seed3`, `001-seed3-repeat`).
