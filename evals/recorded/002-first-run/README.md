# Recorded run: 002, first real run

Fixture 002, `fuzzy_debugging`, seed 1, five branches in dispatch order: SABOTEUR,
FRAME_BREAKER, NIGHT_OPERATOR, PARTICULARIST, MECHANIC. Recorded 2026-09-06 from a live run
driven by the procedure in `skills/adhd/SKILL.md`.

## Outcome: FAIL, and recorded as expected

`expected.json` says `fail`. The run misses one `must_surface` item, `who_is_hurt`: nobody
asked whether p99 matters or to whom. That is a real gap, not a regex accident. The five
frames in the fuzzy debugging set are all about mechanism, adversary, operation, particulars,
and frame validity. None is on the actors or cost axis, so none asks who is on the receiving
end of the tail. The frames that would (END_USER, ACTOR_CENSUS, LEDGER) were not dispatched.
Whether to change the routing set is the owner's call and should rest on a second run.

A second item, `no_verdict`, failed on the first evaluation for a fixture reason: the
recommendation opens with "Pull ... before opening any subsystem log", an imperative the
fixture's hand-written verb list did not include. The harness now has a `must_be_imperative`
check that shares the T5 lint's verb list and treats "first" and "before" as ordering. Both
fixtures use it.

## Provenance, honestly

- Branches, critic, and deepen ran as `general-purpose` Claude Code subagents with separate
  contexts, not the plugin's agent definitions. Each was told it had no tools; none used any.
- No spawn was blocked this time. Token figures in `cost.json` are the subagents' own usage
  reports summed.

## What the run surfaced

- The period is a clock, and "or so" is the most diagnostic word in the question. Four of five
  branches built on it independently (PARTICULARIST, MECHANIC, FRAME_BREAKER, NIGHT_OPERATOR).
- Drift direction discriminates mechanisms: a fill-and-drain buffer compresses its period under
  load, a sleep-after-completion loop stretches it (PARTICULARIST, under objection).
- A period is found by changing a dial and watching it move, not by staring at metrics
  (FRAME_BREAKER, defended; the dial may be a capacity rather than a schedule).
- The cheap observation comes before any change: read the timestamps before opening a log
  (every survivor).

## What the run did not surface

- Who is hurt. See above.
- The critic pruned SABOTEUR as a consensus method (T1). SABOTEUR was the only branch that
  questioned whether the spike is real (a histogram artifact) and the only one that named the
  caller as an actor. Both points came back into the run through the critic's strongest
  objection to the sawtooth cluster, and PARTICULARIST adopted the per-caller partition under
  that objection. The pruned block is where that argument lives; the recommendation carries
  its effect without its author.

## What the run taught the plumbing

- The pass B prompt's instruction not to name frames in objections held: both objections were
  clean and the deepen redaction had nothing to remove.
- Fixture verb lists were a maintenance trap. Replaced by one shared imperative check.
