# Recorded run: 001, seed 3, repeat

Run `20260915071403-7e664e`, class `design_decision`, seed 3, n 5, rubric version 1. Driven by hand
through `adhd run --phase`, not the kernel, so there is no `os.json` and no journal provenance.
Branches, critic and deepen were dispatched as `general-purpose`, matching `001-seed3` exactly; see
D4, D36 and D38 for why that is a disclosed exception rather than the design.

This is backlog item 4: the same fixture at the same seed on a different day, with everything the
compiler reads held fixed. Before dispatch, all five briefs were confirmed byte-identical to
`001-seed3`'s and nothing a `design_decision` run reads had changed. The only variable is the
session.

## What it found

**The critic pruned two branches in one session and none in the other, on identical input.**

| | `001-seed3` | this run |
|---|---|---|
| clusters | 2 | 3 |
| detectors fired | T7 on `ACTOR_CENSUS`, T7 on `FRAME_BREAKER` | none, on any frame |
| pruned | 2 of 5 | 0 of 5 |
| deepen briefs | 2 | 3 |
| assertions failed | 1 | 3 |

The three extra assertion failures are one event: with nothing pruned, `pruned_min 1`,
`pruned_traps_include_any` and `trap_named` all have nothing to read. All four `must_surface`
content items pass in both runs.

**Pass A barely moved.** Three frames shifted by one or two rubric points and two did not move at
all: `ACTOR_CENSUS` +0.048, `DOOR_KEEPER` −0.024, `LEDGER` −0.024, `FRAME_BREAKER` and `MINIMALIST`
unchanged. Mean absolute move 0.019, largest 0.048. The blind letter mapping came out identical, as
the shared seed should give.

**The clustering moved at one boundary of two.** `{FRAME_BREAKER, ACTOR_CENSUS, LEDGER}` reproduced
exactly, under a different name. What split was `{MINIMALIST, DOOR_KEEPER}`, which this run made two
singletons, sending three representatives to deepen instead of two.

**Positions were close enough to check by eye.** `DOOR_KEEPER` reproduced "2s connect, 5s
per-attempt read, 10s total deadline, no retries" almost verbatim from a separate context window.
Divergence is stable at the branch; the variance lives in the critic.

## Why this matters to E1a

E1a varied the seed and the session together and read the whole difference as a seed effect. Held
at one seed, the prune set swung by the same magnitude: seed 1 to seed 2 went 2 of 5 pruned to 4 of
5, and seed 3 to this run went 2 of 5 to 0 of 5. E1a's movement is therefore not attributable to
the seed. See `docs/EXPERIMENTS.md`.

## Provenance

`pass-a.yaml` and `pass-b.yaml` are one critic agent, resumed for pass B as the run procedure
requires. The three deepen artifacts are three fresh agents that saw one position and one objection
each and nothing else. Every artifact is the agent's final message written unedited.
