---
name: adhd
description: Run ADHD (Anchoring Defeat by Heterogeneous Divergence) on a design decision, fuzzy debugging question, naming choice, API surface, or strategy question. Spawns N isolated subagents under distorted frames, scores blind, prunes traps, deepens survivors. Use when the search space is the problem. Do not use for factual lookup, mechanical refactors, or anything with one correct answer.
---

# ADHD run procedure

You are the host. You drive phases. You never reason about the problem between phases, and
you never paraphrase it. The library compiles every brief; you copy text into files and
spawn subagents against those files. That is the whole job.

Run directory for this session: `runs/<run_id>/`, created by the compile phase.

## 0. Capture the problem verbatim

Write the user's problem statement to a file exactly as they typed it. Do not trim, fix
typos, add context, or "clarify". If the user gave the problem across several messages,
ask them for the single statement to run on. Then:

```
adhd run --phase compile --problem <path-to-problem.txt> --decision '<json>'
```

where `<json>` is the routing decision from `prompts/orchestrator.md`: a single
`problem_class` from `config/routing.yaml`, nothing else unless the user asked for a
specific N or frame set. If the class declines, stop here and answer the question directly.

## 1. Plan preview (D5 gate)

The compile phase prints the verbatim problem, its `problem_hash`, the frames selected, N,
and a token estimate. Show all of it to the user. Ask them to confirm the text is exactly
what they meant and that they want to spend N subagents on it. Do not spawn anything until
they say yes. If they say no, stop. Nothing has been spent.

## 2. Diverge

For every file in `runs/<run_id>/briefs/`, spawn one `adhd-branch` subagent with this
instruction and nothing else:

> Read `<brief path>`. Follow it exactly. Write your output to `<artifact path>`.

Do not include the problem, the frame, other briefs, the count of briefs, or anything you
have thought about the problem. Spawn them in the order the plan lists (already shuffled).
Wait for all to finish. Do not read the artifacts.

## 3. Critique

```
adhd run --phase critique --run runs/<run_id>
```

This validates every artifact (hash echo, required fields), runs the code lints, and writes
`critic/pass-a.brief.md`. Spawn one `adhd-critic` subagent:

> Read `<pass-a brief path>`. Follow it exactly. Write your output to `<pass-a artifact path>`.

When it returns, run the same command again. It validates pass A and writes
`critic/pass-b.brief.md`. Spawn the **same** critic subagent (continue it by its ID; pass B
needs pass A's context):

> Read `<pass-b brief path>`. Follow it exactly. Write your output to `<pass-b artifact path>`.

## 4. Deepen

```
adhd run --phase deepen --run runs/<run_id>
```

This applies the hard rules, prunes, and writes one brief per survivor into `deepen/`. For
each, spawn a fresh `adhd-deepen` subagent:

> Read `<deepen brief path>`. Follow it exactly. Write your output to `<deepen artifact path>`.

Survivors never see each other. One subagent per brief, no shared IDs.

## 5. Synthesise

```
adhd run --phase synth --run runs/<run_id>
```

Renders `synthesis.md` from the artifacts. No model writes it. Return it to the user
unedited. The pruned block always ships. Do not remove it because it looks like noise; it is
often the most useful part.

## Stopping

Every phase is a separate command. The user can stop between any two. If they do, nothing
further is spent and the run directory holds every artifact produced up to that point.

## Aborts you must honour

- `problem_hash` mismatch in any artifact: the phase exits non zero. Do not fix the artifact.
  Report it and stop.
- Monoculture or scatter at critique: the phase reports it. Do not proceed to deepen. Show
  the user the report; monoculture means re run with a different frame set, scatter means
  the problem statement needs their clarification.
