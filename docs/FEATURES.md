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
17. **Critic refusal path.** "I cannot score this" is currently a contract violation; it
    should be a distinct reported state.
18. **Kernel restart mid-run.** Kill the process, restart, resume from the journal.
19. **Worker dies holding a lease.** Kill it and assert the task is reclaimed and re-run.
20. **Token budget enforcement.** Halt a run past N tokens and render partial.
21. **Trap frequency table across all runs.** A detector that has never fired is either good
    prevention or dead weight, and the two are indistinguishable until counted.
22. **Axis coverage report.** Ten axes, thirteen frames. Which axes are one frame deep?
23. **Forbidden-list audit.** Which `forbidden` entries has a real branch ever violated?
24. **Plugin agents exercised as plugin agents.** Every recorded run used general-purpose
    subagents; the shipped agent definitions are untested in their real role.

## Tier 2 — capability

### Command line
25. `adhd replay <run>` — re-render the synthesis from artifacts without re-running a phase.
26. `adhd cost` — token spend across recorded runs, by phase and by frame.
27. `adhd lint <fixture>` — the audit and pattern checks for one fixture, before recording.
28. `--json` on every command that lacks it.
29. ~~Exit codes that distinguish contract failure, hash mismatch and eval failure.~~ **Built and
    documented** in the README, and tested against the real binary. Adding the table found that
    a wrong flag raised `ConfigError` and printed "config invalid:" at a reader whose config was
    fine; usage errors are now their own code.
30. TTY colour and a progress line while `adhd os` advances.
31. `adhd init` — scaffold a `config/` directory from the shipped one.
32. `adhd doctor` — check config, prompts, plugin manifest and build output agree.
33. Shell completions for bash and zsh.
34. `--quiet` and `--verbose` levels applied consistently.
35. `adhd open <run>` — print the run directory's file tree with sizes.

### Kernel
36. `adhd os stats` — throughput, mean phase duration, expiry rate from the journal.
37. Run priority, so an urgent run jumps a queued one.
38. Journal compaction for long-lived kernels.
39. Configurable lease length per phase; deepen legitimately takes longer than diverge.
40. A dead-letter state for tasks that exhausted their attempts, separate from `aborted`.
41. Graceful drain: stop accepting claims, let leases finish.
42. `adhd os gc` — delete finished run directories older than N days.
43. Per-run token ceiling carried in the plan rather than a global.
44. Worker heartbeat, so a lease can be extended by a worker that is still alive.

### Eval and reporting
45. HTML report for a run: synthesis, branches, scores, detector table, one page.
46. A run-comparison matrix across every recorded run and fixture.
47. Export a run as a single self-contained Markdown file.
48. `expected.json` schema versioning, so old recordings stay readable.
49. Fixture inheritance, so classes can share `must_surface` items.
50. Per-assertion history: when did this item start passing, and on which run?
51. A regression gate: fail CI if a previously passing assertion starts failing.

### Config and library
52. Config overlays, so a team can extend the shipped frames without forking.
53. Frame versioning, so a stance edit does not silently invalidate old recordings.
54. A rubric linter: weights sum sanely, no dimension unreferenced.
55. Per-class rubric weights, since specificity matters more in `fuzzy_debugging` than naming.
56. Frame aliases for renames, so recorded runs keep resolving.
57. A `config/` schema doc generated from the zod schemas.

### Distribution
58. Publish to npm under a scoped name.
59. A GitHub Action that runs `adhd eval` on PRs touching `config/` or `prompts/`.
60. A one-command demo from a clean checkout.
61. A devcontainer so a contributor can run a fixture in minutes.
62. Release notes generated from the recorded-run diff.

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
