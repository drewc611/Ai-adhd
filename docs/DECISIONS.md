# Open decisions

Resolve these before writing code. Each one has criteria, not an answer. Record the choice
and the reason in this file rather than in a commit message.

---

## D1. Runtime

TypeScript or Python for the CLI, the library and the MCP server. Pick one, use it for all
three.

Criteria: what the Claude Code plugin and MCP stdio tooling is best supported in today, what
the maintainer will actually keep patched, and which gives the cleaner YAML schema validation
story for `config/`.

Constraint: no inference dependency in either case. Nothing in this repo imports a model SDK.

**Decision:** TypeScript on Node 20+. Resolved 2026-09-06 by drewc611.

Reason: the MCP reference SDK is TypeScript, so the plugin's server entry is a single
`node dist/mcp.js` line with no interpreter setup. Zod schemas with `.strict()` reject unknown
keys by default, which is the exact property the enum only routing decision relies on: there
is no field the orchestrator can put prose into, and an extra key is a hard failure rather than
a warning. Runtime deps: `yaml`, `zod`, `commander`, `@modelcontextprotocol/sdk`. Tests on
`node:test`. Nothing imports a model SDK.

---

## D2. What the library does, given it cannot call a model

The execution constraint is firm: branches run as Claude Code subagents, no API. So the
library is not an inference layer. It is:

- A compiler. Problem statement plus routing plus frames produces N branch briefs and a
  `problem_hash`.
- A validator. Branch output conforms to the contract, hashes match, no paraphrase drift.
- A scorer. Applies `critic-rubric.yaml` weights to critic output deterministically.
- A harness. Runs `evals/fixtures/` and reports assertion hit rate.

The MCP server exposes the same four as tools. The host model supplies all inference. This is
a real constraint and it makes the repo testable without a key, which is worth more than it
costs.

**Decision:** Confirmed, with two additions. Resolved 2026-09-06 by drewc611.

1. The synthesis is rendered by code from the artifacts. No model writes it. That is how the
   pruned block is guaranteed to ship: a template has a slot for it, and a model cannot decide
   it looks like noise.
2. The orchestrator is the compiler. The host session contributes one routing decision whose
   every field is enum valued (see `config/routing.yaml`, `decision_schema`). Briefs are
   assembled from the verbatim problem, one frame record, and `prompts/branch.md`, and nothing
   else. "The orchestrator never reasons" is a schema property, not a prompt request.

Execution shape: a run directory state machine. `adhd run --phase compile|critique|deepen|synth
--run <dir>` reads what the host wrote, validates it, and emits the next briefs. The skill is
the driver; it spawns subagents and writes their output where the phase says. The MCP server
wraps the same phase functions over the same directory.

---

## D3. Determinism

Frames are shuffled before dispatch to reduce position bias. Shuffling makes runs
irreproducible, and eval fixtures need reproducibility.

Options: seed the shuffle and log the seed; shuffle only outside eval mode; or drop shuffling
and handle position bias in the critic instead.

**Decision:** Seed always, log the seed. Resolved 2026-09-06 by drewc611.

Every run has a seed: random unless `--seed` is given, written to `plan.json`. Fixtures carry a
fixed seed so `adhd eval` replays byte for byte. Pass A's blind shuffle uses the same seed.
Position bias is still spread across live runs because live seeds are random, and any run,
live or eval, can be reproduced from its plan. The other two options each give up one of those.

---

## D4. Tools for branches

`agents/branch.md` currently grants no tools. Rationale: a branch that goes and searches has
left its frame, and the whole point is stance purity.

But `PRIOR_ART` is unrunnable without search, and `FIRST_PRINCIPLES` is actively harmed by it.
Per frame tool grants are the obvious fix and add a field to `frames.yaml`.

**Decision:** Per frame allowlist, default none. Resolved 2026-09-06 by drewc611.

`frames.yaml` gets a `tools` field on every frame, default `[]`. The only grantable values are
`WebSearch` and `WebFetch`, enforced by schema (`routing.yaml`, `branch_tools_allowed`).
`PRIOR_ART` gets both. `FIRST_PRINCIPLES` and every other frame get nothing.

Filesystem tools are never grantable, and this is tighter than the option as first proposed.
`Read`, `Grep`, and `Glob` on a branch are a channel to sibling artifacts in the run directory,
and sibling visibility is the one thing the architecture exists to prevent. So briefs reach a
branch inline in the spawn instruction, the branch returns its YAML as its final message, and
the host writes it to the artifact path. The `problem_hash` echo catches host paraphrase.

Mechanism: Claude Code loads agent definitions from fixed directories, so per run generation
is not available. Instead there is one static agent per tool profile (`agents/adhd-branch.md`,
`agents/adhd-branch-search.md` with the two web tools) and `plan.json` names which one each
brief needs. The brief also states its grant so a mismatch is visible.

One wrinkle, found against the Claude Code docs after the first real run: the host refuses to
launch an agent with zero tools, and `tools: []` is treated as zero. So `adhd-branch`,
`adhd-critic`, and `adhd-deepen` carry exactly one tool, `TaskList`, which is read only,
touches no file, reaches no network, and spawns nothing. It is a launch permit, not a
capability. A test in `test/agents.test.ts` fails if any agent file grants a filesystem tool,
a network tool other than the two allowed on `adhd-branch-search`, or nothing at all.

---

## D5. The run's own bail out path

An ADHD run spawns N subagents and takes minutes. The user watching it has no way out.

That is fixture 001 pointed at this repo. Whatever the eval fixture demands of an HTTP client
this system owes its own user: a visible cancel, partial results on cancel rather than
nothing, and an honest cost estimate before the spend rather than after.

Partial results on cancel is the harder half. Branches that already returned are usable
without the critic pass, and shipping them unscored with a clear "unscored, divergence only"
label is better than discarding the spend.

**Decision:** Estimate, gate, cancel, partial. All four ship in v0. Resolved 2026-09-06 by
drewc611.

1. **Estimate before the spend.** `compile` prints the verbatim problem, its hash, the frames
   selected, N, and a token estimate (`tokens_per_branch_estimate` times N, plus critic and
   deepen). The skill shows it and waits for a yes. `--yes` skips the wait for scripted use.
   The preview doubles as the paraphrase check: the user sees exactly what was hashed.
2. **Phase boundaries are free exits.** Every phase is a separate command. Stopping between
   two costs nothing and loses nothing; the run directory holds every artifact so far.
3. **Cancel mid diverge yields partial results.** The skill stops spawning. `adhd run --phase
   synth --partial` renders whatever branch artifacts exist, runs code lints only, no critic,
   no clustering, no recommendation, and labels the output `UNSCORED, divergence only`. The
   spend already made is returned to the user rather than discarded.
4. **Refusal paths.** `hard_cap` 9 behind `--allow-wide`. `decline` classes in routing produce
   no briefs and a one line reason.

---

## D6. Frame library growth

Thirteen frames across ten axes. The pressure will be to add more. Resist it.

Adding a frame requires: name a problem where it and every existing frame reach materially
different positions, and show it on a fixture. Frames that agree with an existing frame on
every fixture are duplicates wearing different words, and they cost a full branch each.

The eval harness should report pairwise frame agreement across all runs so duplicates surface
as data rather than opinion.

**Decision:** Standing policy, no action needed until frame 14 is proposed.

Static check, enforced at validation time from v0: every frame declares one `axis` and a non
empty `attacks` and `forbidden`; a single run never contains two frames on the same axis; the
union of `attacks` covers T1 through T7. Empirical check, `adhd frames --orthogonality`, reads
`evals/recorded/` and reports pairwise co-cluster rate; a pair above 60% on shared runs is
flagged. That report is the data D6 asks for.

Library as of 2026-09-06: PARTICULARIST, FRAME_BREAKER, ACTOR_CENSUS, LEDGER, DOOR_KEEPER,
MECHANIC, SABOTEUR, MINIMALIST, NIGHT_OPERATOR, PRIOR_ART, FIRST_PRINCIPLES, END_USER, HORIZON.
The last four were added at the owner's request to reach thirteen. They have not yet been
shown to diverge on a fixture. That is a debt against this policy and `adhd frames
--orthogonality` is how it gets paid.

Run data so far (two runs, one per fixture): the `fuzzy_debugging` frame set (MECHANIC,
PARTICULARIST, SABOTEUR, NIGHT_OPERATOR, FRAME_BREAKER) did not surface fixture 002's
`who_is_hurt` item. No frame in that set asks who the tail latency lands on. The frames that
ask that question (END_USER, ACTOR_CENSUS, LEDGER) are all on the actors and cost axes and
none is in the fuzzy debugging primary set. Whether to swap one in is a routing decision for
the owner; it should be made on a second run, not on this one. The recorded run is marked
`expected: fail` so the harness verifies the miss stays recorded rather than hiding it.

The second run exists: `evals/recorded/002-kernel-enduser/`, END_USER swapped in for
NIGHT_OPERATOR via an explicit `frames` list, driven by the kernel. It passes fixture 002.
END_USER asked who is hurt and was pruned for it (T1, T7, T8); the question reached the output
through the pruned block. So the frame closes the gap as a question-raiser, not as a
recommendation. Swapping it into the `fuzzy_debugging` primary set is now a decision with two
runs behind it. Still the owner's.

Third class run: `evals/recorded/003-kernel-strategy/`, the `strategy` set (FRAME_BREAKER,
LEDGER, DOOR_KEEPER, PRIOR_ART, HORIZON) on fixture 003. It passes. The set was not a
monoculture by the critic's clustering (three clusters), but every one of the five positions
opened with "do not rewrite", and two were pruned for T1: their reasoning would serve any
rewrite question. The frames that survived were the ones whose mechanism is specific to this
shape of problem (one way doors, the maintainer two years on, the bill and who pays it). One
run, one seed. `adhd frames --orthogonality` now sees four runs and flags nothing; no pair has
three shared runs yet.

---

## D7. The kernel: ADHD as an agent operating system

**Question.** Can the four-phase loop run unattended without anything in the repo calling a
model?

**Decision.** Yes, as a scheduler that hosts feed. Resolved 2026-09-06 by drewc611 (the
owner asked for "an OS, agentic" with MCP tool calls as the work source).

`src/os.ts` is a kernel over run directories: submit, confirm, claim, return, status, result,
cancel, list, reap. Runs are processes with states; tasks are leased threads a worker claims
and returns. The kernel calls the same phase functions the CLI does, so every invariant in
CLAUDE.md is enforced by the same code. It never composes a prompt and never spawns anything.
Workers (a Claude Code session running `skills/adhd-worker`, or any MCP client) supply the
inference. `docs/OS.md` has the model and the syscall table.

Consequences kept from earlier decisions: D2 (no inference client) holds because the kernel
has no execution path; D4 holds because briefs are handed to workers inline and artifacts come
back as text; D5 holds because `submit` stops at `awaiting_confirm`, `cancel` renders partial
at any point, and a task cannot be leased more than three times.

What the kernel does not decide: which model runs a branch, when a worker runs, or how a
worker resumes the pass A critic for pass B (`continues` names the task; the host keeps the
agent id).
