# Writing a frame

Backlog 48. What a frame is, what makes one worth adding, and the check `CLAUDE.md` says not to skip.

A frame is a stance a branch reasons from. It is not a persona and not a topic — it is a *question the
other frames do not ask*. That is the whole test, and everything below is a way of applying it.

## The bar, before anything else

**Thirteen frames on ten axes is already thin.** Seven of the ten axes carry one frame, and because a
run never contains two frames from one axis (D6), routing has no alternative to offer on any of them.
Adding a fourteenth frame on a shared axis makes the library worse rather than larger: it gives routing
two things to choose between on an axis that was already covered, while the seven thin axes stay thin.

So the first question is not "is this a good stance" but "**which axis is it on, and is that axis
empty**". `adhd frames --axes` answers the second half.

## The checklist

1. **Name the axis.** If it is an existing one, you are proposing a *replacement*, not an addition, and
   `docs/RETIREMENT.md` is the document that governs that.
2. **Write the question it asks that no other frame asks.** One sentence. If you cannot write it
   without naming a topic ("security", "performance"), it is a topic and not a stance.
3. **Write `forbidden`.** Non-empty — a frame that forbids nothing is not a stance, it is advice. Then
   read `adhd frames --forbidden`: **35 of the 39 existing entries have no mechanical form**, so assume
   yours will not either, and write it to be read by a model rather than matched by a regex.
4. **Check the label is not ordinary prose.** `adhd frames --collisions`. Two frames have already been
   renamed for this: `END_USER` and `HORIZON` appeared in artifacts they did not produce, and the
   redactor removed real text on the way to pass A. Pick a name that appears nowhere in the recorded
   corpus.
5. **Run the orthogonality check.** `adhd frames --orthogonality`. This is the one `CLAUDE.md` lists
   under **Do not**: "Add frames without running D6's orthogonality check."
6. **Write a fixture the frame should obviously win**, then run it. Backlog 19 wants one per frame and
   has none; a new frame arriving with one is the cheapest time to write it.

## What the orthogonality check can and cannot tell you

It counts how often two frames land in the same cluster in pass B, over the runs that dispatched both.
Above 60% on at least three shared runs, it flags the pair.

**Read the sample size first.** Today the report flags exactly one pair — FRAME_BREAKER and SABOTEUR at
2 of 3 — and lists six more at 100% that it refuses to flag because they share one or two runs. A pair
at 1/1 is not a finding. The report says "too few shared runs to flag" rather than hiding them, because
the alternative is a reader who sees a clean report and concludes the library is orthogonal.

**A flag is not a verdict.** `docs/RETIREMENT.md` is explicit that co-clustering is evidence for
examination and not grounds for removal, which is also why `library.yml` runs this report as a report
and not as a gate: failing a PR on a co-clustering rate is the thing that document says not to do.

## What a frame is not

- **A topic.** "The security frame" is a subject-matter expert. Every frame reasons about security when
  the problem is about security.
- **A tone.** "The skeptical frame" is a temperature setting.
- **A second opinion.** If its output would be recognisable as an answer another frame could have
  written, it is on that frame's axis.
- **A place to put a probe.** If what you want is one more question asked inside an existing stance, add
  a probe to that frame. Backlog 17 is exactly this case and is still open for that reason: the
  `false_means` gap might be a probe on an existing frame rather than a new frame at all.

## Where the files are

`config/frames.yaml` is the library. `config/routing.yaml` decides which frames a run class dispatches.
`prompts/` holds the brief template that renders a frame into a branch's instructions. All three are
`config/`-shaped: this repository treats them as the product, not as plumbing, so a change to any of
them triggers `.github/workflows/library.yml` and its reports.
