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

`END_USER` is the live example and the reason this section exists. It is pruned in 2 of 2
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
- **A frame you find uncomfortable to read.** `SABOTEUR` and `END_USER` are supposed to be
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

## Current standing, as of five runs

Nothing meets the bar. Every frame in the library is under the five-run floor except
`FRAME_BREAKER`, which is at five and meets none of the criteria.

Worth watching, none actionable:

| frame | runs | why it is on the list |
|---|---|---|
| `END_USER` | 2 | pruned 2/2, rec 0. Exempt under the section above until the pruned-block reading says otherwise. |
| `DOOR_KEEPER`, `HORIZON`, `MECHANIC` | 2 each | never pruned. Not a retirement criterion, and the opposite worry: a frame the critic never rejects may not be diverging from consensus at all. That belongs in D6, not here. |
| `FIRST_PRINCIPLES` | 0 | never dispatched. Criterion 5 needs five consecutive runs across two classes; it has had none, so the count has not started. |

### Criterion 4, spelled out against the current library

`T3` and `T5` have never fired in any run. Three frames list them:

| frame | attacks | fired ever | runs | note |
|---|---|---|---|---|
| `MECHANIC` | `[T3]` | never | 2 | Its **only** stated reason for being in the library has no evidence behind it, and it has also never been pruned. Two soft signals, both under the five-run floor. |
| `FIRST_PRINCIPLES` | `[T3, T1]` | T1 yes, T3 never | 0 | Never dispatched, so nothing to say. |
| `MINIMALIST` | `[T4, T5, T1]` | T4 and T1 yes, T5 never | 2 | Two of its three traps fire. Criterion 4 asks whether *the* traps have never fired, not one of them. |

`MECHANIC` is the only frame where criterion 4 is fully met, and it is at 2 runs against a floor
of 5. Do not act on it. What it does mean is that the next time `MECHANIC` is dispatched, the
thing to read is whether it caught anything T3 describes.

`T5` is close to structurally unable to fire, because the output contract demands a committal
position. A trap that cannot fire is a trap-definition problem, not a frame problem, and counting
it against `MINIMALIST` would retire a frame for a flaw in `docs/TRAPS.md`. It is recorded there
instead.
