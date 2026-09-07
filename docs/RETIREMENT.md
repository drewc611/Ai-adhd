# Retiring a frame

The library has no way to shrink. Frames get added when a run finds a gap, nothing ever takes
one out, and a set that only grows is a set that eventually contains three frames producing one
answer. That is the monoculture the whole design exists to prevent, arriving through the back
door.

This is the bar a frame has to fail before it comes out. D6 governs adding; this governs removing.
Both are the owner's call. Nothing here fires automatically, and nothing should.

## The bar

A frame is a candidate for retirement when it meets **two or more** of these across **at least
five runs in which it was dispatched**. One is a pattern; two is a case.

1. **It duplicates another frame.** `adhd frames --orthogonality` reports it co-clustering with
   the same partner in 60% or more of their shared runs, with at least three shared runs. Two
   frames that always land on the same action are one frame with two names, and the second one
   costs a subagent every run.
2. **It is pruned in every appearance.** `adhd frames --stats`, the `pruned` column. A frame the
   critic always rejects is spending a branch to produce something the run then throws away.
   **The five-run floor exists for this criterion above all.** E1a re-ran fixture 001 at seed 2
   with an identical frame set and ACTOR_CENSUS went from holding the recommendation to pruned.
   At one or two samples a prune rate is a coin flip, not a property.
3. **It never survives to hold a recommendation.** The `rec` column at 0. Weaker than 2, and only
   counts alongside another item.
4. **Its detectors never fire on anyone else.** A frame exists to attack a trap. If the traps in
   its `attacks` list have never fired in any run, its stated reason for being in the library has
   no evidence behind it.
5. **Routing never selects it.** Never dispatched in five consecutive runs across at least two
   problem classes. A frame nothing routes to is dead weight in `config/frames.yaml` and a
   distraction when someone reads the library to understand it.

## The exemption that matters most

**A frame that is pruned every time and still produces the question nobody else asked is not a
candidate. It is doing its job.**

`SUPPLICANT` is the live example and the reason this section exists. It ran as `END_USER` in
both those runs and was renamed on 2026-09-07 (D6); the records still say the old id and are not
rewritten, so `adhd frames --stats` forwards them. Figures below are the same runs either way. It is pruned in 2 of 2
appearances, has the second-lowest mean pass A in the library at 0.69, has never held a
recommendation, and fired four detectors against itself across two runs. By criteria 2 and 3 it
looks like the clearest retirement candidate in the set.

It is also the frame that closed the `who_is_hurt` gap in `002-kernel-enduser`, and it closed it
**through the pruned block**. The critic rejected the position and the question survived anyway,
because the pruned block always ships. A rubric that scores committal, specific, foreclosing
positions will reliably reject a frame whose contribution is a question rather than an answer.
That is the rubric working, not the frame failing.

So before retiring on criteria 2 or 3, read the pruned block of every run the frame appeared in
and answer one question: **did anything reach the user through this frame that no other frame
produced?** If yes, it stays, and the finding goes in `docs/DECISIONS.md` under D6. `adhd why
<run> <frame>` prints what it needs.

## What is not evidence

- **A low mean pass A.** The rubric measures divergence value under a scale calibrated on nothing
  in particular. A frame at 0.69 against a library averaging around 0.80 is not failing at
  anything the corpus can demonstrate.
- **Fewer runs than the bar.** Five dispatched runs is the floor, not a target to reach by
  counting a frame's appearances generously. A frame in three runs has no case either way.
- **A frame you find uncomfortable to read.** `SABOTEUR` and `SUPPLICANT` are supposed to be
  annoying. That is the mechanism.
- **A frame whose output you disagree with.** Retirement is about whether the frame produces
  divergence, not whether it produces answers you like. This is the failure mode that would turn
  the library into a set of frames that agree with the owner, which is T1 with extra steps.

## What retiring means

Not deletion. Move the frame's entry to a `retired:` block in `config/frames.yaml` with the date,
the criteria it met, and the runs that showed it. The library needs to be able to say what it used
to contain and why it stopped, or the next person to notice the same gap adds the same frame back
and learns nothing.

A retired frame is not dispatched and does not count towards `n`. `adhd frames` lists it under a
separate heading. Its recorded runs stay exactly as they are: they are the evidence for the
retirement, and rewriting them would destroy the argument.

## Current standing, as of seven runs

`adhd frames --health` counts every criterion below over the recorded corpus. Read it before
this section rather than after: the table is a snapshot and the command is the current state.
The table exists because a reader needs the argument, not because it is the source of truth —
a test fails if the command puts a frame at two criteria and this table does not name it, which
is how `NIGHT_OPERATOR` got its row.

Nothing meets the bar, and one thing changed that is worth reading before the table.

**D6's orthogonality check has flagged its first pair.** `FRAME_BREAKER` and `SABOTEUR`
co-clustered in 2 of the 3 runs they shared, which is 67% against a 60% threshold with the
three-run minimum exactly met. Criterion 1 is technically satisfied.

**It is not being acted on, and the reason is E1a.** Re-running fixture 001 at seed 2 with an
identical frame set turned two of five pruned into four of five and moved `ACTOR_CENSUS` from
holding the recommendation to pruned. Cluster membership at this sample size is not stable, and
2 of 3 is one run away from 1 of 3. Acting on a threshold that a single reseed could cross in
either direction is the failure this document exists to prevent. The flag is recorded; the pair
needs shared runs in the high single digits before it means anything.

| frame | runs | why it is on the list |
|---|---|---|
| `FRAME_BREAKER` + `SABOTEUR` | 3 shared | criterion 1 met at 67%, on the minimum sample. Watch, do not act. |
| `SUPPLICANT`, `PRIOR_ART` | 2 each | pruned in every appearance. `SUPPLICANT` is exempt under the section above. `PRIOR_ART` is not yet examined and is under the floor. |
| `NIGHT_OPERATOR` | 1 | pruned in its only appearance and never held the recommendation, so criteria 2 and 3 both read as met on a single sample. One run is a coin flip and not a property; it is here so the list is complete, not because it means anything yet. |
| `DOOR_KEEPER`, `MECHANIC`, `SUCCESSOR` | 3, 3, 2 | never pruned. Not a retirement criterion, and the opposite worry, which belongs in D6. |
| `FIRST_PRINCIPLES` | 0 | never dispatched; criterion 5's count has not started. |

`FRAME_BREAKER` is the only frame at or past the five-run floor, at seven, and it meets no
criterion on its own.

### Criterion 4, spelled out against the current library



`T5` is the only detector that has never fired. One frame lists it:

| frame | attacks | fired ever | runs | note |
|---|---|---|---|---|
| `MINIMALIST` | `[T4, T5, T1]` | T4 and T1 yes, T5 never | 3 | Two of its three traps fire. Criterion 4 asks whether *the* traps have never fired, not one of them, so it does not apply. |

`MECHANIC` was the one frame fully meeting criterion 4, on the strength of T3 never having
fired. **T3 fired in E1b**, on `PRIOR_ART`, the first time any frame reached
`adhd-branch-search` with real web tools. The trap was never dead weight; no frame that could
trigger it had been given the tools to. That is the general lesson for criterion 4: a detector
with no evidence may be untriggered rather than useless, and the way to tell is to run the
frames that attack it under the conditions they need.

No frame now meets criterion 4. `MECHANIC` did until E1b, when T3 fired for the first time on
`PRIOR_ART` — the first run in which any frame was dispatched to `adhd-branch-search` with web
tools. A detector with no evidence may be untriggered rather than useless, and the way to tell
is to run the frames that attack it under the conditions they need. T5 is the remaining case.

`T5` is close to structurally unable to fire, because the output contract demands a committal
position. A trap that cannot fire is a trap-definition problem, not a frame problem, and counting
it against `MINIMALIST` would retire a frame for a flaw in `docs/TRAPS.md`. It is recorded there
instead.
