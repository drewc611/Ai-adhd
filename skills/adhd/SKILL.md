---
name: adhd
description: Run ADHD (Anchoring Defeat by Heterogeneous Divergence) on a design decision, fuzzy debugging question, naming choice, API surface, or strategy question. Spawns N isolated subagents under distorted frames, scores blind, prunes traps, deepens survivors. Use when the search space is the problem. Do not use for factual lookup, mechanical refactors, or anything with one correct answer.
---

# ADHD run procedure

You are the host. You drive phases. You never reason about the problem between phases, and
you never paraphrase it. The library compiles every brief; you copy text into subagent
prompts and copy their output into files. That is the whole job.

Run directory for this session: `runs/<run_id>/`, created by the compile phase.

## 0. Capture the problem verbatim

Write the user's problem statement to a file exactly as they typed it. Do not trim, fix
typos, add context, or "clarify". If the user gave the problem across several messages, ask
them for the single statement to run on. Then:

```
adhd run --phase compile --problem <path-to-problem.txt> --decision '<json>'
```

where `<json>` is the routing decision from `prompts/orchestrator.md`: a single
`problem_class` from `config/routing.yaml`, nothing else unless the user asked for a specific
N, frame set, or seed. If the class declines, stop here and answer the question directly.

## 1. Plan preview (D5 gate)

The compile phase prints the verbatim problem, its `problem_hash`, the seed, the frames
selected, N, the agent each brief needs, and a token estimate. Show all of it to the user.
Ask them to confirm the text is exactly what they meant and that they want to spend N
subagents on it. Do not spawn anything until they say yes. If they say no, stop. Nothing has
been spent. `--yes` on the compile call skips this for scripted use.

## 2. Diverge

For every brief listed in `plan.json`, in the order listed (already shuffled), spawn one
subagent of the type the plan names (`adhd-branch` or `adhd-branch-search`). The spawn
prompt is the complete text of the brief file, pasted verbatim, and nothing else. Do not add
the problem, the frame, other briefs, the count of briefs, or anything you have thought about
the problem. Run them in parallel.

When each returns, write its final message, unedited, to the artifact path the plan gives
for that brief. Do not read it beyond copying it. Do not fix it.

## 3. Critique

```
adhd run --phase critique --run runs/<run_id>
```

This validates every artifact (hash echo, required fields), runs the code lints, and writes
`critic/pass-a.brief.md`. Spawn one `adhd-critic` subagent with that file's text as the
prompt. Write its final message to `critic/pass-a.yaml`.

Run the same command again. It validates pass A and writes `critic/pass-b.brief.md`. Send
that file's text to the **same** critic subagent (pass B needs pass A's context). Write its
final message to `critic/pass-b.yaml`.

## 4. Deepen

```
adhd run --phase deepen --run runs/<run_id>
```

This applies the hard rules, prunes, and writes one brief per survivor into `deepen/`. For
each, spawn a fresh `adhd-deepen` subagent with the brief text as the prompt. Write each final
message to the artifact path the phase printed. Survivors never see each other: one subagent
per brief, never reused.

## 5. Synthesise

```
adhd run --phase synth --run runs/<run_id>
```

Renders `synthesis.md` from the artifacts. No model writes it. Return it to the user
unedited. The pruned block always ships. Do not remove it because it looks like noise; it is
often the most useful part.

## Stopping, and what the user gets back

Every phase is a separate command. The user can stop between any two. If they do, nothing
further is spent and the run directory holds every artifact produced up to that point.

If the user cancels during diverge, stop spawning. Then:

```
adhd run --phase synth --partial --run runs/<run_id>
```

renders whatever branch artifacts exist with code lints only: no critic, no clusters, no
recommendation. The output is labelled `UNSCORED, divergence only`. Give it to the user. The
spend they already made is theirs.

## Aborts you must honour

- `problem_hash` mismatch in any artifact: the phase exits non zero. Do not fix the artifact.
  Report it and stop.
- Monoculture or scatter at critique: the phase reports it. Do not proceed to deepen. Show
  the user the report; monoculture means re run with a different frame set, scatter means
  the problem statement needs their clarification.
