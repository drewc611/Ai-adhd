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

### What five runs say about the library

`adhd frames --stats` reports per-frame behaviour across every recorded run. As of five runs,
twelve of thirteen frames have been dispatched at least once and the counts are already
saying three things, none of them yet a verdict:

- **END_USER is pruned every time it appears (2/2).** It is also the frame that closed the
  `who_is_hurt` gap in `002-kernel-enduser`, and it did so *through the pruned block*. A frame
  that reliably fails the rubric and reliably produces the missing question is not a bad frame;
  it is a frame whose value the rubric does not measure. Either the rubric is incomplete or
  END_USER belongs in a different role. Do not resolve this on two runs.
- **DOOR_KEEPER, HORIZON and MECHANIC have never been pruned (0/2 each).** Being unprunable is
  not obviously good. A frame no detector ever catches may be well-designed or may simply be
  producing safe answers the critic has no grounds to reject.
- **T3 and T5 have never fired.** T5 (no "do X" sentence) is close to structurally unable to
  fire, because the output contract demands a committal position, so a branch that trips T5 has
  usually already failed validation. T3 (citation trap) needs a branch that cites, and only
  PRIOR_ART carries search tools. Both may be correct prevention rather than dead weight, and
  the counts cannot distinguish those. Recorded so the question stays open.

FIRST_PRINCIPLES has never been dispatched in a recorded run. It is in no primary set, only in
`alternates`, so nothing is wrong; it simply has no evidence behind it either way.

### The negative control that beat a real run

Every fixture now ships a linear chain-of-thought control that must fail. Writing the one for
fixture 004 produced the least comfortable result the repo has: **it passes `false_means`, the
single item the real run `004-kernel-naming` failed.**

It passes on a stock style-guide line about avoiding double negatives. Five isolated frames, a
blind rubric, a full trap sweep and a deepen round did not reach the question; a memorised
convention did. That is a real limit on what divergence buys, and it belongs in the record
rather than in a quietly loosened fixture.

The open question, which is the owner's: is this a gap in the frame set (no frame asks what a
thing asserts in its negative case) or a badly chosen assertion (matching "double negative"
rewards reciting a rule rather than reasoning about the negative case)? Do not resolve it by
editing the pattern until the answer is decided on its merits.

### Four assertions that do not discriminate

`adhd eval --audit` replays every fixture assertion against the real runs and the negative
controls separately. An assertion the control also satisfies is not measuring divergence: the
consensus answer already clears it. Finding `false_means` that way was luck; the audit makes it
mechanical. On the current nine recorded runs it flags four of twenty-one assertions:

| assertion | the control text that satisfied it |
|---|---|
| `002/periodic_actor` | "Cron" |
| `003/reframe` | "release cadence" |
| `003/who_pays` | "on call" |
| `004/false_means` | "double negative" |

None of these is automatically a bug in the fixture. Two readings apply to each, the same pair
as for `false_means`: the assertion may be asking for something the consensus answer genuinely
supplies (in which case the fixture is testing the wrong thing), or the frame set may have a
gap the control happens to cover.

`002/periodic_actor` is the clearest case for the first reading. Listing cron and GC is exactly
what the consensus answer is good at, so requiring the words proves nothing about divergence;
what the run should be asked for is which periodic actor and how the period was established.
`003/who_pays` matching "on call" is close behind.

**They are recorded, not fixed.** Rewriting four assertions immediately after seeing which ones
the controls cleared is how a harness gets tuned until it always passes. Each should be changed,
if at all, on its own argument about what the assertion is for, and with a fresh run to show the
change measures something. That is the owner's call.

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

---

## D8. Refining the rubric on recorded runs instead of on taste

**Question.** The critic rubric has nine dimensions and hand-set weights. Nobody has ever
checked whether the weights change any outcome, or whether nine dimensions measure nine things.
Can either be answered without adding a model?

**Decision.** Yes, from the runs already on disk. Resolved 2026-09-07 by drewc611, who chose a
learning loop over recorded runs when the alternative on the table was training a transformer.
No model, no keys, no inference client: `src/learn.ts` is pure functions over `evals/recorded`,
and `adhd learn --sensitivity` / `--correlation` print what they find. Negative controls are
excluded, because a control is a hand-written consensus answer, not a critic's scoring.

**What the weights decide.** Pass A prunes nothing. A fired trap does that. What pass A decides
is which survivor represents its cluster, and the representative is the position that goes to
deepen and, if it defends, becomes the recommendation. So the perturbation moves representatives,
not prunes. Feature 4 in `docs/FEATURES.md` was written the wrong way round and is corrected
there.

**Finding 1: the weights are not doing the choosing.** Across 5 real runs there are 4 contested
cluster decisions (more than one survivor). Moving any single dimension's weight by ±1 changes
0 of them. On this corpus a different weight vector ships the same answer. That is a reason to
stop arguing about weights, not evidence that the weights are right; 4 decisions is a pointer.

**Finding 2: two dimensions are pinned at the ceiling.** Over 25 scored artifacts, no pair of
dimensions correlates above 0.47 (falsifiability and assumption_attack), so nothing is obviously
one dimension charging twice. But `foreclosure` (mean 2.96, sd 0.20) and `reasoning_carries`
(mean 2.92, sd 0.39) score the maximum on 96% of artifacts, two distinct values each. Both carry
weight 2 and 1 respectively and add a near-constant to every total. They vary, so a flat-variance
check misses them; a near-constant correlates with nothing, so the correlation matrix misses them
too. Detecting that needed its own check, and `CEILING = 0.85` is it.

Compare `specificity` (mean 1.72, 12% at ceiling, weight 3) and `reversibility` (mean 1.76, four
distinct values). Those two are doing the separating.

**What this does not settle.** Whether the ceiling means the bar is too low, or the output
contract already guarantees what the dimension asks. `forecloses` is a required non-empty array
and `reasoning` is a required field, so the contract does guarantee something in both cases. If
the contract is doing the work, the dimension is scoring compliance, not divergence value, and
that is a rubric change — deferred to the owner, not made here. Re-run `adhd learn --correlation`
after the corpus grows past 25 artifacts before touching either anchor set.

**Cost of getting this wrong.** Tuning anchors until the ceiling clears would raise the scores'
spread without raising their meaning, and the harness would keep passing. That is the same
failure as rewriting a fixture assertion after seeing which controls cleared it, recorded under
D6, and it is refused for the same reason.

**Finding 3: two critics agree, and the run does not depend on which one read it.** A fresh
critic in a separate context window scored `003-kernel-strategy`'s five artifacts from
`critic/pass-a.brief.md` verbatim, blind, having read no other file. Its scoring is kept at
`critic/pass-a.rater2.yaml`; the run still ships on `pass-a.yaml` and `score.json` is unchanged.

- 84% exact agreement over 45 cells, 100% within one point. No cell disagreed by two.
- Four dimensions agreed on every cell: `committal`, `foreclosure`, `falsifiability`,
  `reversibility`. `foreclosure` also sits at the 96% ceiling, so its perfect agreement is what
  a near-constant looks like from a second angle, not evidence that it is well-defined.
- Worst were `assumption_attack` and `substance` at 60% exact, both mean |diff| 0.40. Those two
  ask the critic for a judgment the artifact does not spell out.
- The overall ranking changed: HORIZON overtook DOOR_KEEPER for top artifact.
- The run's outcome did not. The one contested cluster (LEDGER, DOOR_KEEPER) kept DOOR_KEEPER,
  and HORIZON is a singleton that goes to deepen either way.

**What clustering is doing.** Cross-cluster rank disagreement is structurally inert: each
cluster sends its own representative regardless of how it ranks against another's. Only order
inside a contested cluster changes anything, and this run had one. That is a stronger claim for
clustering than the design argument that produced it, and it also means cell agreement and
ranking agreement both overstate how much the critic decides. `adhd learn --agreement` prints
all three so the weakest one is not read as the answer.

**Sample of one run, one second critic.** 45 cells is not an inter-rater reliability figure. It
is a first reading, and the number to grow. Repeat it on 001, 002 and 004 before quoting 84%
anywhere it matters.
