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
capability.

**The launch permit rests on an untested claim, and this is the honest statement of it.** Read
only, no file, no network and no spawn are all true and none of them is the question. The
non-negotiable is that branches never see siblings, and what `TaskList` returns inside a running
ADHD dispatch has never been observed. An attempt to check it from a subagent in this repository
returned "tool unavailable", which settles nothing: that subagent was not a plugin agent
declaring the grant. Until a real plugin run reports what it sees, treat this as the one
isolation claim in the design that is argued rather than demonstrated. If it turns out to leak,
the fix is a different launch permit, not a weaker rule.

`test/agents.test.ts` checks the grants as an **allowlist**, not a denylist. It was a denylist,
naming filesystem and network tools, which left every tool nobody had thought of passing
silently, and the dangerous ones are exactly what a future edit would reach for: `Agent` and
`SendMessage` reach another agent, `TaskCreate` and `TaskOutput` reach another task, and any
`mcp__*` tool reaches whatever its server does. Each agent file must now grant exactly its
permitted set, a new agent file fails until it has an entry, and changing a grant means arguing
for it here first.

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

**Blindness costs text, and two labels cost more than they protect.** Redaction removes every
frame label from what pass A reads, ids and display names alike, and it cannot tell "from inside
the End user stance" from "the end user behind that caller". `adhd frames --collisions` counts
which labels turn up in artifacts their frame did not write, across 29 recorded artifacts:

| label | foreign uses | own uses |
|---|---|---|
| End user / END_USER | 5 | 0 |
| Horizon / HORIZON | 1 | 0 |

Nothing else collides. END_USER has never written its own label; ACTOR_CENSUS and LEDGER wrote
it five times between them, once inside a `missing_actor` field, and the redactor removes all
five. The critic then scores an actor census that appears not to name an actor, on
`actor_coverage`.

Two things were done and one was not. The pass A prompt now tells the critic that `[frame]` is
machine redaction of a real noun phrase, to be read through rather than scored as vagueness.
Separator spellings are now caught, which made redaction stricter, not looser: "door-keeper",
"doorkeeper", "DoorKeeper" and a line break between the words all leaked before, which is nine of
thirteen frames.

What was not done is renaming END_USER and HORIZON. That is a D6 change to the library and it
belongs to the owner. Zero own uses across five runs is also a small sample: a future END_USER
artifact writing "the end user" would be identifying itself, and redaction would be right.

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

**Finding 3: the critics agree, and one run in five would still have shipped a different
answer.** Every real run's artifact pack was scored a second time by a fresh critic in a separate
context window, from `critic/pass-a.brief.md` verbatim, instructed to read no other file. Each
second scoring is kept beside the first as `critic/pass-a.rater2.yaml`; every run still ships on
`pass-a.yaml` and no `score.json` changed.

Pooled over 225 cells from 5 runs: **79% exact, 100% within one point**. Not one cell in the
corpus disagreed by two.

| | exact | mean abs diff |
|---|---|---|
| specificity (weight 3) | 68% | 0.32 |
| substance | 68% | 0.32 |
| reversibility | 72% | 0.28 |
| assumption_attack | 76% | 0.24 |
| actor_coverage | 76% | 0.24 |
| committal | 80% | 0.20 |
| falsifiability | 80% | 0.20 |
| foreclosure | 92% | 0.08 |
| reasoning_carries | 96% | 0.04 |

**The two dimensions the critics agree on most are the two pinned at the ceiling.** `foreclosure`
and `reasoning_carries` score the maximum on 96% of artifacts (Finding 2) and agree at 92% and
96%. That is one fact reached from two directions: they agree because almost every artifact gets
a 3. High inter-rater agreement is not evidence a dimension is well defined when the dimension
barely varies.

`specificity` carries the highest weight in the rubric and has the worst agreement. It is also
the dimension whose anchors ask the critic to do something (delete the three most specific
details and re-read) rather than to recognise something.

**Every ranking changed. One outcome did.**

| run | exact | ranking | representative |
|---|---|---|---|
| 001-first-run | 69% | changed | same |
| 002-first-run | 73% | changed | same |
| 002-kernel-enduser | 78% | changed | **FRAME_BREAKER → PARTICULARIST** |
| 003-kernel-strategy | 84% | changed | same |
| 004-kernel-naming | 89% | changed | same |

In `002-kernel-enduser` the second critic sends PARTICULARIST to deepen instead of FRAME_BREAKER
in the `measure_the_period_first` cluster. That run's recommendation depends on which critic read
it. Recorded, not smoothed: it is the exact failure `--agreement` was built to find, and it fired
on the fifth pack tried.

**What clustering is doing.** Cross-cluster rank disagreement is structurally inert: each cluster
sends its own representative regardless of how it ranks against another's. 5 of 5 rankings moved
and 1 of 5 outcomes did. So cell agreement and ranking agreement both overstate how much the
critic decides, and `adhd learn --agreement` prints all three with the weakest ones labelled as
such. That is a stronger argument for clustering than the design reasoning that produced it.

**Five runs, one second critic each, and four on the pack that split.** 225 cells is a first
corpus, not a reliability figure. Quote 79% with the sample size attached or not at all.

---

**Finding 4: pass A separates cluster survivors by almost nothing, and one decision was an exact
tie.** Two raters cannot tell an ambiguous rubric from an idiosyncratic critic, so
`002-kernel-enduser` was scored twice more, blind, same conditions. `adhd learn --panel` reads a
panel of any size.

Four critics, 76% of cells scored identically, no cell off by more than one point, and the
cluster splits **2-2**: FRAME_BREAKER for the shipped critic and rater4, PARTICULARIST for raters
2 and 3. Not one critic reading it oddly. The rubric does not determine the answer.

The weighted totals say why. All four critics score FRAME_BREAKER at exactly 0.9167 and SABOTEUR
at exactly 0.8958. Only PARTICULARIST moves, across 0.8750, 0.9375, 0.9375, 0.9167 — and rater4's
0.9167 is an **exact tie** with FRAME_BREAKER, so what shipped was decided by `localeCompare` in
`pick()`, not by the rubric. That is not a close decision. It is no decision.

It is not one cluster. Every contested representative decision in the corpus is settled inside
two anchor points out of 48:

| run | cluster | margin |
|---|---|---|
| 002-kernel-enduser | measure_the_period_first | 0.0208 (one anchor point) |
| 001-first-run | caller_owned_deadline | 0.0208 (one anchor point) |
| 002-first-run | find_the_sawtooth | 0.0417 |
| 003-kernel-strategy | extract_one_then_gate | 0.0417 |

**This reframes Finding 1.** "0 of 4 representatives flip under ±1 weight moves" reads as
stability and is not stability: these decisions were never wide. A weight move rescales every
artifact's total in the same direction, so it moves ranking far less than a single anchor read
differently does. The representatives are not stable because the rubric is decisive; they are
close enough that any of them could ship. `--sensitivity` now prints the margins directly beneath
the flip count, because the flip count alone is misleading.

**What it does not settle, and what should not be done about it.** The obvious fix, spreading the
anchors so survivors separate further, would manufacture confidence rather than measure it: the
positions genuinely are close, and a rubric that says so is telling the truth. Three candidate
responses, none taken here:

1. Send every survivor within one anchor point to deepen, not just the top one. Costs a subagent
   per extra position and admits the tie instead of hiding it.
2. Break ties on something meaningful (fewest fired traps, widest `forecloses`) rather than
   alphabetically. Cheap, and at least the rule would be defensible.
3. Leave it, and print the margin in the synthesis so a reader sees the representative won by a
   hair.

Options 1 and 2 change what ships and belong to the owner. **Option 3 was taken**, because it
changes no decision and the alternative was silence: `pick()` breaks ties alphabetically, nothing
downstream said so, and the run read as though a decision had been made. The synthesis now carries
a **Close call** line under the recommendation whenever the representative led its runner up by
two anchor points or fewer:

- at an exact tie, that the two scored level and the winner was chosen by frame id, and that the
  runner up's position in the corroborating block is as well supported;
- otherwise, the margin against the anchor step, and that one anchor read the other way would
  have sent the other frame instead.

`--sensitivity` prints the same margins beneath the flip count. The recorded runs' `synthesis.md`
files predate the note and are left as they were rendered: they are the record of what those runs
produced, not a place to backfill.
