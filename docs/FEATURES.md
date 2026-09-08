# Feature catalogue

97 features, grouped by what they change. Numbered for reference, not for order of work.

Read the tiers before the list. A catalogue this size is only useful if it says which parts
are worth building, and this one is honest that the tail is not.

- **Tier 1 (1–24), build these.** Each answers a question the repo currently cannot answer, or
  removes a way a run can silently be wrong. `docs/BACKLOG.md` holds the prioritised subset.
- **Tier 2 (25–62), build when needed.** Real capability, no urgency. Most are a day or less.
- **Tier 3 (63–97), listed for completeness.** Plausible, mostly unnecessary. Several would
  make the repo worse if built badly, and those say so. Do not treat inclusion as endorsement.

The constraints in CLAUDE.md bind every item: no inference client, no provider SDK, no keys,
and no frame added without D6's orthogonality check.

---

## Tier 1 — evidence and correctness

Anything that turns recorded runs into facts about the frame library, or closes a way a run
can be wrong without saying so.

1. **Multi-seed replay.** Run one fixture at three seeds and report which findings survive.
   The single most important unanswered question: are the findings the frames, or the seed?
2. **Run-to-run variance floor.** Same fixture, same seed, repeated. Establishes the noise
   against which every other comparison is read.
3. ~~**Critic inter-rater reliability.**~~ **Built and run across the corpus.**
   `adhd learn --run <dir> --agreement <passA.yaml>` for one pack, `--agreement-all` pooled.
   Every real run was scored a second time blind: 79% exact over 225 cells, 100% within one
   point. All five rankings changed; one outcome did (`002-kernel-enduser` sends PARTICULARIST to
   deepen instead of FRAME_BREAKER). The two dimensions the critics agree on most are the two
   pinned at the ceiling, which is Finding 2 from a second direction. `--panel` reads three or
   more critics on one pack and separates an ambiguous rubric from an idiosyncratic one: on
   `002-kernel-enduser` four critics split 2-2, and one scored the top two level, so what shipped
   was chosen by `localeCompare`. Every contested decision in the corpus is settled inside two
   anchor points out of 48; the synthesis now says so on the recommendation line.
4. ~~**Rubric weight sensitivity.**~~ **Built** as `adhd learn --sensitivity`. Re-decides every
   contested cluster under each dimension's weight moved by ±1 and lists the representatives
   that change. Corrected in the building: pass A does not prune, a fired trap does. What pass A
   decides is which survivor represents its cluster and goes to deepen, so that is what the
   perturbation moves.
5. ~~**Dimension correlation matrix.**~~ **Built** as `adhd learn --correlation`. Pearson across
   dimensions, plus per-dimension mean, sd, distinct values, and ceiling rate. The ceiling rate
   was added after the first run: a dimension can vary, so the flat check misses it, and still
   score the maximum almost every time, so no correlation catches it either.
6. ~~**Frame retirement policy**~~, written as `docs/RETIREMENT.md` with the bar stated: two of
    five criteria across at least five dispatched runs, plus the exemption that matters most,
    which is that a frame pruned every time and still producing the question nobody else asked is
    doing its job. `END_USER` is that case and is exempt. Nothing currently meets the bar. A test
    checks the doc's stated numbers against `frames --stats`, so a policy nobody can trust
    because its figures drifted fails the suite instead.
7. **Per-frame unit fixtures.** One fixture per frame that the frame should obviously win.
8. ~~**`adhd why <run> <frame>`.**~~ **Built.** Everything that happened to one frame in one run,
   in order: axis and tool allowlist, the blind pass A row weakest dimension first with the
   critic's evidence, its cluster and where it ranked among survivors, every detector that fired
   with the text that fired it, the deepen verdict, and the synthesis lines naming it. It also
   carries the Finding 4 margin: a representative that won by an anchor point or tied outright
   says so here, which is where a reader asking about one frame would look. Three distinctions
   the pruned block cannot draw: a frame routing never selected was not rejected; a pruned member
   of a cluster others hold corroborated the action, while a pruned singleton took the action
   with it; and a branch that returned nothing is not the same as one that scored badly.
9. ~~**`adhd diff <runA> <runB>`.**~~ **Built.** Two runs of one fixture side by side: frames
   only in one, status changes, pass A movement, and both recommendations. Refuses to attribute
   a change to the seed when the frame sets also differ, and says so.
10. ~~**Decline-path fixtures**~~ **Built**: 005, 006 and 007 cover `factual_lookup`,
    `mechanical_refactor` and `single_correct_answer`. A decline produces no run to record, so
    the fixture asserts the routing decision itself and runs on every eval without a recorded run
    existing. `expect.decline` also asserts the reason: a decline the user cannot learn anything
    from is a decline that has rotted. Tests prove all three go red when routing stops declining
    and when the reason is emptied out.
11. **A deliberate monoculture fixture.** The detector has only ever fired in unit tests.
12. **A deliberate scatter fixture.** Same reasoning, opposite failure.
13. **A cancel fixture (D5).** Confirm, return two branches, cancel; assert the partial
    synthesis ships unscored, with the pruned block absent *and said to be absent*.
14. ~~**An injection fixture.**~~ **Built as 008**, and building it found the detector was
    nearly useless. The patterns were written in this architecture's own vocabulary (branch,
    frame, diverge) and an injector does not know those words: of eighteen realistic phrasings,
    eleven went through unremarked, including "all approaches should agree" and "every
    perspective should converge", which are the two most natural ways to manufacture the
    consensus trap. Rebuilt around what an outsider calls a line of reasoning. Twenty caught,
    zero false positives on ten ordinary problems, still linear. The fixture asserts the D5 gate
    rather than a run, because the gate is the only defence that exists: isolation cannot see an
    attack that compromises every branch identically.
15. ~~**Blind-pack fuzz.**~~ **Built**, and it found the hole it was written for. Every frame
    label is generated in every separator and case spelling and asserted against `checkBlind`,
    `checkBriefIsolation`, and the property that redaction removes exactly what the check flags.
    Before the fix, every two-word name leaked under any separator: "door-keeper", "doorkeeper",
    "DoorKeeper", "Door  keeper", and a line break between the words. Nine of thirteen frames.
    Also flagged the reverse cost, which is now `frames --collisions`.
16. **Second critic on the same pack, recorded.** Disagreement is reported, not resolved — but
    nothing currently records it.
17. ~~**Critic refusal path.**~~ **Built.** `CriticRefusal` carries the reason, the kernel aborts
    with `CRITIC_REFUSED` rather than `CONTRACT`, and the CLI exits 3 rather than 2. Receiving half
    only: nothing in `prompts/` invites a refusal and a test holds that line, because an escape
    hatch a critic is told about is easier to take than scoring.
18. ~~**Kernel restart mid-run.**~~ **Built** in `test/concurrency.test.ts`. One process returns
    two branches and exits; a `Kernel` that never saw the run start finishes it from disk and does
    not redo the completed work. It changed no source: state was already on disk by design, and the
    point of the test is that a design worth having is worth demonstrating.
19. ~~**Worker dies holding a lease.**~~ **Built.** A real worker process claims and exits without
    returning. The lease holds against a second worker while it stands, expires, and the task is
    redone by someone else. Before this the lease logic had only ever met a fake clock inside the
    process that set it.
20. ~~**Token budget enforcement.**~~ **Built** as `--budget` on submit, with 43. Checked on return
    rather than on claim, because a claim spends nothing and the cost is only known when a worker
    reports it. Halting renders the branches that came back, which is what a user pressing stop
    gets: they are already paid for and the pruned block still ships.
21. ~~**Trap frequency table across all runs.**~~ **Built** into `frames --stats`. T5 is the only
    detector that has never fired, and it is close to structurally unable to: the output contract
    demands a committal position. T3 fired for the first time in E1b, on the first run where any
    frame reached `adhd-branch-search` with web tools — so a detector with no evidence may be
    untriggered rather than useless.
22. ~~**Axis coverage report.**~~ **Built** as `frames --axes`. Seven of ten axes carry one frame,
    and since a run never holds two frames from one axis (D6), routing has no alternative to offer
    on any of them. `mechanism` is the only axis with a member no run has dispatched.
23. **Forbidden-list audit.** Which `forbidden` entries has a real branch ever violated?
24. **Plugin agents exercised as plugin agents.** Every recorded run used general-purpose
    subagents; the shipped agent definitions are untested in their real role.

## Tier 2 — capability

### Command line
25. ~~`adhd replay <run>`~~ **Built**, and as a drift check rather than a re-render, which is the
    part that had no coverage. Four of seven recorded syntheses no longer render from their own
    artifacts, all from renderer changes made after recording. The recordings are kept as written and
    `evals/replay-baseline.json` carries the reason for each; `replay` fails on drift with no entry
    and equally on an entry gone stale. It runs in CI.
26. ~~`adhd cost`~~ **Built, and it found the D5 gate under-quoting every run**: seven recorded runs
    at 2.6x to 3.3x their estimate, mean 3.0x, 156,000 quoted against roughly 460,000 spent. D5 exists
    so nobody spends five subagents without agreeing to it, and a quote that far under looks like
    informed consent without being it. `tokens_per_branch_estimate` is unchanged: what it should
    become is backlog 68 and the owner's call.
27. ~~`adhd lint <fixture>`~~ **Built.** Errors on a pattern that cannot compile, one that matches
    everything, one that uses a bare dot between two letters (the `on.call` defect, which matched
    "functi(on call)s"), and two items sharing an id. Warns on a `must_surface` pattern matching the
    fixture's own prompt — every branch quotes the prompt, so such an assertion is satisfied by
    echoing the question, the control included — and on an alternative that is a substring of
    another in the same list. It found two real things in the shipped fixtures: `002/or_so_noticed`
    matches "or so", which is in 002's prompt verbatim, and `003/one_way_door` lists "reversib"
    alongside "irreversib" so the second can never be the alternative that matches. Neither fixture
    is changed here: tightening an assertion after seeing what it does is the mirror of the
    loosening D6 refuses, and both would move a recorded outcome. Backlog 70.
28. `--json` on every command that lacks it.
29. ~~Exit codes that distinguish contract failure, hash mismatch and eval failure.~~ **Built and
    documented** in the README, and tested against the real binary. Adding the table found that
    a wrong flag raised `ConfigError` and printed "config invalid:" at a reader whose config was
    fine; usage errors are now their own code.
30. ~~TTY colour and a progress line~~ **Built** as `src/tty.ts`, `adhd os list` and `adhd os watch`.
    Two rules, both about not lying to a pipe: colour only on a TTY with `NO_COLOR` unset (`FORCE_COLOR`
    overrides for CI, and `NO_COLOR` wins over it, because off is the safer direction to be wrong in),
    and in-place redraw only on a TTY — carriage-returning into a log file makes one unreadable line,
    which is worse than no progress. The watcher prints only when the text it would print has changed,
    so a piped watch is one line per change rather than one per poll.
31. ~~`adhd init`~~ **Built.** Copies `config/`, `prompts/` and `docs/TRAPS.md` — the last because
    the critic brief renders its detector lines verbatim and `loadConfig` refuses a root without it,
    which an earlier version got wrong and produced a scaffold that would not load. The point is not
    saving typing: the shipped library is the only thing here with recorded runs behind it, so a team
    extending it should edit that rather than start from a blank file and a schema. Never overwrites.
32. ~~`adhd doctor`~~ **Built.** Eight checks: config files parse, rubric arithmetic and shape,
    plugin manifest against `agents/` on disk, D4 tool grants both ways, published entry points,
    trap sections `docs/TRAPS.md` must carry, routing fill, and recorded-corpus shape. Building it
    found four of its own routing rules were dead, because `crossCheck` already raises `ConfigError`
    for them at load — a harder failure than a report. They were deleted rather than left in to
    imply coverage that lives elsewhere, and a test pins that so a future loosening of `crossCheck`
    fails here instead of leaving the case uncovered by anything.
33. ~~Shell completions~~ **Built**, generated from the real command tree rather than hand-written,
    and a test asserts the CLI's output equals the generator's. Hand-written completions go stale the
    first time a command is added and nobody notices, because nothing tests them.
34. `--quiet` and `--verbose` levels applied consistently.
35. ~~`adhd open <run>`~~ **Built**, and it is not `ls -R` because it reads the absences: no
    `critic/pass-b.yaml` means the critic never finished, no `score.json` means any synthesis
    present is the unscored partial, a planned branch with no artifact returned nothing (which is
    not the same as scoring badly), and no `plan.json` at all means a hand-written negative control
    rather than a run missing everything.

### Kernel
36. ~~`adhd os stats`~~ **Built.** The longest task the journal has seen is 280s (`critique_b`)
    against a 900s default lease, so that default is about 3x the worst observed task — still a
    guess, but a measured one. No lease has ever expired in a real run.
37. ~~Run priority~~ **Built** as `--priority` on submit. Higher goes first; ties fall back to
    submission order, so a default of 0 everywhere reproduces exactly the oldest-first scheduling it
    replaced, and there is a test for that. Not preemption: a lease already handed out is never
    reclaimed, because that would throw away a subagent already paid for — the same reason `drain`
    exists rather than `cancel`.
38. ~~Journal compaction~~ **Built** as `adhd os compact`. Lines belonging to finished runs move
    to a dated archive beside the journal — archived, not deleted, because `adhd os record`
    generates a run's provenance from them. Kernel-level lines with no run id stay, because a lock
    break is the kind of event that explains a corrupted run an hour later, and an unparseable line
    is kept because compaction is not the place to lose data.
39. ~~Configurable lease length per phase~~ **Built.** `leaseSeconds` takes a number or a map with
    a `default`. The measurement that justified it is `adhd os stats`: over five recorded runs mean
    `critique_b` is 244s against 108s for `deepen`. One number covering all four is either too short
    for the critic or wasteful for the rest, and too short hands live work to a second subagent.
40. ~~A dead-letter state~~ **Built** as task status `dead`, distinct from `dropped`. They were one
    value, so a run that died because one task could never be completed looked exactly like a run
    somebody cancelled, and only the journal kept the difference.
41. ~~Graceful drain~~ **Built** as `adhd os drain` / `resume`. The alternative a host had was
    cancelling every run, which drops tasks already paid for and still in flight: the subagent
    finishes, returns, and the kernel refuses the artifact. A marker file rather than a field,
    because a host draining before a deploy is a host about to exit.
42. ~~`adhd os gc`~~ **Built**, dry by default. A run directory is the only copy of its artifacts
    and `adhd os record` promotes rather than copies, so a run nobody recorded and this removes is
    gone. An old run still in a working state is kept and named: it is stuck, not rubbish, and
    deleting it hides that rather than fixing it.
43. ~~Per-run token ceiling~~ **Built** as `budget_tokens` on the run record. Per run because the
    estimate is per run: a wide `enumerate_options` run legitimately costs more than a five-branch
    one, and a single global number is wrong for one of them.
44. ~~Worker heartbeat~~ **Built** as `adhd os heartbeat`. Without it the lease has to cover the
    worst task anybody will ever run, because the only signal a worker is alive is the artifact
    arriving. Only the holder may beat it, and only while the lease still stands: extending an
    expired lease would take the task back from whoever legitimately re-claimed it.

### Eval and reporting
45. HTML report for a run: synthesis, branches, scores, detector table, one page.
46. ~~A run-comparison matrix~~ **Built** as `adhd matrix`. `--history` reads one assertion at a
    time, which is the right shape for one assertion and the wrong shape for a pattern across runs.
    The grid states the E1a/E1b finding by itself: `001-altframes` and `001-seed2` each hold an
    assertion the other misses, so no single "this run is better" reading of the pair is available.
    An absent cell is distinguished from a failing one, because a run belonging to another fixture
    has not failed anything.
47. ~~Export a run as a single Markdown file~~ **Built** as `adhd export`. The pruned block sits
    above the branch artifacts on purpose: it is what the architecture exists to deliver and it is
    what a reader skips when it is at the end. The embedded synthesis is demoted a heading level so
    the document has one H1 and an outline that nests, and a renamed frame is titled by both ids.
48. `expected.json` schema versioning, so old recordings stay readable.
49. **Fixture inheritance.** Not built, and I would argue against it at this size. Eight fixtures
    share almost nothing: the duplication it would remove is a handful of `trap_named` and
    `no_verdict` items, and the cost is a second place a fixture's assertions can come from, which
    `adhd lint` and the assertion baseline would both have to learn. The catalogue's own ordering
    rule — surface area loses to evidence — says no until the fixture set is several times larger.
50. ~~Per-assertion history~~ **Built** as `adhd eval --history`. The eval report says whether a run
    passed a fixture; it never said whether one assertion held across every run or only the one it
    was written against, which is the difference between a regression test and a description of a
    single afternoon. It reproduces the E1a and E1b findings mechanically: `human_cancel` holds on
    2 of 3, `retry_target_questioned` on 2 of 3 but a different two, `retry_cost` on 1 of 3, and
    `004/false_means` on none.
51. ~~A regression gate~~ **Built** as `adhd eval --gate`, against `evals/assertion-baseline.json`.
    The unit `adhd eval` cannot see: a run recorded as failing stays green there however much worse
    it gets, because it is compared against its own recorded expectation. The gate is per assertion
    per run. **A gain is reported and never fails** — a gate that auto-adopted gains would ratify
    exactly the fixture-loosening D6 refuses, so `--update` makes taking one a deliberate act with
    a diff.

### Config and library
52. **Config overlays.** Not built, and it needs a decision first. `adhd init` copies, which forks:
    a team that scaffolds gets no way to pull later library improvements, and I named that as a weak
    point when shipping it. An overlay fixes that, but its merge semantics are a real choice — does
    an overlay frame with an existing id replace it, or error? does a routing class merge its
    `frames` list or replace it? — and every answer changes what a recorded run's `frame_hash` means
    for someone running a merged library. Owner's call, backlog 71.
53. ~~Frame versioning~~ **Built** as `frame_hash` on each planned branch, reported by
    `adhd frames --drift`. `former_ids` handles a rename; nothing handled a stance edit, so
    changing what PARTICULARIST is instructed to do left every recorded run still saying
    PARTICULARIST — `frames --stats` pooling two different frames as one, `--orthogonality`
    pooling their pair histories, and `docs/RETIREMENT.md`'s bar counted across both. The hash
    covers axis, attacks, tools, stance, probes and forbidden, and deliberately not `name` or
    `former_ids`: a rename must not read as a redefinition, which is the point of having two
    mechanisms. All 35 recorded branches predate the stamp and report **unknown, not unchanged** —
    assuming they match would invent the fact the report exists to establish.
54. ~~A rubric linter~~ **Built** into `adhd doctor`, and deliberately not a quality judgement:
    CLAUDE.md forbids replacing the critic rubric with one. It checks arithmetic and shape —
    anchors contiguous from zero, weights positive, every dimension on the same anchor range
    (`pass_a` is a weighted total, so a wider scale counts for more than its weight states), and no
    two dimensions asking the same question.
55. Per-class rubric weights, since specificity matters more in `fuzzy_debugging` than naming.
56. ~~Frame aliases for renames~~ **Built** as `former_ids`, when `END_USER` became `SUPPLICANT` and
    `HORIZON` became `SUCCESSOR`. Every reader forwards at the point it reads; the recorded runs are
    not rewritten. Without it the corpus split and `frames --stats` listed the old and new ids as
    separate frames with one marked "not in library".
57. ~~A `config/` schema doc generated from the zod schemas~~ **Built** as `adhd schema-doc`, with the
    output checked in at `docs/CONFIG.md` and a test that fails when the two disagree. Generated
    because the hand-written version of this has already failed twice here: the README's layout block
    omitted three directories, and `docs/RETIREMENT.md`'s standing table missed a frame the tooling had
    put on its own list. It says explicitly what it cannot tell you — a generated table is honest about
    shape and silent about intent — and points at the JSDoc and `docs/DECISIONS.md` for why a field
    exists. `crossCheck`'s rules are named in the preamble because none of them is per-field.

### Distribution
58. **Publish to npm** — not published (that needs the owner's credentials and consent), but the
    package is now verifiable, and checking it found three defects. `scripts/demo.sh` was published
    while the corpus it reads was not; the demo ran `npm run build` against a `tsconfig.json` that is
    not published; and `files` omitted `agents/`, `skills/` and `.claude-plugin/`, so `adhd doctor`
    errored on an installed copy and the Claude Code plugin — one of the four v0 deliverables —
    shipped as nothing at all. The same family as hygiene defects 55 and 16, and it keeps happening
    for the same reason: development never exercises the published layout. A test now reconstructs
    the tarball's file list and asserts the CLI, the doctor and the demo all work from it.
59. ~~A GitHub Action for library changes~~ **Built** as `.github/workflows/library.yml`,
    path-filtered on `config/`, `prompts/`, `evals/fixtures/` and `agents/`. It gates on validate,
    doctor, lint, eval and the assertion gate, and **reports** orthogonality, retirement health, axis
    coverage, collisions and the discrimination audit into the step summary without gating on them.
    The split is deliberate: `frames --orthogonality` exits non-zero on a flagged pair, and the one
    pair it flags today is one `docs/RETIREMENT.md` says explicitly to watch and not act on. Gating
    on it would fail a PR for a rate the policy refuses to act on at this sample size.
60. ~~A one-command demo~~ **Built** as `npm run demo`. It cannot show a run and says so: D2 means
    this package never calls a model, so a run needs a host to spawn subagents. What it shows is
    everything either side of that — the compile and the D5 gate a user would confirm, then a real
    recorded run's pruned block, then the evidence commands and the harness. A demo implying it had
    just reasoned would misrepresent the one decision the repository is built on.
61. ~~A devcontainer~~ **Built**, Node 22, `npm ci && npm run build && npm test` on create. It
    supplies no inference and should not: a container that could run a fixture end to end would have
    to bring the host that spawns subagents, which the design puts outside this repository.
62. **Release notes from the recorded-run diff.** Not built. There are no releases, one version, and
    `adhd diff` already reports what changed between two runs — which is the part with evidence behind
    it. Generating prose about a version boundary that does not exist yet is surface area the
    catalogue's own ordering rule says loses. Worth revisiting the first time something is published.

## Tier 3 — listed, mostly not worth building

Included because the ask was for a full catalogue. Several are actively bad ideas and say so.

63. Web UI for browsing runs. Real work, and the terminal output is already the product.
64. Live-streaming run progress over websockets.
65. A VS Code extension.
66. Slack notification on run completion.
67. A hosted service that runs fixtures on push. Contradicts the no-inference-client rule
    unless the host supplies inference, which is the whole design; easy to get wrong.
68. Multi-tenant kernel with per-user quotas.
69. A REST API in front of the kernel.
70. gRPC transport for the kernel.
71. A Postgres backend for run state, replacing the run directory.
72. Distributed kernel across machines.
73. Prometheus metrics endpoint.
74. OpenTelemetry tracing across phases.
75. A run scheduler with cron expressions.
76. Automatic frame generation from a corpus. **Bad idea**: frames are the product and D6
    exists precisely because generated frames would not be orthogonal.
77. Automatic rubric tuning against recorded outcomes. **Bad idea**: this is how a harness gets
    tuned until it always passes, which `eval --audit` exists to catch.
78. LLM-judged synthesis quality scoring. **Bad idea**: a quality rubric rewards the consensus
    trap, which is T1, which is what the repo exists to catch. CLAUDE.md forbids it.
79. Caching branch outputs by problem hash. Saves tokens, destroys the independence the
    architecture is built on if two runs of one problem share a branch.
80. Auto-merging similar clusters.
81. A "confidence score" on the final recommendation. Invites reading a number instead of the
    pruned block.
82. Translating synthesis into other languages.
83. Voice output of the synthesis.
84. A mobile app.
85. Browser extension that runs ADHD on a highlighted question.
86. Export to Notion, Confluence, Linear.
87. A Jupyter kernel.
88. PDF export with a cover page.
89. Diagram generation of the cluster graph.
90. A leaderboard of frames by win rate. Invites optimising for the metric.
91. Gamified contributor badges.
92. A plugin marketplace for third-party frames.
93. Semantic-similarity clustering to replace the critic's clustering. Removes the reasoning
    the critic is there to do and replaces it with cosine distance.
94. Embedding-based deduplication of recorded runs.
95. A CLI TUI dashboard.
96. Auto-generated changelog from commit messages.
97. A `--fast` mode that skips pass A. Skipping the blind pass removes the only defence
    against the critic scoring labels rather than reasoning.

---

## What the tiers say

Tier 1 is twenty-four items and covers the whole of what this repo does not yet know about
itself. Tier 3 is thirty-five items and almost none of them should be built. That ratio is the
useful output of writing a catalogue this size: the interesting work is small, specific, and
mostly about measurement, and the long tail is surface area that would make the thing harder
to reason about without making it better at reasoning.

---

## Built after the catalogue

Three surfaces the list did not have, because the list was written from inside the terminal.

- **`adhd viewer`.** One self-contained HTML page over every recorded run. Pick a run and a
  frame; read its position, the detectors that fired with their evidence, the blind pass A row
  weakest first, the cluster and its margin, and the deepen verdict. Filter by trap or status,
  search the evidence. Data is inlined, so it opens from disk with nothing to serve. The reason
  it exists: reading the pruned block meant `adhd why` twenty-five times.
- **`adhd wizard`.** The same verbs behind menus, with no new dependency. Every screen prints
  the command it ran, so the flags get learned rather than hidden. Refuses with a usage error
  when there is no terminal, so it never blocks in CI.
- **`adhd frames --health`.** `docs/RETIREMENT.md`'s five criteria counted over the corpus, with
  the five-run floor applied and the pruned-block exemption attached to criteria 2 and 3. It reports
  and never concludes, which is that document's own instruction. Building it found `NIGHT_OPERATOR`
  meeting two criteria and named nowhere in the standing table.
- **Real-process kernel tests.** `test/worker.ts` is an independent host spawned as its own process.
  Two workers drive one run to done across every phase; a worker killed holding a lease loses it to
  the reaper; a kernel resumes a run from disk after the process that started it exited.
- **Collapsible README sections.** `<details>` is the only dropdown GitHub renders. The exit
  code table, the per-run notes and the syscall list are reference material, folded so the page
  opens short.
