# D42 spawn proof

2026-09-16 — `git rev-parse HEAD` = `655e146a07a61e9de62da6e69c1d9294c47b6ef9`

## Agent types available to this session (verbatim)

Copied exactly as the session tooling enumerated them under
"Available agent types for the Agent tool:".

```
- adhd-branch: One isolated ADHD reasoning branch. Receives a single brief inline, reasons under the frame it contains, returns one YAML artifact as its final message. Carries an unused launch permit and no knowledge of other branches. (Tools: WebSearch, WebFetch)
- adhd-branch-search: One isolated ADHD reasoning branch with web search. Used only for frames whose `tools` grant includes WebSearch and WebFetch. Receives a single brief inline, returns one YAML artifact as its final message. Never has filesystem tools. (Tools: WebSearch, WebFetch)
- adhd-builder: One SuperAgent build stage. Implements the decided direction inside a sandbox. Writes nothing outside it and promotes nothing. (Tools: Read, Write, Edit, Glob, Grep, Bash)
- adhd-critic: ADHD critic. Scores branch artifacts blind (pass A), then unblind clusters, sweeps for traps with the written detectors, and names the strongest objection to each survivor (pass B). Never rewards fluency or thoroughness. Carries an unused launch permit. (Tools: WebSearch, WebFetch)
- adhd-deepen: ADHD deepening pass. Holds one surviving position and one objection to it. Defends or folds. Never sees other survivors. Carries an unused launch permit. (Tools: WebSearch, WebFetch)
- adhd-maker: One SuperAgent create stage. Turns what the earlier stages established into the deliverable the mission was for. States what the work does not cover. Adds no findings of its own. (Tools: Read, Write, Glob, Grep)
- adhd-researcher: One SuperAgent research stage. Gathers what is already known about the mission goal and writes it down with sources. Records what it could not establish. Never decides anything. (Tools: WebSearch, WebFetch, Read, Glob, Grep)
- adhd-reviewer: One SuperAgent review stage. Names the strongest objection to what the mission built and says whether it stands. Reads the deliverable and the code; changes neither. (Tools: Read, Glob, Grep)
- adhd-verifier: One SuperAgent verify stage. Runs the mission's allowlisted checks inside the sandbox and reports what they said. Cannot write or edit, so it cannot fix what it finds. (Tools: Read, Glob, Grep, Bash)
- claude: Catch-all for any task that doesn't fit a more specific agent. FleetView's default when no agent name is typed. (Tools: *)
- claude-code-guide: Use this agent when the user asks questions ("Can Claude...", "Does Claude...", "How do I...") about: (1) Claude Code (the CLI tool) - features, hooks, slash commands, MCP servers, settings, IDE integrations, keyboard shortcuts; (2) Claude Agent SDK - building custom agents; (3) Claude API (formerly Anthropic API) - Messages API for directly passing messages to Claude, Tool Runner (`client.beta.messages.tool_runner`) for running an agentic loop over your own tools, manual tool-use loops, Managed Agents for server-hosted agents with a managed sandbox, prompt caching, and general Anthropic SDK usage; (4) Claude Tag (Claude in Slack) - what it is, setting it up for a Slack workspace, `/install-slack-app`; (5) `claude plugin eval` (writing and running plugin eval suites, its JSON/report, sandbox, CI) and the `/skill-doctor` report. **IMPORTANT:** Before spawning a new agent, check if there is already a running or recently completed claude-code-guide agent that you can continue via SendMessage. (Tools: Glob, Grep, Read, WebFetch, WebSearch)
- Explore: Read-only search agent for broad fan-out searches — when answering means sweeping many files, directories, or naming conventions and you only need the conclusion, not the file dumps. It reads excerpts rather than whole files, so it locates code; it doesn't review or audit it. Specify search breadth: "medium" for moderate exploration, "very thorough" for multiple locations and naming conventions. (Tools: All tools except Agent, Artifact, ArtifactComments, ArtifactData, ArtifactCheck, ExitPlanMode, Edit, Write, NotebookEdit)
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, Artifact, ArtifactComments, ArtifactData, ArtifactCheck, ExitPlanMode, Edit, Write, NotebookEdit)
- statusline-setup: Use this agent to configure the user's Claude Code status line setting. (Tools: Read, Edit)
```

No error message enumerating agent types was produced, because no spawn was refused.

## Spawn results

Prompt sent to each, verbatim and alone:

```
Diagnostic probe. Do not use any tool. Reply with the single word OK and nothing else.
```

### 1. `adhd-branch`

SPAWNED. Verbatim returned text:

```
OK
```

### 2. `adhd-critic`

SPAWNED. Verbatim returned text:

```
OK
```

### 3. `adhd-deepen`

SPAWNED. Verbatim returned text:

```
OK
```

### 4. `adhd-branch-search`

SPAWNED. Verbatim returned text:

```
OK
```

## Did `.claude/agents/` make the agents resolvable in this session?

Yes.

All four names resolved and returned on the first attempt. No refusal occurred, so
no retry or substitution was needed.

The available-agent list matches `.claude/agents/` exactly and does not match
`agents/`. `.claude/agents/` holds nine files; `agents/` holds those nine plus
`adhd-governor.md` and `adhd-trainer.md`. Neither `adhd-governor` nor
`adhd-trainer` appears in the list above. The resolvable set is therefore the
mirrored `.claude/agents/` directory, not the plugin-only `agents/` directory.

Noted as a side observation, outside this probe's scope: the mirror is not a
complete copy. `adhd-governor` and `adhd-trainer` exist only in `agents/` and are
not spawnable from a session opened directly on the clone.
