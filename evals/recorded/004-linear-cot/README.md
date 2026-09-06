# Recorded run: 004, linear chain of thought

A hand recorded negative case for fixture 004. `adhd eval` must report FAIL on this directory.

Every convention listed here is genuinely good advice, including the one about avoiding
negations, which is the closest any consensus answer gets to the question fixture 004 says the
real run also missed. The answer commits to a name, which is more than many naming answers do.

## What it does not do

- Every word of it would be identical for a flag over any feature. Delete "checkout" and
  nothing changes.
- It never treats the flag as temporary, so nothing in the name helps anyone delete it later.
- It never names a reader other than the person writing the call site. Support, on-call, and
  the analytics consumer do not appear.
- It hands back six conventions and defers to "consistency with what you already have", which
  returns the decision to the asker after appearing to answer it.

This control is the reason fixture 004's `convention_list` check counts list items: an answer
can commit to a name and still be a list of conventions wearing a verdict.

## The result nobody wanted

This control **passes `false_means`**, the one item the real run `004-kernel-naming` failed.
It passes on the line "Avoid negations. `disable_old_checkout` forces the reader to think in
double negatives," which is a stock item from every naming style guide ever written.

So on that item, the consensus answer beat five isolated frames, a blind rubric, a trap sweep
and a deepen round. Not because it reasoned better: because the negative case is a memorised
convention, and memorised conventions are the one thing a consensus answer is reliably good
at. It is the mirror image of the repo's whole thesis. Divergence buys you the questions
nobody has a stock answer for, and it can lose to the stock answer on the ones that have one.

Two honest readings, and the run does not settle between them:

1. The frame set has a real gap. No frame asks what a thing asserts in its negative case, and
   `false_means` is a genuine question the run should have reached. That is backlog item 17.
2. `false_means` is the wrong assertion for this fixture. Matching "double negative" rewards
   reciting a style rule rather than reasoning about what `checkout_v2 = false` leaves a user
   looking at. A pattern that a style guide satisfies is not measuring divergence.

Both are defensible and both are the owner's call. Recorded here, in the run's own README, and
in DECISIONS rather than resolved by quietly editing the fixture.
