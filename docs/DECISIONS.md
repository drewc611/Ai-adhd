# Open decisions

Each decision below blocks code until the owner picks an option. The pick and the date go in
the log at the bottom. Recommendations are the builder's proposal, not the resolution.

D1 through D5 must be resolved before the first line of implementation. D6 is a proposal
for the check that gates future frame additions; it does not block v0 code.

---

## D1. Runtime

**Question.** What do the library, CLI, and MCP server run on?

**Options.**

- **A. TypeScript on Node 20+.** Runtime deps: `yaml`, `zod`, `commander`,
  `@modelcontextprotocol/sdk`. Tests on `node:test`. Ships as an npm package so `npx adhd`
  works with nothing installed.
- **B. Python 3.11+.** Runtime deps: `pyyaml`, `pydantic`, `typer`, `mcp`. Tests on pytest.
  Ships as a wheel; the plugin would need a venv or `uvx`.

**Recommendation: A.** Claude Code plugins and MCP hosts are Node first, so the plugin's
`mcpServers` entry is one line with no environment setup. Zod's `.strict()` rejects unknown
keys by default, which is exactly the property the orchestrator leak test needs: the routing
decision schema has no free text slot, and any extra key is a hard failure. Nothing in the
library favours Python; it is pure functions over three YAML files.

**Consequences.** Sets `package.json`, the `mcpServers` block in
`.claude-plugin/plugin.json`, and the CI matrix.

**Status: OPEN.**

---

## D2. Execution model

**Question.** With no inference client, what does `adhd run` actually do, and who drives the
loop between phases?

**Options.**

- **A. Run directory state machine, driven by the skill.** `adhd run` is phased:
  `compile`, `critique`, `deepen`, `synth`. Each phase reads what the host wrote into
  `runs/<id>/`, validates it, and emits the next set of briefs. The CLI never waits on a
  model. The skill in `skills/adhd/SKILL.md` is the driver: it calls a phase, spawns the
  subagents the phase asked for, writes their artifacts to the paths the phase named, and
  calls the next phase.
- **B. MCP tools only, no filesystem state.** The host passes every artifact back inline as
  tool arguments. Nothing on disk.
- **C. Long running CLI process** that compiles, then polls the run directory until the host
  has written all N artifacts, then continues.

**Recommendation: A**, with the MCP server as a thin wrapper over the same phase functions,
reading and writing the same run directory. Filesystem state makes every phase inspectable
after the fact and makes `adhd eval` a replay over recorded runs rather than a live spend.
B loses the audit trail, and the pruned block and the hash check both want artifacts on disk
anyway. C blocks, hides state, and has no clean way for the user to stop between phases.

**Under this decision, the orchestrator is the compiler.** The host session contributes one
routing decision object whose fields are all enum valued. The compiler assembles briefs from
the verbatim problem, one frame record, and the branch template. There is no field the host
could put an analysis into, so "the orchestrator never reasons" is enforced by schema rather
than by prompt. The test in CLAUDE.md ("fails the run if orchestrator output contains a
candidate answer") becomes: the routing decision has no string field longer than a frame id,
and any unknown key rejects.

**Consequences.** Four CLI subcommands stay as briefed. `adhd run` grows `--phase` and
`--run <dir>`. The MCP server exposes `adhd_run`, `adhd_traps`, `adhd_eval`, `adhd_frames`
with the same arguments.

**Status: OPEN.**

---

## D3. The v0 frame set

**Question.** Which frames ship, and how many does a run use?

**Options.**

- **A. Nine frames on nine distinct axes**, as drafted in `config/frames.yaml`:
  `particularist`, `frame_breaker`, `actor_census`, `ledger`, `door_keeper`, `mechanic`,
  `saboteur`, `minimalist`, `night_operator`. Routing picks five per problem class. The
  library size equals the hard cap, so a `--allow-wide` run uses every frame once.
- **B. A minimal five** and grow from eval evidence.
- **C. Owner supplies the frame set.**

**Recommendation: A.** Fixture 001's `must_surface` items map onto three specific frames:
the cancel path onto `actor_census`, the retry target onto `frame_breaker`, the retry bill
onto `ledger`. Cutting any of those means 001 cannot pass. The other six exist so that
fuzzy debugging, naming, API surface, and strategy each get a five frame set without
reusing the same five, which is what would make the routing table pointless.

Each frame carries `axis` (unique), `attacks` (which traps it is built to defeat), `stance`
(the instruction the branch runs under), `probes`, and `forbidden` (what the branch must not
do, so the distortion holds). Read the file before deciding. The stances are the product.

**Status: OPEN.**

---

## D4. What is scored in code and what is judged by the critic

**Question.** Trap detectors "run mechanically". Which detectors can code run alone, and can
a code only detector prune a branch?

**Options.**

- **A. Code lints flag, the critic confirms; contract violations prune in code.** Code runs
  the lints in `docs/TRAPS.md` (T3 citation strip, T5 hedge scan, T4 empty foreclosure, T6
  run level null sweep) and attaches hints to the branch before the critic sees it. The
  critic must still emit a record for every trap on every branch, and may overrule a hint
  with evidence. Hash mismatch aborts the run. Missing required fields or empty
  `forecloses`/`falsifier` prune without a critic.
- **B. Code lints prune directly.** Faster and cheaper. Also wrong often enough to matter:
  the T5 hedge scan will fire on "either fail over or return partial output, never retry the
  same instance", which is a verdict.
- **C. All detection lives in the critic; code only aggregates.** Cleanest separation, but
  then "mechanical" means "the critic was asked nicely", and the scorer has no independent
  check on the critic.

**Recommendation: A.** The scorer's job is deterministic aggregation plus refusal: it
applies weights from `config/critic-rubric.yaml`, applies the hard rules (any fired trap
prunes, singletons escalate, cluster and monoculture and scatter thresholds), and rejects a
critic result that is missing any (branch, trap) record. Lints give it a second opinion to
report disagreement on. Disagreement between a lint and the critic is written into the
pruned block, not resolved silently.

**Status: OPEN.**

---

## D5. The way out

**Question.** A run spawns five to nine subagents. How does the user stop it, and how does
the system refuse to start when it should not?

**Options.**

- **A. Gate at plan time, phase boundaries, and routing.**
  1. `adhd run --phase compile` prints a plan preview: the verbatim problem text and its
     hash, the frames selected, N, and an order of magnitude token estimate. The skill
     shows this to the user and does not spawn a branch until the user says go. `--yes`
     skips the prompt for scripted use.
  2. Every phase is a separate call, so the host stops between phases for free. Nothing is
     ever in flight that the user cannot see.
  3. `config/routing.yaml` has `decline` classes (`factual_lookup`,
     `mechanical_refactor`, `single_correct_answer`). A decision that lands there produces
     no briefs and a one line reason, and the skill answers the question directly instead.
  4. `max_branches` defaults to 5. Above 9 requires `--allow-wide`. The compiler refuses
     otherwise.
- **B. No gate.** Rely on the skill's "when to use" section.
- **C. Token budget only.** Cap per branch, no confirmation.

**Recommendation: A.** The preview doubles as the paraphrase check: the user sees the exact
text that was hashed before any spend, so a host that "cleaned up" the prompt is caught at
zero cost. B is the failure mode CLAUDE.md names. C caps the damage without giving a way to
avoid it.

**Status: OPEN.**

---

## D6. Frame orthogonality check

**Question.** CLAUDE.md says not to add frames without running "D6's orthogonality check".
What is the check?

**Proposal.** Two layers.

*Static, at validation time (ships in v0):*

- Every frame declares exactly one `axis`. No two frames share an axis.
- Every frame declares at least one trap in `attacks`. The union across the library covers
  T1 through T7. (T8 is the critic's counterweight, not a frame's job.)
- Every frame has a non empty `forbidden` list. A frame that forbids nothing is not a
  distortion, it is a suggestion.
- Routing never selects two frames with the same axis for one run.

*Empirical, at eval time (ships when there is a run history):*

- `adhd frames --orthogonality` reads every recorded run in `evals/recorded/` and reports,
  for each frame pair that appeared together, how often pass B put them in the same cluster.
- A pair that co-clusters in more than 60% of shared runs is flagged redundant. One of the
  two is a candidate for removal or rewrite.
- Corroboration across orthogonal frames is the strongest signal the system produces. That
  claim is only true if the frames are actually orthogonal, so this number is the one that
  tells you whether the architecture is doing anything.

**Status: PROPOSED.** Does not block v0 code. Blocks any PR that adds a frame.

---

## Log

| Decision | Resolution | Date | By |
|---|---|---|---|
| D1 | | | |
| D2 | | | |
| D3 | | | |
| D4 | | | |
| D5 | | | |
| D6 | | | |
