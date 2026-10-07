# Recorded run: 015, retry-field-default

Run `015-retry-field-default`, class `naming`, seed 15, n 5. Driven by hand through
`adhd run --phase`, not the kernel, so there is no `os.json` — same provenance shape as
`004-negative-space-probe` and the other hand-driven recordings.

## What this run was built to test

Backlog 19's other half. `evals/fixtures/015-retry-field-default.yaml` was written specifically
for `NEGATIVE_SPACE` to obviously win: a webhook `max_retries` field that doesn't exist yet, where
the absence already means "retry forever" operationally, and any finite default silently changes
that for every existing integration. Writing the fixture was not running it; this entry is the run.

## The result: the fixture passes, the frame does not win

`adhd eval` reports `PASS`. All four `must_surface` assertions matched somewhere in
`synthesis.md` and neither `must_not` assertion fired. That is a weaker claim than "NEGATIVE_SPACE
won" — the assertions aren't scoped to the shipped recommendation alone, and NEGATIVE_SPACE's own
artifact is where most of them are satisfied, not the bolded recommendation.

**NEGATIVE_SPACE survived pass B clean** — zero traps fired, its own singleton cluster
(`preserve_unlimited_default`) — with pass A 0.952, second only to FRAME_BREAKER's 0.976 and well
ahead of PARTICULARIST (0.833), CARETAKER (0.690), and SUPPLICANT (0.524). It named all four
readers of today's absence (the retry worker, the operator, the receiving endpoint's owner, a human
reading the schema), forced the field name and default closed in one sentence, and distinguished
the reversible unlimited default from the irreversible finite one. Nothing in its artifact is
weaker than what the fixture's own `why` describes as the frame's job here.

**It still did not ship as the recommendation.** `src/synth.ts` picked the corroborated cluster
(`bound_with_mandatory_exhaustion_signal`: FRAME_BREAKER, corroborated by pruned CARETAKER) as the
bolded recommendation and relegated NEGATIVE_SPACE to "Live singletons (unverified)." The margin
between the two survivors' pass-A scores was 0.024 — closer than any pruned branch came to either —
and it changed nothing, because the renderer's tie-break is cluster membership, not score. See
D56 for the full account; this is its real-run evidence.

## NEGATIVE_SPACE's own scorecard

Pass A: 0.952 (second of five). Zero traps fired in pass B. Deepened under the strongest objection
the critic could raise (defaulting to unlimited leaves the motivating pain unresolved for almost
every config); defended, with the position revised to pair the unlimited default with a visible
non-default signal (a warning log or metric) rather than a silent default alone. Survived as a
singleton, flagged unverified per this repository's own convention for scatter-adjacent singletons.

## What the run surfaced

- **Run-level T2 did not fire.** PARTICULARIST, NEGATIVE_SPACE, and FRAME_BREAKER each attacked a
  different load-bearing assumption (the right unit, whether absence is ambiguous, whether a count
  field is the substantive fix at all).
- **Run-level T6 did not fire.** Every branch named a concrete missing actor with a concrete action.
- **Two clean survivors, no scatter.** Unlike `004-negative-space-probe`, this run clustered
  normally: two two-member clusters (one entirely pruned, one half-surviving) plus one singleton.
  That is what let the corroborated-vs-singleton tie-break actually decide something, rather than
  being masked by scatter the way it was in 004.
- **FRAME_BREAKER's shipped position cost something under objection.** Its original stance (build
  the full exhaustion path first, attach the bound only afterward) conceded the sequencing was
  wrong; the revised recommendation ships a minimal durable exhaustion record alongside the bound
  immediately, deferring only the richer subscriber-facing alerting.

## Recommendation this run produced

**Ship a bounded `max_retries` default and a minimal durable exhaustion record (one row or log
line per delivery ID, written when retries are exhausted) together in the same change, and build
richer subscriber-facing status/alerting in parallel rather than as a blocking prerequisite to the
bound.** Held by FRAME_BREAKER, corroborated by pruned CARETAKER. Full pruned block and the
NEGATIVE_SPACE singleton ship with it, per this repository's own rule. See `synthesis.md`.

## Cost

Estimated 527,800 tokens over 8 reported tasks (5 branches, 1 critic session covering both passes,
2 deepen subagents), 1110s wall clock since compile. See `cost.json` for the real per-task figures
that were available before a context compaction interrupted full tracking, and D56 for the finding
this run was recorded to settle.
