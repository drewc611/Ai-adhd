# Recorded run: 004, frame-breaker-probe

Run `004-frame-breaker-probe`, class `naming`, seed 4, n 5, same problem text as
`004-kernel-naming`. Driven by hand through `adhd run --phase`, not the kernel, so there is no
os.json — same provenance shape as `001-seed3`.

## What this run was built to test

D47 added a second probe to FRAME_BREAKER, aimed at backlog 17: `004-kernel-naming` never
surfaced `false_means` (T2), the assertion that some branch says what the name asserts when
the flag is off. `docs/AUTHORING-FRAMES.md` already named this as a probe on an existing
frame rather than a new one, so this run re-dispatches fixture 004 under the same seed — same
five frames (SUCCESSOR, MINIMALIST, PARTICULARIST, SUPPLICANT, FRAME_BREAKER; the naming set
hasn't changed since D6 renamed HORIZON and END_USER) — to see whether the probe closes the
gap.

## The result: it did not, and the near miss is worth reading

`adhd eval` still fails `004/false_means` on this recording. FRAME_BREAKER's reasoning does
engage the new probe question directly — its second paragraph says a name like
`new_checkout_enabled` "asserts an implicit 'old checkout' fallback state" that "the name
carries none of that as fact, it just gestures at it" — which is substantively the false_means
question, closer than anything in `004-kernel-naming`. Two things stopped it from counting:

- The language doesn't match the detector's regex (`when (it|the flag) is (false|off|disabled)`,
  `(false|off) means`, `ambiguous`, and so on). The idea is there; the specific phrasing the
  fixture watches for is not.
- FRAME_BREAKER's branch was independently pruned for T1 (its "naming is not the decision,
  governance is" argument is generic enough to survive deleting every checkout-specific detail)
  and T7 (never weighs the cost of skipping governance against the cost of the lifecycle record
  it proposes). Even if the phrasing had matched, this branch did not reach the final synthesis.

So the honest reading is not "the probe failed" so much as "one probe on one frame, on one
seed, moved the branch's reasoning toward the gap without moving its language into the
detector's coverage, and the branch that got closest lost on unrelated grounds." That is a
single data point, not a verdict on whether a probe can ever close this gap. Full accounting in
`expected.json` and D47 in `docs/DECISIONS.md`.

## What the run surfaced

- **Four of five branches attacked a load-bearing assumption** (run-level T2 did not fire):
  that the flag stays safely temporary, that naming is even the right decision to be making,
  or that this is a purely internal choice. Only MINIMALIST accepted the question's frame
  wholesale, and it was pruned for exactly that (T2).
- **PARTICULARIST and FRAME_BREAKER clustered** on withholding the name until the flag's
  lifecycle status is established. FRAME_BREAKER was pruned; PARTICULARIST carried the
  cluster, defended the objection that a one-off temporary/permanent classification is fragile
  under inertia, and **revised its position** to tie the name to a rollout ticket plus an
  automated check that flags the name once that ticket has been closed past a threshold — an
  external, checkable signal in place of relying on someone remembering to revisit the name.
- **SUCCESSOR folded cleanly.** Its "migrate to a versioned key today" position depended on
  downstream entanglement (two years of analytics history, mobile builds, a merchant contract)
  that nothing in the problem statement supports; asked to defend it, it conceded the
  entanglement was invented to justify the urgency and that a greenfield name costs nothing to
  get right the first time.
- **SUPPLICANT reframed the question** as a user/support-facing problem (surface the checkout
  version somewhere a support agent can look it up) rather than an internal naming problem, and
  survived every trap but T7 (never weighed the cost of building that surface against the cost
  of not needing it) — pruned on that alone, a genuinely different miss from `004-kernel-naming`'s
  equivalent branch.

## Recommendation this run produced

Before naming the flag, determine whether it's temporary or permanent. If temporary, tie the
name to the rollout ticket (never the word "new") and add an automated or periodic check that
flags the name once that ticket has been closed past a threshold, so drift into de facto
permanence gets caught rather than assumed away. If permanent, name it after the actual
capability being shipped, never using "new" at all.

## Cost

133,007 tokens over 8 reported tasks (5 branches, 1 critic session covering both passes, 2
deepen). See `cost.json`.
