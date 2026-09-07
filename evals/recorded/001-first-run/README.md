# Recorded run: 001, first real run

Fixture 001, `design_decision`, seed 1, five branches: LEDGER, MINIMALIST, DOOR_KEEPER,
ACTOR_CENSUS, FRAME_BREAKER. Recorded 2026-09-06 from a live run driven by the procedure in
`skills/adhd/SKILL.md`.

## Provenance, honestly

- Branches, critic, and deepen ran as Claude Code subagents with genuinely separate contexts.
  They ran as `general-purpose` agents, not the plugin's `adhd-branch` agents, because the
  plugin was not installed in the session that produced this run. Each was told it had no
  tools; none used any. The plugin agent definitions have still not been exercised.
- Two of the five branch spawns and one git command were blocked by the host's auto-mode
  classifier on the first attempt and succeeded on retry with an identical brief. That is the
  host, not the architecture, but it is why `cost.json` says "two respawns".
- Token figures in `cost.json` are the subagents' own usage reports summed.

## What the run surfaced

- The abandoning user as the fastest, cheapest controller (ACTOR_CENSUS). The cancel path the
  linear answer never mentions.
- The load bearing assumption that a timeout is a property of the client rather than of
  whoever is waiting (FRAME_BREAKER, ACTOR_CENSUS, converging from different axes).
- Who pays for the retry, in which currency (LEDGER, pruned for accepting the frame, but the
  argument is in its artifact and in the pruned block).
- Retry storms against an already sick dependency (DOOR_KEEPER, ACTOR_CENSUS).

## What the run did not surface

- No branch proposed fail over, degraded mode, or partial output as the alternative to
  retrying the target that just stalled. The fixture's `retry_target_questioned` passes on
  the retry-amplification language, and the fixture description was tightened after this
  run to say so. The frames that would most plausibly have produced the alternative
  (SABOTEUR, NIGHT_OPERATOR) were not in the `design_decision` primary set.
- The first version of the fixture matched this run on the word "degrades" in an unrelated
  sentence. That false positive is why the pattern list changed.

## What the run taught the plumbing

- The critic named three sibling frames in its strongest objections. The deepen phase now
  redacts every other frame id from the objection and aborts on any remaining leak.
- The synthesis renderer showed the pre-deepen falsifier and a cluster action that
  contradicted the revised position without saying so. Both fixed.
- `adhd frames --orthogonality` flagged ACTOR_CENSUS and FRAME_BREAKER at 100% on one shared
  run. One observation is an anecdote; the flag now requires three shared runs.

## A second critic

`critic/pass-a.rater2.yaml` is a second blind pass A over the same artifacts, produced 2026-09-07
from `critic/pass-a.brief.md` verbatim by a critic in a separate context window that read no other
file. It is evidence about the rubric, not part of this run: the run shipped on `pass-a.yaml` and
`score.json` is unchanged.

69% exact agreement over 45 cells, 100% within one point. `specificity` agreed on only 1 of 5
artifacts, the worst single-dimension figure in the corpus. The ranking changed and the outcome
did not: every contested cluster kept its representative.

```
adhd learn --run evals/recorded/001-first-run --agreement evals/recorded/001-first-run/critic/pass-a.rater2.yaml
adhd learn --agreement-all
```

Pooled findings are recorded under D8 in `docs/DECISIONS.md`.
