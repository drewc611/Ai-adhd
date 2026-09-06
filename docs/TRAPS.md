# Trap taxonomy

A trap is an answer that passes a quality bar and forecloses the real question. Traps are
not wrong. That is what makes them dangerous: every conventional rubric scores them well.
The critic needs a separate detector for each one.

Each trap below has a **detector** the critic can actually run. A trap without a mechanical
detector is a vibe, and vibes do not survive contact with a scoring pass.

Detector records are structured. For every branch and every trap the critic emits:

```yaml
trap: T1
fired: true | false
evidence: <the specific text or absence that triggered the verdict>
```

The scorer rejects a pass B result with any (branch, trap) pair missing. Some traps also
have a code side lint, noted below, that runs before the critic and attaches a `lint` hint
to the branch. Lints flag. The critic confirms or overrules with evidence.

---

## T1. Consensus trap

The answer any competent practitioner gives in 30 seconds. Correct, conventional, and it
never touches the decision that was actually in front of the asker.

*Detector:* delete the three most specific details from the prompt. Would this answer change?
If no, T1.

*Example:* "15s first token, 30s inter token, 90s absolute, one retry." True for every HTTP
client that has ever existed. Therefore it answered nothing about this one.

---

## T2. Frame trap

Answers inside the frame the prompt handed it and never asks whether the frame is right.

*Detector:* name the load bearing assumption in the question. Did any branch attack it?
If zero branches attacked it, T2 across the whole run, not just one branch.

*Example:* "wait, then retry" was accepted as the shape of the solution. Nobody asked why
you would retry against the same instance that just stalled, or whether the right move is
to fail over, degrade, or return partial output.

---

## T3. Citation trap

An authority reference stands in for the argument. The source is real, the reasoning was
skipped.

*Detector:* remove every citation. Does a chain of reasoning remain? If the paragraph
collapses, T3.

*Code lint:* strip sentences matching citation patterns (`ch.`, `et al`, `RFC \d+`, URLs,
`Book`, `paper`, `study`). If fewer than 40 words of `reasoning` remain, hint T3.

*Example:* "Google SRE Book ch. 22" cited, and Google's own numbers were derived for a
service profile that may share nothing with yours.

---

## T4. Completeness trap

Covers every case and therefore commits to none. Reads thorough. Is unactionable.

*Detector:* count the decisions the answer forces the reader to stop making. Zero means T4.

*Code lint:* `forecloses` is empty or every entry is under four words. Contract violation,
pruned without a critic.

---

## T5. Symmetry trap

Presents balanced options with no verdict, returning the decision to the asker who asked
precisely because they could not make it.

*Detector:* is there a sentence of the form "do X"? No such sentence, T5.

*Code lint:* `position` contains a hedge (`it depends`, `either`, `consider`, `could`,
`might`, `on the other hand`, `or` joining two full clauses) and no imperative. Hint T5.

---

## T6. Actor omission trap

A party who can act on the system was never modelled.

*Detector:* enumerate every actor who can change the outcome. Human user, operator, caller,
upstream service, attacker, scheduler, finance. Which were named?

*Code lint (run level):* `missing_actor` is null in every branch. Hint T6 on the run.

*Example:* the user watching a spinner can hit cancel. No timeout answer that ignores the
cancel path is complete, because the human is a faster and cheaper controller than any of
the three timers.

---

## T7. Reversibility blindness

Treats a one way door and a two way door as the same class of decision.

*Detector:* for each recommendation, what is the cost of being wrong and how long until you
find out? If the answer never distinguishes cheap reversible bets from expensive committed
ones, T7.

---

## T8. Novelty trap

The counterweight. An answer that survived because it was interesting rather than because it
was right. Divergent systems have a structural bias toward this, so ADHD names it explicitly
and scores against it.

*Detector:* strip the framing. Restate the position in flat language. Is it still worth
saying? If the appeal was in the angle rather than the claim, T8.

---

## Run level traps

Two failures apply to the run, not to a branch:

- **Monoculture.** All N branches landed in the same basin. Either the frames were not
  orthogonal or the orchestrator leaked an anchor. Re run with a different frame set and
  audit the orchestrator output for candidate answers. Threshold: a single cluster holding
  `monoculture_fraction` (0.8) or more of the branches. See `config/critic-rubric.yaml`.
- **Scatter.** No two branches share any ground. Usually means the problem statement was
  underspecified rather than hard. Return the ambiguity to the asker instead of a synthesis.
  Threshold: N of 3 or more and no cluster of size 2.
