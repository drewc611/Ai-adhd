# Recorded run: 001, seed2

Run `20260907034314-7e664e`, class `design_decision`, seed 2, n 5, final state `done`. Driven by the kernel (docs/OS.md); recorded by `adhd os record`.

## Provenance, from the journal

- Workers: w1, c1, d1.
- Lease expiries: 0.
- Tokens: 445330 over 555s from confirm.
- Eval outcome as recorded: FAIL (3 failing items).

## What the run surfaced

_Fill in from synthesis.md. The kernel records provenance; a person records meaning._

## What the run did not surface

- must_surface human_cancel (T6): The human waiting is an actor who can cancel. The bail out path is modelled.
- must_surface retry_cost (T6): Someone pays for the retry, and the answer says who and in what currency.
- expect pruned_traps_include_any T1,T2,T3: none named in pruned block
