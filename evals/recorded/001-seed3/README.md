# Recorded run: 001, seed3

Run `20260915013807-7e664e`, class `design_decision`, seed 3, n 5, rubric version 1. Driven by
hand through `adhd run --phase`, not the kernel, so there is no `os.json` and no journal
provenance. Branches and critic were dispatched as `general-purpose`, as every recorded run has
been; see D4 and D36 for why that is a disclosed exception rather than the design.

## What is different about this one

It is the **first run under the folded output contract (D37)** and the **first scored under rubric
version 1 (D34)**, which retires `foreclosure`. Pass A is 5 letters x 8 dimensions where every
earlier recording is 5 x 9, and `plan.json` carries `rubric_version: 1`. Neither changes what the
fixture asserts.

It is also the second attempt at this seed. The first, `20260914223732-7e664e`, aborted at
critique under D30: three of five artifacts would not parse because `falsifier` and `missing_actor`
were plain YAML scalars and each branch wrote a second `: ` inside the value. 262,788 tokens, nothing
scored. D37 folds every prose field, and this run cleared the same phase with 5 valid artifacts and
0 contract violations. One branch here wrote `isolation: under this position` inside a `forecloses`
item, which is the construct that aborted the first attempt.

## What the run surfaced

All four `must_surface` items, including the two the seed 2 recording lists as failing:
`human_cancel` and `retry_cost`. Two clusters, three survivors, both representatives **defended**
under their strongest objection.

- `ship_a_tight_constant_now` (MINIMALIST, DOOR_KEEPER) held the recommendation. DOOR_KEEPER
  defended but the defence cost something: it conceded that its falsifier named the wrong
  instrument, because a dependency latency histogram cannot report on the caller's remaining
  budget, and added caller-side orphaned-work metrics to the same change.
- `inherit_and_propagate_a_deadline` (LEDGER, with FRAME_BREAKER and ACTOR_CENSUS pruned after
  corroborating) defended by conceding one foreclosure: the claim that the number is not the
  client's to choose. A local deadline needs no other team.

## What the run did not surface

- expect pruned_traps_include_any T1,T2,T3: only T7 fired, on FRAME_BREAKER and ACTOR_CENSUS.
