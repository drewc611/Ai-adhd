# Recorded run: 004, kernel-naming

Run `004-kernel-naming`, class `naming`, seed 4, n 5, final state `done`. Driven by the kernel (docs/OS.md); recorded by `adhd os record`.

## Provenance, from the journal

- Workers: claude-main.
- Lease expiries: 0.
- Tokens: 510808 over 749s from confirm.
- Eval outcome as recorded: FAIL, on one item.

## How it was produced

Ten tasks claimed and returned by one worker session: five branches as fresh isolated
subagents with the compiled brief as their entire prompt, pass A as a fresh critic, pass B
sent to that same critic (the kernel's continuation preference, taken), three deepen tasks as
fresh subagents. No frame in the naming set carries a tool grant, so no branch searched. The
subagents were general-purpose Claude Code subagents, not the plugin's agent definitions.

## The prediction this run was built to test, and how it came out

The fixture says plainly that the naming class is where the frames were most likely to
converge, because naming advice is famously identical regardless of what is being named. That
prediction was wrong, and cleanly so. Five frames produced five positions the critic sorted
into four clusters, and the spread is not cosmetic: "name it `new_checkout` and merge it
today" and "stop naming a flag and write the rollout plan first" cannot both be acted on.
`monoculture: false` in the fixture is the assertion that was most at risk here, and it held.

The frames that disagreed most sharply disagreed about the same thing: whether a flag key is
cheap to change. That single question, which the problem statement never raises, turned out to
be the axis the whole class runs on.

## What the run surfaced

- **The deletion angle (`deletion`, T7) is everywhere.** Every one of the five branches
  reached the flag's removal on its own, from four different directions: the name should be
  built to rot so the flag gets deleted, the name should carry a removal date, the removal
  needs an assigned owner, the removal date belongs in the rollout doc.
- **Who reads the name (`who_reads`, T6)** was answered by every branch and no two answered
  the same way: the analytics team blocked by a rename, the person who deletes the flag, the
  on-call engineer reading it beside a user id, the frontline support agent, payments ops.
  Run-level T6 could not fire; all five `missing_actor` fields were filled with a party and an
  action.
- **The reframe (`not_the_name`, T2)** came from three frames independently. One said the
  question is a request for permission to stop deliberating. One said the question smuggles in
  a boolean control surface. One said the question lacks the single fact that decides it.
- **Both folds are the best content in the run.** MINIMALIST folded and named exactly what it
  had got wrong: it had priced the reversal cost of the code and not of the analytics
  properties and warehouse partitions the key propagates into, and it had used an unowned
  deletion as the mitigation for its own naming risk, which it called out as a risk being its
  own mitigation. FRAME_BREAKER folded on the same asymmetry from the other side: it had
  treated the rollout design as the irreversible commitment and the string as a byproduct,
  when every field of the rollout doc is revisable weekly and the string is not. It also
  conceded that deferring the name does not remove the decision, it relocates it to whoever is
  unblocking themselves at 5pm.
- **HORIZON defended and paid for it.** It dropped the creation date from the key once the
  objection pointed out the provider's created-at field sits on the same dashboard row that
  its own 2am argument depended on, conceded that its headline claim (the permanently-on flag
  as a dead branch in the payment path) is unaffected by naming either way, and revised from
  `checkout_v2_2026_09` to plain `checkout_v2` plus an enforcement mechanism rather than an
  intent field. The recommendation is the revised position.

## What the run did not surface

- **`false_means` (T2) missed, and it is a real gap.** No branch asked what the name asserts
  when the flag is false. `checkout_v2 = false` means the user sees something, and nothing in
  this run says what, or whether the name should carry it. Every "false" and "off" in the
  artifacts is about something else. This is the naming-class analogue of the `who_is_hurt`
  miss in `002-first-run`: the frame set produced five good answers to a question nobody
  asked. Recorded as `expected.json { outcome: fail }` so it stays visible. Whether to add an
  actors- or particulars-axis probe that forces the negative case is the owner's call (D6).

  **The negative control passes this item.** `004-linear-cot`, added after this run, matches
  `false_means` on "avoid negations, `disable_old_checkout` forces double negatives" — a stock
  style-guide line. On this one assertion the consensus answer beats the divergent run. Either
  the frame set has a real gap or the assertion rewards recitation rather than reasoning. See
  that control's README; the choice is the owner's and is not being made by editing the fixture.
- No branch discussed what the flag name does to someone who has to search for it, or
  collisions with an existing key. MINIMALIST came closest, naming collision as the signal
  that would justify a convention.

## The bug this run found

The synthesis filed both folded positions under "Live singletons (unverified)". A position
that folded is not live; it withdrew and said what it should have been instead. Folds now get
their own section that names what was given up and points at the full concession in
`deepen/<frame>.yaml`, and "Live singletons" correctly reads `(none)` for this run. Test in
`test/os.test.ts`.

## What this says about the frame set (D6)

Five runs are now recorded and `adhd frames --orthogonality` still flags nothing; no pair has
reached the three shared runs the check requires. PARTICULARIST was pruned here for T4 —
handing the reader a two-way fork conditioned on a fact it did not go and get — which is the
same shape as its stated fallback when the problem lacks specifics. That fallback is written
into the frame's own stance, so the frame is behaving as designed and the design is what
tripped the detector. One run; not a verdict. Worth watching if it repeats.
