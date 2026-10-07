# Recorded run: 016, sla-boolean-name

Run `016-sla-boolean-name`, class `naming`, seed 1, n 5. Driven by hand through `adhd run
--phase`, not the kernel, so there is no `os.json` — same provenance shape as
`015-retry-field-default` and the other hand-driven recordings.

## What this run was built to test

Backlog 17's third attempt. Two prior real dispatches (D47's `004-frame-breaker-probe`, D52's
`004-negative-space-probe`) produced reasoning a human reader would call a clear pass on the
`false_means` question — what a name asserts about the state it does not name — and
`004-flag-name.yaml`'s own detector regex matched neither. That regex is untouched here: editing
it now, having read both near-misses in detail, would be exactly the widening-after-seeing-failure
D56 and E3 forbid. Instead, `evals/fixtures/016-sla-boolean-name.yaml` asks the same underlying
question in a different domain — an SLA-alert boolean on a support ticket, not a feature flag —
with its own `false_means` assertion written from the description before this fixture had ever
been dispatched. Seed 1 draws both `FRAME_BREAKER` and `NEGATIVE_SPACE` into the five-branch
selection, the two frames that produced the near-misses on 004.

## The result: false_means reverses, the run as a whole still fails

`adhd eval --audit` shows the reversal directly:

| fixture | item | real | branch |
|---|---|---|---|
| `004` | `false_means` | 0/3 | 0/16 |
| `016` | `false_means` | **1/1** | **3/5** |

Three of five branches — `CARETAKER`, `NEGATIVE_SPACE`, and `SUPPLICANT` — independently surfaced
that the field's false value has to cover several genuinely different ticket states, in their own
words, with no detector tuning aimed at any of their specific phrasings (the fixture and its
detector existed before any of them were dispatched). `who_reads` matched all five; `not_the_boolean`
matched one (`FRAME_BREAKER`, the branch that rejected the single-boolean premise outright).

`adhd eval` still reports `FAIL`, for a reason that has nothing to do with `false_means`: every
one of the five branches drew at least one fired trap, so the run produced zero survivors and no
recommendation at all. `must_not/never_names_it` requires the recommendation to commit to a name
or an explicit rejection of a single boolean — there is no recommendation to check it against.
This is a structural outcome of the run, not a finding about the fixture's core question.

## What pruned everyone

- **`CARETAKER`** (T2, T6): never tested whether a boolean is the right representation, only what
  to call it; named only the downstream reporting/billing owner as an actor, not the operator who
  sets the flag day to day.
- **`NEGATIVE_SPACE`** (T2, T4, T6, T7): accepted the boolean-override premise outright; declared a
  bare boolean without a setter/timestamp foreclosed but never specified how to satisfy that; named
  only the reporting owner; never staged the naming choice against the costlier audit obligation it
  called for.
- **`MINIMALIST`** (T2): treated the boolean-field framing as given by the question's own wording
  and never tested it.
- **`FRAME_BREAKER`** (T7 only): the one branch to explicitly name and reject the load-bearing
  assumption — that queue membership is a static fact a boolean can hold — and propose an audited
  suppression record instead. Pruned anyway: it commits straight to the more expensive design
  without weighing it against shipping the cheap boolean first and upgrading only if misuse
  actually appears, the staged move three of its siblings used instead.
- **`SUPPLICANT`** (T2, T4, T7): relocated the question to visibility and never actually named the
  field, which was the one decision the question asked for; treated a customer-facing UI commitment
  as no costlier than defaulting a column to false.

## Run level

- `T2_no_branch_attacked_assumption`: did not fire. `FRAME_BREAKER` attacked it.
- `T6_all_missing_actor_null`: did not fire. Every branch named an actor.
- Every branch pruned. Nothing to deepen. `adhd run --phase deepen` refused outright and named the
  reason; `--phase synth` rendered the pruned block as the entire result, per this repository's own
  rule that the pruned block always ships.

## Recommendation this run produced

None. See `synthesis.md`: "No recommendation. Every branch was pruned. The pruned block is the
result."

## Cost

Estimated 527,800 tokens over 6 reported tasks (5 branches, 1 critic session covering both
passes; no deepen, refused by the all-pruned outcome), 812s wall clock since compile. See
`cost.json`.
