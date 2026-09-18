# Recorded run: 001, E12 cell 2

Run `e12-run2-seed3`, class `design_decision`, seed 3, n 5, rubric version 1. Driven by hand
through `adhd run --phase`, so there is no `os.json` and no kernel provenance. Same briefs as
cell 1 (`001-seed3-e12-1`, confirmed byte-identical), fresh independent branch subagents, and a
fresh independent `adhd-critic` subagent -- not the same critic session that scored cell 1.

## What this is

Cell 2 of E12. See `001-seed3-e12-1/README.md` for what the experiment is testing. This cell
exists to compare against cell 1, the same way item 4's `001-seed3-repeat` compared against
`001-seed3`.

## What the run surfaced, against cell 1

Total wipeout again: every branch fired T1, the run pruned to zero survivors, deepen refused.
The prune set is identical to cell 1's -- all five branches, both times -- against item 4's
`{ACTOR_CENSUS, FRAME_BREAKER}` to `{}`. At the trap level, 39 of the 40 (branch, trap) records
agree between the two cells; the one disagreement is ACTOR_CENSUS/T2, which this cell's critic
read as not attacking the load-bearing assumption and cell 1's critic read as attacking it. Every
other frame's full eight-trap row is identical across both cells. That is a different picture
from item 4's pair, where the two runs agreed on zero detector firings between them (T7 twice
versus none at all).

Pass A composite scores moved more than E11's 0.10 noise floor for three of five frames
(MINIMALIST +0.12, LEDGER +0.15, FRAME_BREAKER +0.12; DOOR_KEEPER -0.05 and ACTOR_CENSUS +0.00
stayed inside it). This is not the same comparison E11 made: E11 held one set of artifacts fixed
and swapped only the critic, isolating scoring noise. Here the branches themselves are also a
fresh draw at each cell, so the movement carries both branch-content variance and critic-scoring
variance, and this pair cannot separate them. What it does show is that pass A's cardinal scores
are noisier than pass B's structural verdict: the numbers moved past the established floor while
the trap sweep that actually decides pruning barely moved at all.

## What the run did not surface

`must_surface retry_target_questioned` fails, for the same reason as cell 1: the pruned block
carries position and detector-evidence text, not full reasoning, and the retry-storm language
several branches used in their `reasoning` field never reaches `synthesis.md`. `must_not
triple_only` and `must_not no_verdict` trip for the same reason as cell 1: a run with no
recommendation is not what those checks were written to catch, but it reads like it to them.
Unlike cell 1, `must_surface human_cancel` passes here -- ACTOR_CENSUS's detector-evidence text
happens to use language the fixture's pattern matches this time.

See `docs/EXPERIMENTS.md` E12 for the full reading.
