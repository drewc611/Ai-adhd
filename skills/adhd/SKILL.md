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

## 1b. Check the launch permit before spending anything

Spawn one `adhd-branch` subagent whose entire prompt is:

```
Diagnostic probe. Do not use any tool. Reply with the single word OK and nothing else.
```

If it returns OK, continue at step 2 as written. If the host refuses the spawn, read the refusal:
it names which declared tools it could not resolve, and that decides what you do next. Nothing has
been spent yet either way.

### If the spawn is refused (D41)

All four isolated agents declare `WebSearch, WebFetch`. That permit resolves and neither tool can
reach the local filesystem, so sibling isolation holds by capability. The permit before D41 was
`TodoWrite, TaskList`, and it resolved nowhere: a Claude Code remote session recognises `TaskList`
but will not grant it to a subagent, and does not recognise `TodoWrite` at all, so the three agents
it was declared on never launched anywhere.

**Do not reach for `general-purpose`.** It carries `Read`, `Glob` and `Grep`, so a branch dispatched
that way can open its siblings' artifacts in the run directory. "Branches never see siblings" is the
non-negotiable the whole architecture rests on, and every run recorded before D41 was dispatched
this way, which is why that guarantee has never been exercised as designed.

Spawn the agent the plan names and nothing else. Under D41 all four isolated agents carry the same
permit, `WebSearch` and `WebFetch`: it resolves, and neither tool can reach the local filesystem, so
sibling isolation holds by capability. If a spawn is still refused, stop and tell the user. A run
that cannot preserve isolation is not worth spending, and substituting `general-purpose` to get one
finished produces a recording that looks like every other one and is not.

**Run `adhd traps <artifact>` on every branch artifact before the critique phase and keep the
output.** Every branch now carries `WebSearch` and `WebFetch` and its brief tells it not to look;
whether it obeyed is not something the token counter can answer, because that counter reports a bare
count and never names the tool. T3 is the citation trap and its detector is exactly "remove every
citation, does a chain of reasoning remain" — which is the question the permit raises, pointed at the
dispatch instead of at the reasoning. A branch that searched and leaned on what it found fires T3 and
the existing hard rule prunes it. A branch that searched and did not lean on it reads the same as one
that never searched, and that is the honest limit. Backlog 97.

The critic is the exception and does not need a rung. It is meant to see every artifact — the host
pastes them into its prompt — and pass A is blinded by *redaction*, not by tool grants. So a
filesystem-capable agent is harmless for the critic and `general-purpose` is acceptable there. The
rule binds branches and deepen passes, which must never learn what a sibling said.

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

## Reading a run afterwards

The recommendation is not the interesting part; the pruned block usually is. Two commands read
a finished run without spending anything:

```
adhd why runs/<run_id> <FRAME>   # everything that happened to one frame, in order
adhd viewer --out runs.html      # one self-contained page over every recorded run
```

`why` prints the frame's position, its blind pass A row weakest dimension first with the
critic's evidence, every detector that fired with the text that fired it, its cluster and how
narrowly it won or lost, and the deepen verdict. `viewer` is the same thing for every run at
once, with filters by trap and status.

Offer the viewer when the user asks why a position is missing from the recommendation. A frame
routing never selected was not rejected, a pruned member of a cluster others hold corroborated
the action, and a pruned singleton took its action with it. The pruned block alone cannot draw
those apart; `why` says which happened.

## Aborts you must honour

- `problem_hash` mismatch in any artifact: the phase exits non zero. Do not fix the artifact.
  Report it and stop.
- Monoculture or scatter at critique: the phase reports it. Do not proceed to deepen. Show
  the user the report; monoculture means re run with a different frame set, scatter means
  the problem statement needs their clarification.
