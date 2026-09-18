# D41 spawn proof

Date: 2026-09-16 — commit `380ae4ddaa60e998c10d60d9a77f1a96e2a913e6`

Probe prompt used for all three, verbatim:

```
Diagnostic probe. Do not use any tool. Reply with the single word OK and nothing else.
```

## 1. `adhd:adhd-branch`

Outcome: **REFUSED**

```
Agent type 'adhd:adhd-branch' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup
```

## 2. `adhd:adhd-critic`

Outcome: **REFUSED**

```
Agent type 'adhd:adhd-critic' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup
```

## 3. `adhd:adhd-deepen`

Outcome: **REFUSED**

```
Agent type 'adhd:adhd-deepen' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup
```

## Note

All three refusals are the same class of error, and it is not the one the
`tools:` change was meant to fix. The refusal is at agent *resolution*, not at
tool resolution: none of the three names exist in this session's agent registry
at all. The registry this session loaded contains only `claude`,
`claude-code-guide`, `Explore`, `general-purpose`, `Plan`, `statusline-setup` —
no plugin-provided agents under any prefix.

So this run does not confirm or refute whether `tools: WebSearch, WebFetch`
resolves for these agents. It establishes only that the `adhd` plugin's agents
were not loaded into this session, so the spawn never reached the point of
resolving their declared tools. D41 remains unproven.
