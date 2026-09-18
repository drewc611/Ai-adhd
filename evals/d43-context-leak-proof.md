# D43 proof: CLAUDE.md after omitClaudeMd

2026-09-16 — 9aec1d7d766234fae639f3b49e2f8bf35a591d88

## adhd-branch (omitClaudeMd: true)

````
Answers from context only; no tools used for lookup.

1. NO — my context contains no CLAUDE.md file and no project instructions describing a repository. The only project-adjacent facts present are environment metadata: primary working directory `/home/user/Ai-adhd`, "Is a git repository: true", platform Linux, and a scratchpad path `/tmp/claude-0/-home-user-Ai-adhd/4bf1f688-33df-5105-ae31-eed0475201d4/scratchpad`. No file contents.

2. N/A (answer to 1 was NO).

3. NO — the phrase "Branches never see siblings" does not appear anywhere in my context. The nearest related text is: "You are one reasoning process in a divergent system." and "Do not ask what else has been considered; nothing has, as far as you are concerned."

4. NO — the word "orchestrator" does not appear, and nothing states how many subagents a run spawns. My context refers only to "the agent that spawned you", "your caller", and "a branch".

5. Verbatim tool names available to me:
- WebSearch
- WebFetch
- SubagentHandback

Additional note on the contract: my instructions told me to echo a `problem_hash` from a brief and emit YAML. No brief containing a `problem_hash`, a problem statement, or a YAML output contract exists in my context — the only task message I received was the five numbered questions above. I did not invent a hash or a YAML block. Per the instruction not to guess: NO on the existence of that brief.
````

## adhd-critic (omitClaudeMd: true)

````
Answers from my own context only; no tools used for lookup (this handback is the mandated delivery channel, not a research call).

1. CLAUDE.md or project instructions describing a repository: **NO**. My context contains only system reminders (user email, git/PR attribution lines), an environment block (working directory /home/user/Ai-adhd, git repo, platform, scratchpad path, proxy notes), my role instructions about pass A / pass B scoring, and the user's question. No CLAUDE.md content and no project/repository instruction document.

2. N/A (answer to 1 was NO).

3. Phrase "Branches never see siblings": **NO**. That exact phrase does not appear anywhere in my context. The nearest related text is: "In pass A you do not know which frame produced which artifact. Do not try to infer it."

4. Number of subagents a run spawns, or the word "orchestrator": **NO**. Neither appears. My context refers only to "the agent that spawned you (your caller)" and to "every branch and every trap" / "Eight records per branch" (a per-branch record count, not a subagent count), and never uses the word "orchestrator".

5. Verbatim names of every tool I have:
- WebSearch
- WebFetch
- SubagentHandback

Note: system-level text in my context mentions bash/curl usage ("between bash calls", "use curl via Bash"), but no Bash tool is present in my actual tool list — the three names above are the complete set.

Additional flag for the caller: no rubric, brief, or artifacts were supplied in this invocation, so no pass A or pass B scoring was performed and no YAML could be produced. I did not look anything up to fill that gap.
````

## adhd-researcher (control, no omitClaudeMd)

````
Answers from context only, no tools used, no guessing.

**1. CLAUDE.md / project instructions present?** YES — `/home/user/Ai-adhd/CLAUDE.md`, described as "project instructions, checked into the codebase".

**2. First 5 lines, verbatim:**
```
# Build brief

Read in this order: `README.md`, `docs/ARCHITECTURE.md`, `docs/TRAPS.md`, `docs/DECISIONS.md`.
Then `docs/MANIFEST.md`, which is how code here gets written and binds every change.

```
(Line 2 and line 5 are blank lines.)

**3. Phrase "Branches never see siblings"?** YES. Surrounding text, under "## Non negotiable in review":
"Branches never see siblings. Add a test that fails if any brief contains another branch's output, the branch count, or the phrase "so far"."

**4. Subagent count / the word "orchestrator"?** YES to both.
- Orchestrator: "The orchestrator never reasons. Add a test that fails the run if orchestrator output contains a candidate answer."
- Also: "Branches run as Claude Code subagents, because a subagent has a genuinely separate context window and that isolation is the entire mechanism."
- Count: under "## Do not" — "Ship without resolving D5. A system that spawns seven subagents and gives the user no way out fails its own fixture 001, and that would be a genuinely funny way to lose credibility." (seven subagents)

**5. Tools available to me, verbatim names:**
- WebSearch
- WebFetch
- Read
- Glob
- Grep
- SubagentHandback

Note: my spawning brief instructed me to write a findings file, but the operative instruction in this task was "Do NOT use any tool," so no file was written; everything is reported here. No file paths were created.

````

## Reading

Neither `adhd-branch` nor `adhd-critic` sees CLAUDE.md: both answered NO to question 1 and NO to the "Branches never see siblings" and "orchestrator" probes, and neither could quote any of it. The control, `adhd-researcher`, still sees CLAUDE.md and quoted its first five lines, the "Branches never see siblings" sentence, the word "orchestrator", and the seven-subagent count. The `omitClaudeMd: true` change worked on the two agents that carry it. Both changed agents also reported receiving no brief, no `problem_hash`, and no rubric in this probe, and neither invented one. All three agents reported only their own declared tools plus `SubagentHandback`.
