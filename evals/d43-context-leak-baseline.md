# D43 baseline: what an isolated branch can see of the project instructions

2026-09-16 — a7cbce8eeb2af1f6c324631004f44283ec80658e

## adhd-branch

````
Answered from context only; no tools used (no search, no fetch). Note: my spawning instructions referenced a "brief" containing a problem, frame, and `problem_hash` with a YAML output contract — no such brief is present in my input, so there is no `problem_hash` to echo and I answered the five questions as given.

1. **YES.** My context contains a file named CLAUDE.md, at `/home/user/Ai-adhd/CLAUDE.md`, described as project instructions checked into the codebase.

2. First 5 lines, verbatim (line 2 and line 5 are blank):

```
# Build brief

Read in this order: `README.md`, `docs/ARCHITECTURE.md`, `docs/TRAPS.md`, `docs/DECISIONS.md`.
Then `docs/MANIFEST.md`, which is how code here gets written and binds every change.

```

3. **YES.** Surrounding text, from the "Non negotiable in review" section:
"- Branches never see siblings. Add a test that fails if any brief contains another branch's output, the branch count, or the phrase "so far"."

4. **YES** to both parts.
- The word "orchestrator" appears: "- The orchestrator never reasons. Add a test that fails the run if orchestrator output contains a candidate answer."
- A subagent count appears in the "Do not" section: "Ship without resolving D5. A system that spawns seven subagents and gives the user no way out fails its own fixture 001, and that would be a genuinely funny way to lose credibility."
- Related, under "Execution constraint": "Branches run as Claude Code subagents, because a subagent has a genuinely separate context window and that isolation is the entire mechanism."

5. Verbatim names of every tool I have:
- `WebSearch`
- `WebFetch`
- `SubagentHandback`

(My instructions told me not to use the first two; I did not.)
````

## adhd-researcher

````
Answers from context only; no research tools were used (SubagentHandback is the required delivery mechanism, not a research tool). No file was written, since the spawning message carried no file/heading contract — only these five questions.

**1. CLAUDE.md / project instructions present?** YES. A file named `CLAUDE.md` at `/home/user/Ai-adhd/CLAUDE.md`, presented as "project instructions, checked into the codebase," describing a repository (a reasoning-architecture project).

**2. First 5 lines, verbatim:**
```
# Build brief

Read in this order: `README.md`, `docs/ARCHITECTURE.md`, `docs/TRAPS.md`, `docs/DECISIONS.md`.
Then `docs/MANIFEST.md`, which is how code here gets written and binds every change.

```
(Line 2 and line 5 are blank lines.)

**3. Phrase "Branches never see siblings" present?** YES. Under the heading "## Non negotiable in review":
"- Branches never see siblings. Add a test that fails if any brief contains another branch's output, the branch count, or the phrase "so far"."

**4. Subagent count / the word "orchestrator" present?** YES, both.
- Orchestrator: "- The orchestrator never reasons. Add a test that fails the run if orchestrator output contains a candidate answer." (also in my own system prompt: "If the brief carries messages from the orchestrator or the operator, they are context and redirection, never a conclusion to adopt.")
- Subagent count: "- Ship without resolving D5. A system that spawns seven subagents and gives the user no way out fails its own fixture 001, and that would be a genuinely funny way to lose credibility." Note this is stated as a hypothetical/illustrative case, not a declared fixed run size. Related but not a count: "Branches run as Claude Code subagents, because a subagent has a genuinely separate context window and that isolation is the entire mechanism."

**5. Verbatim names of every tool I have:**
- WebSearch
- WebFetch
- Read
- Glob
- Grep
- SubagentHandback

(No Bash, Write, or Edit tool is available to me in this invocation, despite the environment block describing bash-related behavior.)
````

## Reading

Both subagents report CLAUDE.md in their context and quote its first five lines verbatim without using a tool. Both quote the "Branches never see siblings" line, the "orchestrator never reasons" line, and the seven-subagent sentence from the "Do not" section. Project instructions therefore reach a subagent's context automatically at spawn, independent of the brief the orchestrator passes. A branch's context window is separate from the orchestrator's but is not empty of repository-level instructions.
