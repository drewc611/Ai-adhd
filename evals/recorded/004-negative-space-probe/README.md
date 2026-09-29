# Recorded run: 004, negative-space probe

Run `004-negative-space-probe`, class `naming`, seed 4, n 6, same problem text as
`004-kernel-naming` and `004-frame-breaker-probe`. Driven by hand through `adhd run --phase`,
not the kernel, so there is no os.json — same provenance shape as the other two.

## What this run was built to test

Two things at once, deliberately combined rather than run separately:

1. **NEGATIVE_SPACE (D51, backlog 23)** had never been dispatched. This is its first real
   evidence: the naming class's usual five frames (PARTICULARIST, FRAME_BREAKER, SUPPLICANT,
   CARETAKER, MINIMALIST) plus NEGATIVE_SPACE as a sixth, same seed, same problem.
2. **Backlog 17's `false_means` gap** — no frame asks what a name asserts about the state it
   doesn't name — is exactly the question NEGATIVE_SPACE's stance is built to ask in general,
   not just for names. D47 already tried a FRAME_BREAKER probe and recorded, honestly, that it
   engaged the question but didn't close the gap. This run asks whether a frame built around
   the question from the ground up does better.

## The result: closer, and still not close enough

`adhd eval` fails `004/false_means` on this recording, the same as both runs before it.
NEGATIVE_SPACE's reasoning traces the question about as directly as anything in the corpus has:
a plain boolean flag collapses "a user who was never evaluated" and "a user deliberately held
back as a control" into the same `false` value, and a version-pinned or multivariate name
preserves that distinction instead of destroying it. That is the false_means question, argued
in the vocabulary of analytics state rather than the fixture's vocabulary of "what does off
mean" — and the detector's regex (`when (it|the flag) is (false|off|disabled)`, `(false|off)
means`, `ambiguous`, `(what|which) state`, and so on) does not match it, checked directly
against all six artifacts with the exact patterns and found in none of them.

The near miss is real but it is not the largest thing this run found.

## The larger finding: total scatter

Six branches, zero shared actions — not even a two-way cluster. That is notable specifically
because both runs before this one, with the same five base frames, produced exactly one cluster
each: `004-kernel-naming` clustered `HORIZON+PARTICULARIST`, and `004-frame-breaker-probe`
clustered `PARTICULARIST+FRAME_BREAKER` — the same pairing, twice, on different days. This run
did not reproduce it. `adhd run --phase deepen` refused outright (`SCATTER: 6 branches and no
two share a position`), so nothing was deepened and `adhd run --phase synth` rendered a run with
**no recommendation at all**.

**What this is not:** a demonstrated causal effect of adding NEGATIVE_SPACE. Branch output is
not deterministic, and re-running the same five frames today without a sixth might scatter too,
for reasons that have nothing to do with the sixth frame's presence. This is one run, at one
seed, and `docs/RETIREMENT.md`'s own discipline about single-sample findings applies here as
much as anywhere else in this corpus. What is fair to say: the previously-stable
PARTICULARIST+FRAME_BREAKER pairing did not hold this time, in the one run where NEGATIVE_SPACE
was present. Worth a second run before it is anything more than that.

## NEGATIVE_SPACE's own first scorecard

Pass A: 0.88 (second highest of six, behind CARETAKER's 0.95). Pruned in pass B on:

- **T4** (completeness): the position names two live mechanisms — a versioned boolean or a
  multivariate flag — without settling which to build.
- **T7** (reversibility blindness): never weighs what it costs to guess wrong on flag shape
  against how expensive it would be to widen a boolean into a multivariate flag later.

Both are real, specific findings about this one artifact, not a verdict on the frame in
general — the same status every other frame's first few appearances carry. `docs/BACKLOG.md`
item 19 (fixtures built specifically to demonstrate a new frame winning, then run) is the next
step for a stronger claim either way.

## What the run surfaced

- **Run-level T2 did not fire.** Four of six branches attacked a load-bearing assumption from a
  different angle each: that a boolean is the right flag shape (NEGATIVE_SPACE), that naming is
  even the live decision (FRAME_BREAKER), that the flag's name matters to the party who actually
  encounters it (SUPPLICANT), and that a relative name is harmless at launch (CARETAKER).
- **Run-level T6 did not fire.** All six branches named a real actor with a real action:
  the experimentation/data-science owner, the on-call/platform team, the shopper and a support
  agent, the flag-platform administrator, the analytics/data team, and whoever owns post-rollout
  cleanup — six different omitted parties, one per branch, no overlap.
- **CARETAKER was the sole survivor**, unverified: scatter blocks deepen before a survivor gets
  its objection round, so its position (`checkout.single_page_flow`, a permanent
  domain-prefixed identifier, never relative language) stands as recorded, with the strongest
  objection the critic could name attached but never put to it.

## Recommendation this run produced

None. Scatter. `synthesis.md` renders "No recommendation. Run level scatter. The question needs
clarification before it can be answered," with the full pruned block and CARETAKER's unverified
position, per this repository's own rule that the pruned block always ships.

## Cost

136,606 tokens over 7 reported tasks (6 branches, 1 critic session covering both passes; no
deepen, refused by scatter). See `cost.json`.
