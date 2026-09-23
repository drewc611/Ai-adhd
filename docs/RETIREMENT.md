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

## Current standing, as of 14 runs

`adhd frames --health` counts every criterion below over the recorded corpus. Read it before
this section rather than after: the table is a snapshot and the command is the current state.
The table exists because a reader needs the argument, not because it is the source of truth —
a test fails if the command puts a frame at two criteria and this table does not name it, which
is how `NIGHT_OPERATOR` got its row.

**No frame meets the bar. `LEDGER` did, briefly, and E12 is why it no longer does.** At eleven
runs `LEDGER` sat at two criteria: it co-clustered with `ACTOR_CENSUS` in 4 of 6 shared draws
(67%, over the 60% threshold) and had held the recommendation in 0 of 6 draws. Backlog 102's pair
(`001-seed3-e12-1`, `-e12-2`) are draws of `001-seed3` under backlog 99's own rule — same fixture,
same seed, same briefs — and in both of them every branch was pruned, `LEDGER` included, before it
ever reached a cluster. Two more data points where `LEDGER` did not co-cluster with anyone moved
its rate from 4/6 to 4/8 (50%), under the threshold. Criterion 3 still holds (0 of 9 draws recorded
holding the recommendation), so `LEDGER` now sits at one criterion — a pattern, not a case — the
same standing as `MINIMALIST`.

**This is the volatility the floor exists to survive, caught doing exactly what it says on the
label.** Backlog item 4 already showed criterion 1 and criterion 3 moving on a repeat of the exact
same input. E12 is a different kind of repeat — the critic's own instructions genuinely in force
for the first time — and it moved the same two statistics again, this time enough to drop a frame
below the bar rather than push one over it. Retiring on either criterion at eleven runs would have
been a decision this repository would now have to walk back.

`frames --stats` reports the mechanism directly. Five frames have a **split draw** — members of one
draw that disagreed on identical input — and all five are `001-seed3`, which is now four runs deep
(the original, the same-session repeat, and E12's pair): `FRAME_BREAKER`, `LEDGER`, `ACTOR_CENSUS`
and `MINIMALIST` pruned in some members and not others, `DOOR_KEEPER` both pruned (E12's pair) and
holding the recommendation (the original). Every frame this fixture dispatches now carries a split
draw. Any criterion read on any of them is being read across that disagreement, and the command
says so beside the counts rather than leaving it to this document.

**The exemption question has been asked of `LEDGER` and the answer is not clean.** `adhd why`
across its appearances shows a frame that reaches the user through corroboration rather than
through the recommendation line: in `014-seed1` it is a surviving member of the winning cluster
`local_flock_on_cron_line`, and its contribution — the skip counter as the instrument, the on-call
page budget as a scarce resource nobody prices — is carried into the deepen round by
`PARTICULARIST`. Criterion 3 counts who *holds* the recommendation. A frame that never holds it but
keeps corroborating the frame that does is not obviously dead weight, and criterion 3 alone cannot
tell those apart. That is a gap in the criterion, recorded here rather than resolved by acting on it.

So: recorded, watched, not acted on — and now, watched through a cycle where it briefly met the bar
and stopped again, which is the strongest argument yet for not acting on two criteria alone.

**D6's orthogonality check flags nothing now.** It flagged two pairs at eleven runs, `FRAME_BREAKER`
with `ACTOR_CENSUS` and `FRAME_BREAKER` with `SABOTEUR`, both over the 60% threshold. E12's pair
diluted `ACTOR_CENSUS`/`FRAME_BREAKER` from above the line to 4/7 (57%); `FRAME_BREAKER`/`SABOTEUR`
moved from its own flagged rate down to 2/4 (50%). Same mechanism as `LEDGER`'s criterion 1, same
two new draws.

The counts are draws, with runs beside them where the two differ. Ten draws over thirteen runs.

| frame | draws | why it is on the list |
|---|---|---|
| `LEDGER` | 6 of 9 runs | criterion 3 alone: held the recommendation 0 of 6 draws. Met criterion 1 too as recently as eleven runs; see above. |
| `FRAME_BREAKER` | 9 of 12 runs | at the five-run floor, no criterion currently met. Carries a split draw and was one half of both orthogonality pairs before E12. |
| `ACTOR_CENSUS`, `MINIMALIST` | 5 of 8 runs each | `ACTOR_CENSUS` is clear. `MINIMALIST` meets criterion 3 alone: held the recommendation 0 of 5 draws. Both carry a split draw. |
| `DOOR_KEEPER` | 5 of 8 runs | clear. No longer never-pruned — E12 pruned it twice — so it drops the D6 worry it used to carry here. Carries a split draw. |
| `PARTICULARIST`, `SABOTEUR` | 6, 5 | clear. `SABOTEUR` was one half of a flagged orthogonality pair before E12; no longer. |
| `SUPPLICANT`, `PRIOR_ART` | 2 each | pruned in every appearance. `SUPPLICANT` is exempt under the section above. `PRIOR_ART` is not yet examined and is under the floor. |
| `MECHANIC`, `NIGHT_OPERATOR` | 4, 3 | criterion 3 alone. Under the floor. `NIGHT_OPERATOR` was at two criteria at nine runs and dropped to one when it survived at `014-seed1`, which is the floor doing its job. |
| `SUCCESSOR` | 2 | never pruned in any appearance. Not a retirement criterion, and the opposite worry, which belongs in D6. |
| `FIRST_PRINCIPLES` | 0 | never dispatched across ten draws; criterion 5's count has not started. Reachable since D35 as a `strategy` primary at n=6, and it is an `enumerate_options` **alternate**, so the two wide-path runs did not reach it either. |

Seven frames now sit at or past the five-run floor. None meets two criteria.

**A separate naming problem, found by the same runs.** `adhd frames --collisions` reports that
`LEDGER` and `SUCCESSOR` are ordinary English nouns and both appeared as nouns in E10's artifacts:
`014-seed1`'s SABOTEUR wrote "logs that were not written to be a ledger" and the redactor removed
it, so the critic read "written to be a [frame]". Renaming a frame changes `frame_hash` and puts
the whole recorded corpus downstream of the change, so it is a D6 decision and is backlog 100.
It is recorded here because it is a fact about two labels in this library, not about a run.

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
