# Recorded run: 001, altframes

Run `20260907035041-7e664e`, class `design_decision`, seed 1, n 5, final state `done`. Driven by the kernel (docs/OS.md); recorded by `adhd os record`.

## Provenance, from the journal

- Workers: b1, c2, d2.
- Lease expiries: 0.
- Tokens: 519482 over 778s from confirm.
- Eval outcome as recorded: FAIL (2 failing items).

## What the run surfaced

_Fill in from synthesis.md. The kernel records provenance; a person records meaning._

## What the run did not surface

- must_surface retry_target_questioned (T2): "Wait, then retry the same instance" is questioned: either an alternative is named
(fail over, degraded mode, partial output) or retry amplification against the target
that is already struggling is called out. A bare "degrade" does not count; the first
real run matched "degrades that way" in an unrelated sentence.
- must_surface retry_cost (T6): Someone pays for the retry, and the answer says who and in what currency.
