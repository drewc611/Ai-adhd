# Architecture

Four phases. The value is concentrated in what each phase is forbidden from doing.

```
  prompt
    |
    v
 [1 SCATTER]   classify only, never reason
    |          emits N frame briefs + problem_hash
    |
    +---> [2 DIVERGE]  branch_1 .. branch_N
    |                  isolated context, no sibling visibility
    |                  frame label + verbatim problem + output contract
    v
 [3 CRITIQUE]  pass A: blind score, frame labels stripped
    |          pass B: unblind, cluster, trap sweep, prune
    v
 [4 DEEPEN]    survivors paired with strongest objection
    |          defend or fold
    v
  synthesis
```

## 1. Scatter

The orchestrator classifies the problem and selects frames. **It does not reason about the
problem.** This is the failure mode that kills every naive implementation: an orchestrator
that thinks out loud before fanning out injects its own anchor into all N briefs, and you
are back to tree of thought with extra steps.

Hard rules:

- Orchestrator output is a routing decision, not an analysis.
- The problem statement is passed to branches **verbatim**. Not summarised, not cleaned up,
  not "clarified". Summarising is reasoning.
- Compute `problem_hash` over the verbatim statement. Each branch echoes it back. A mismatch
  means paraphrase drift and invalidates the run.
- If the orchestrator emits any sentence containing a candidate answer, abort and re route.

How this is enforced rather than requested: the compiler accepts a routing decision object
whose every field is enum valued (see `config/routing.yaml`, `decision_schema`). There is
no free text field. The briefs are assembled from the verbatim problem, one frame record
from `config/frames.yaml`, and the template in `prompts/branch.md`, and nothing else. The
orchestrator cannot leak an anchor into a brief because the brief has no slot for it.

## 2. Diverge

Each branch subagent receives exactly three things:

1. The verbatim problem statement
2. One frame from `config/frames.yaml`
3. The output contract

Each branch receives none of these: sibling output, orchestrator commentary, the frame
names of other branches, a count of how many branches exist, or any phrase of the form
"here is what has been considered so far".

Frames are delivered in randomised order. Branch results are collected unordered.

Branches return a structured artifact, not prose:

```yaml
problem_hash: <echo>
frame: <id>
position: <one sentence, committal>
reasoning: <why, from inside the frame>
forecloses: [what this rules out]
falsifier: <what observation would prove this wrong>
missing_actor: <who can act that the prompt did not name, or null>
confidence: low | medium | high
```

`forecloses` and `falsifier` are mandatory. An answer that rules nothing out and cannot be
proven wrong is not an answer, it is a summary.

## 3. Critique

A fresh subagent. It never saw the orchestrator's framing, and during scoring it does not
know which frame produced which branch.

**Pass A, blind.** Frame labels stripped. Branches shuffled. Score each against
`config/critic-rubric.yaml`. Blind scoring exists because unblinded critics reward frames
they find interesting, which is how these systems drift toward novelty for its own sake.

**Pass B, unblind.** Labels restored. Now:

- **Cluster.** Branches that reached the same position from different frames are one finding
  with corroboration, not two findings. Convergence across orthogonal frames is the strongest
  signal ADHD produces. Report it as such.
- **Trap sweep.** Run every branch against `docs/TRAPS.md`. Flagged branches are pruned even
  at high quality scores. A consensus trap answer scores well on every conventional rubric,
  which is exactly why it needs its own detector.
- **Singleton check.** A position held by exactly one branch is either the insight or the
  hallucination. Never prune it silently. Escalate it to deepening with the flag set.

The critic is a model. The scorer is code. The critic emits structured verdicts (rubric
scores, one detector record per trap per branch, cluster assignments). The scorer validates
that every record is present, applies the weights in `config/critic-rubric.yaml`, applies the
hard rules, and refuses to proceed if any detector is missing. Some detectors also have a
code side lint that runs before the critic ever sees the artifacts (see `docs/DECISIONS.md`,
D4). Lints flag; the critic confirms. Contract violations prune without a critic.

## 4. Deepen

Survivors get one more isolated pass, adversarially paired. Each survivor is handed the
single strongest objection raised against it and must defend or fold. Folding is a valid
and reported outcome.

Deepening is isolated too. A survivor never sees the other survivors.

## Output contract

The run returns:

- **Recommendation** with the decision it forces
- **Corroborated findings**, the positions multiple orthogonal frames landed on
- **Live singletons**, kept explicitly because they are unique, marked unverified
- **Pruned with reason**, including trap classification. Do not hide the pruned set. The
  pruned set with reasons is often more useful than the recommendation.
- **What this forecloses**
- **Cost**: branches spawned, tokens, wall clock

## Run directory

Every phase reads and writes one directory so the run is inspectable and replayable:

```
runs/<run_id>/
  problem.txt              verbatim, hashed
  decision.json            the orchestrator's enum-only routing decision
  plan.json                frames selected, order shuffled, problem_hash
  briefs/<frame>.md        one per branch, compiled
  branches/<frame>.yaml    written by the host after each subagent returns
  critic/pass-a.brief.md   blind pack: letters for ids, frame field stripped
  critic/pass-a.yaml       rubric scores per letter
  critic/pass-b.brief.md   unblind pack
  critic/pass-b.yaml       clusters, detector records, prune list
  deepen/<frame>.brief.md  survivor + strongest objection
  deepen/<frame>.yaml      defend | fold
  synthesis.md             the output contract, rendered
  cost.json
```

## Cost

N branches means N times the context. At N of 5 to 7 a run is expensive and slow. That is
the trade. `max_branches` defaults to 5. Anything above 9 requires an explicit flag, because
marginal frames past that point produce restatements, not new directions.
