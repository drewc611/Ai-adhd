2026-09-16 — HEAD 6810782e3a824277d3d6cbfd66aaf11427fd3c88

## Available skills listing (verbatim, adhd/superagent entries only)

````
- adhd: Run ADHD (Anchoring Defeat by Heterogeneous Divergence) on a design decision, fuzzy debugging question, naming choice, API surface, or strategy question. Spawns N isolated subagents under distorted frames, scores blind, prunes traps, deepens survivors. Use when the search space is the problem. Do not use for factual lookup, mechanical refactors, or anything with one correct answer.
- adhd-worker: Act as a worker for the ADHD kernel. Claims leased tasks from the kernel (via the adhd MCP tools or `adhd os`), spawns the named isolated subagent with the brief as its entire prompt, returns the final message, and repeats until nothing is claimable. Use when runs have been submitted to the kernel and need inference supplied. Never reasons about the problem.
- superagent: Drive a SuperAgent mission - work that takes minutes to hours across research, divergent decision, build, verify, create and review stages, with a sandbox, memory, and a message gateway. Use when a task is too large for one pass and needs to survive being interrupted. Do not use for a single question, a single edit, or anything you can finish in one reply; use /adhd for a decision that needs divergence but no building.
````

## Present?

- adhd — yes, listed as `adhd`
- adhd-worker — yes, listed as `adhd-worker`
- superagent — yes, listed as `superagent`

Agent types: `adhd-branch` and `adhd-critic` both appear in this session's available-agents listing (alongside `adhd-branch-search`, `adhd-deepen`, `adhd-builder`, `adhd-maker`, `adhd-researcher`, `adhd-reviewer`, `adhd-verifier`).

## Reading

All three skills are reachable in this session, loaded at startup with unprefixed names and no plugin prefix. The `adhd-branch` and `adhd-critic` agent types are reachable too, so a run has both its skill entry point and its subagent types available. The listing alone does not prove which source served them, only that they resolved; the plugin was not the source of any prefixed entry, since none of the three carries a `plugin:skill` prefix. Nothing about this listing was read from disk.
