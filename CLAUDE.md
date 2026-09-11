# Build brief

Read in this order: `README.md`, `docs/ARCHITECTURE.md`, `docs/TRAPS.md`, `docs/DECISIONS.md`.
Then `docs/MANIFEST.md`, which is how code here gets written and binds every change.

D1 through D20 are resolved; the decisions and their evidence are in `docs/DECISIONS.md`. What is
still open is listed in `docs/BACKLOG.md`, and `docs/RETIREMENT.md` holds the bar for taking a
frame out. Resolve any new decision with the user before writing code, and record it there.

## What this is

A reasoning architecture, not a prompt template. The `config/` and `prompts/` directories are
the product. The code around them is plumbing: it compiles briefs, validates contracts, scores
deterministically, and runs evals. It never calls a model.

## Execution constraint

No API. No provider SDK. No keys anywhere in the repo. Branches run as Claude Code subagents,
because a subagent has a genuinely separate context window and that isolation is the entire
mechanism. An instruction to "ignore what you read above" is not isolation, and every in
context divergence technique is built on exactly that.

If you find yourself adding an inference client, you have misread the design. Go back to D2.

## Ships in v0

1. **Library** — compile, validate, score, eval. Pure functions over the YAML in `config/`.
2. **CLI** — `adhd run`, `adhd traps <file>`, `adhd eval`, `adhd frames`.
3. **MCP server** — the same four as stdio tools, so any MCP host can drive it.
4. **Claude Code plugin** — `.claude-plugin/plugin.json`, `skills/adhd/`, `agents/`. Already
   scaffolded, needs testing against a real run.

## Build order

1. Schema validation for the three YAML files. Everything downstream trusts them, so validate
   them first and fail loudly.
2. The compiler. Verbatim passthrough and `problem_hash` are the correctness critical parts.
   A test that catches paraphrase drift is the highest value test in the repo.
3. The eval harness against `evals/fixtures/001` and `002`. Get this running before the CLI is
   pretty. The fixtures are how you find out whether the frame library actually works.
4. The scorer.
5. CLI.
6. MCP server.

## Non negotiable in review

- The orchestrator never reasons. Add a test that fails the run if orchestrator output
  contains a candidate answer.
- Branches never see siblings. Add a test that fails if any brief contains another branch's
  output, the branch count, or the phrase "so far".
- `problem_hash` mismatch aborts the run.
- Pass A is blind. If frame labels reach the pass A scorer, that is a bug, not a convenience.
- The pruned block always ships to the user with trap ids and detector output.
- Every trap detector runs mechanically. Guessing at traps defeats the purpose of writing
  detectors down.

## Do not

- Add an inference client.
- Add frames without running D6's orthogonality check.
- Replace the critic rubric with a quality rubric. Quality rubrics reward the consensus trap,
  which is T1, which is the thing this repo exists to catch.
- Ship without resolving D5. A system that spawns seven subagents and gives the user no way
  out fails its own fixture 001, and that would be a genuinely funny way to lose credibility.
