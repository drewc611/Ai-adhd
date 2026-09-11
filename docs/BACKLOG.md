# Backlog

The prioritised subset of `docs/FEATURES.md`, which holds the full catalogue of 97 with its
tiers. This file is what to build next; that file is what exists.


Everything worth building next, in priority order within each section. Each item is written
to be implementable without further design work. An item marked **evidence** produces a fact
about the frame library; an item marked **mechanism** changes what the system can do.

The ordering rule: anything that turns recorded runs into evidence beats anything that adds
surface area. The `config/` and `prompts/` directories are the product, and five runs is not
yet enough to know whether they work.

## 1. Evidence from runs we can already do

0. ~~**Decide the four non-discriminating assertions** that `adhd eval --audit` flags
   (`002/periodic_actor`, `003/reframe`, `003/who_pays`, `004/false_means`). Each on its own
   argument, each with a fresh run showing the change measures something. See D6 in DECISIONS.~~
   **Done, three of four, and no fresh run was needed for any of them. `003/who_pays` was a regex
   defect: `on.call` matched "functi(on call)s" and the control never says on-call. `002/periodic_actor`
   was removed, because the consensus answer genuinely names the periodic actor and the fixture's
   own `why` never claimed otherwise. `004/false_means` lost the two style-guide tokens and now
   reads "never matched", which is the truth. `003/reframe` stays flagged with its argument in the
   fixture. No recorded outcome changed. Full reasoning in D6.**
1. ~~**`adhd frames --stats`** (evidence). Per-frame rates across recorded runs: appearances,
   prune rate, which traps prune it, mean pass A, survivor rate, fold rate, how often it holds
   the recommendation. Five runs is thin but the command is what makes run six worth anything.~~
   **Built. Also `--collisions`, which counts the frame labels that are also ordinary prose.**
2. ~~**Negative controls for 002, 003, 004.** Only 001 has a linear-CoT control. Without one per
   fixture, a passing run has nothing to beat.~~
   **Built. One linear-CoT control per fixture.**
3. **Same fixture, different seed.** Run 001 at seed 2 and seed 3. If the frame set is the
   mechanism, the findings should survive a reshuffle; if they are seed artifacts, that is the
   most important thing this repo could learn about itself.
4. **Same fixture, same seed, different day.** Run-to-run variance with everything fixed.
   Establishes the noise floor against which every other comparison is read.
5. ~~**Critic self-consistency.** Score one artifact pack twice with two fresh critics and
   report per-dimension agreement. The rubric is only as good as its inter-rater reliability
   and nobody has measured it.~~
   **Built as `adhd learn --agreement` and `--agreement-all`, plus `--panel` for three or more critics. 79% exact over 225 cells, and one run in five would have shipped a different answer.**
6. ~~**Trap frequency table across all runs.** Which detectors ever fire? A detector that has
   never fired in five runs is either well-designed prevention or dead weight, and the two
   look identical until counted.~~
   **Built into `frames --stats`. T3 and T5 have never fired.**
7. ~~**`adhd frames --health`**: flag frames pruned in every run they appear in, and frames that
   have never once been pruned. Both are suspicious for opposite reasons.~~
   **Built, and against `docs/RETIREMENT.md` rather than the two lines this item asked for: all five
   criteria counted, the five-run floor applied, and criteria 2 and 3 always carrying the pruned-block
   exemption. It reports and never concludes, which is that document's own instruction. Building it
   found `NIGHT_OPERATOR` meeting criteria 2 and 3 and named nowhere in the standing table; a test now
   fails when the tooling puts a frame on the list and the doc does not.**

## 2. Coverage gaps in the fixture set

8. **006, `enumerate_options`** (n=7). The wide path has never run. Seven branches, seven
   briefs, a critic pack twice the size of any yet, and the frame-selection logic above five.
9. **007, `api_surface`.** The last run class with no fixture.
10. ~~**008 through 010, the decline classes.** `factual_lookup`, `mechanical_refactor`,
    `single_correct_answer`. A decline is a first-class outcome and no recorded run declines.~~
   **Built as fixtures 005, 006 and 007. A decline has no run to record, so `expect.decline` asserts the routing decision and its reason directly.**
11. **A fixture designed to produce a monoculture.** The detector has only ever fired in unit
    tests. Pick a problem where every frame lands on the same action and record it.
12. **A fixture designed to produce scatter.** Same reasoning, opposite failure.
13. **A cancel fixture** (D5). Confirm, return two branches, cancel, and assert the partial
    synthesis ships unscored with the pruned block absent and said to be absent.
14. ~~**A fixture whose problem contains an injection attempt** ("ignore the frame above").
    Asserts the branch contract holds against adversarial problem text.~~
   **Built as fixture 008, asserting the D5 gate rather than a run. Building it found the detector caught only injections phrased in this repo's own vocabulary.**
15. **A fixture with a very long problem** (several thousand words) to exercise brief size.
16. **A fixture whose problem is one word.** The compiler should still hash and dispatch it.

## 3. Frame library (D6)

17. **Close the `false_means` gap** found by run 004: no frame asks what a name asserts in its
    negative case. Either a probe on an existing frame or a new frame with the orthogonality
    check run first.
18. ~~**Frame retirement policy.** Written rule for when a frame leaves the library, with the
    evidence bar stated. Currently there is no way for the library to shrink.~~
   **Built as `docs/RETIREMENT.md`, with the exemption that matters most: a frame pruned every time and still producing the question nobody else asked is doing its job.**
61. ~~**Rename the two frames whose labels are ordinary prose.** `adhd frames --collisions`
    found `END_USER` and `HORIZON` written in artifacts they did not produce and never once by
    themselves; the redactor removed every use, so the critic scored an actor census that
    appeared to name no actor.~~
   **Done. `SUPPLICANT` and `SUCCESSOR`, picked mechanically: every candidate was matched against all 39 recorded artifacts, all synthesis files and all fixtures, and only names appearing nowhere in the corpus were eligible. `config/frames.yaml` carries `former_ids` so the five runs that wrote the old ids still resolve; the runs themselves are not rewritten. D6 has the reasoning.**
19. **Per-frame fixtures.** One fixture per frame that the frame should obviously win, as a
    unit test for the frame's own stance.
20. **Probe ordering experiment.** Do the numbered probes change the answer if reordered?
21. **Forbidden-list audit.** Which `forbidden` entries have ever been violated in a real run?
22. ~~**Axis coverage report.** Ten axes, thirteen frames. Which axes are thin?~~
    **Built as `adhd frames --axes`. Seven of the ten axes carry one frame, and because a run never
    contains two frames from one axis (D6), routing has no alternative to offer on any of them.
    `mechanism` is the only axis with a member no run has ever dispatched.**
23. **A frame that reasons about the negative case generally** (what the absence of the thing
    asserts), candidate name NEGATIVE_SPACE, subject to the orthogonality check.

## 4. Critic and scoring

24. ~~**Rubric weight sensitivity.** Re-score every recorded run under perturbed weights and
    report which prune decisions flip. A prune that flips under a small weight change was
    never a prune.~~
   **Built as `adhd learn --sensitivity`. 0 of 4 contested representatives flip, and the report says why that is not stability: every contested decision is settled inside two anchor points out of 48.**
25. ~~**Dimension correlation matrix.** If two dimensions always move together across runs, one
    of them is not measuring anything.~~
   **Built as `adhd learn --correlation`. Max |r| is 0.51, but `foreclosure` (91%) and `reasoning_carries` (94%) sit at the ceiling on 35 scored artifacts, which correlation cannot see. D8 finding 5 says why: both are measuring the output contract and the D4 tool allowlist rather than the reasoning.**
26. ~~**Blind-pack integrity fuzz.** Generate artifacts that mention their own frame in a dozen
    ways and assert pass A redaction catches all of them.~~
   **Built, and it found the hole it was written for: every two-word frame name leaked under any separator.**
27. ~~**Second critic on the same pack.** Disagreement is recorded, not resolved — but nothing
    currently records it.~~
   **Built. Recorded rather than resolved: `002-kernel-enduser` splits 2-2 across four critics.**
28. ~~**Critic refusal path.** What happens when the critic returns "I cannot score this"?
    Currently a contract violation; it should be a distinct, reported state.~~
    **Built, receiving half only. A refusal reached the reader as `critic pass A: scores: Required`
    — a schema complaint aimed at a critic that was being perfectly clear. `CriticRefusal` carries
    the reason, the kernel aborts with `CRITIC_REFUSED: <reason>` rather than `CONTRACT`, and the CLI
    exits 3 rather than 2. A pack carrying any real scoring fields is still a contract violation
    whatever it calls itself, because a half-scored pack claiming to be a refusal is the one shape
    that could hide a real failure. Hash mismatch still wins: paraphrase drift invalidates the run
    whatever the critic then says about it.**
69. **Decide whether to tell the critic it may refuse** (owner's call). Nothing in `prompts/` mentions
    refusing, and a test asserts that, so today the handler only catches a refusal a critic produces
    unprompted. Offering one explicitly is a change to the product with a real cost: an escape hatch a
    critic is told about is easier to take than scoring, and the critique phase is where T1 gets caught.
    The argument for is that a critic with no way to say "these two artifacts are byte-identical" will
    invent a score instead, which is worse than refusing. Neither side is settled by anything recorded.
29. ~~**Detector output quality check.** Some evidence strings are one clause. Set a floor and
    reject pass B if a fired trap's evidence is under N words.~~
   **Built. Floor set from data: real fired evidence runs 29 to 50 words.**
60. **Rewrite the two ceiling dimensions (v1 rubric).** `foreclosure`'s anchor 0 is half
    unreachable because the output contract already rejects an empty `forecloses`; scale it
    from the contract's floor upward. `reasoning_carries` reads a near-constant 3 because
    twelve of thirteen frames have no web tools, so drop it or make it conditional on the
    frame having had them. Bump `version` in `config/critic-rubric.yaml` when either lands —
    `score.json` records `rubric_version`, so the split in the corpus will be legible. Owner's
    call: it makes the 35 artifacts scored under version 0 non-comparable with everything
    after. Evidence in D8 finding 5, and now with a sign on it: chance-corrected, `foreclosure`
    scores Krippendorff's alpha of -0.017 with a 95% interval of [-0.04, +0.00] on 96% exact
    agreement, and the interval for `committal` also contains zero. `python -m adhd_analysis`
    reports both. A dimension whose interval spans chance is unmeasured, not weak, which raises a
    third option for this item: drop `foreclosure` rather than rewrite it, since the contract
    validator already enforces what it is scoring.

## 5. Kernel (D7)

30. ~~**Two workers, concurrently.** Real concurrency has never run, and the lease logic has only
    been unit-tested against a fake clock.~~
   **Done. `os.test.ts` already had one claim race — six processes contending for a single round,
   asserting no task reaches two of them — and that was the whole of it. Two workers now drive a
   run to done across every phase, including the two that hand off through a continuation.**
31. ~~**Worker dies mid-task.** Kill a worker holding a lease and assert the task is reclaimed.~~
   **Done. A worker process claims and exits without returning; the lease holds against a second
   worker until it expires, then the task returns to the queue and the run finishes.**
32. ~~**Kernel restart mid-run.** Kill the process, restart, resume from the journal.~~
   **Done. The first process returns two branches and exits; a kernel object that never saw the
   run start resumes it from disk and does not redo the completed work. State was already on
   disk by design, so this changed no code — it is the test that makes the design worth
   something. `save` is still `tmp` + `rename` without an fsync: atomic against a concurrent
   reader, not durable against power loss, and nothing yet shows that it matters.**
33. **Token budget enforcement.** Halt a run that exceeds N tokens and render partial.
34. ~~**`adhd os stats`.** Throughput, mean phase duration, expiry rate across the journal.~~
    **Built. Over five kernel runs the longest task the journal has seen is 280s (`critique_b`),
    against a 900s default lease — so the default is roughly 3x the worst observed task, which is
    a defensible margin and is now a measured one rather than a guess. No lease has ever expired
    in a real run; the reclaim path is exercised only by `test/concurrency.test.ts`.**
35. **Run priority.** Two queued runs, one urgent.
36. **Journal compaction** for long-lived kernels.
37. **A worker that returns malformed YAML on purpose**, asserting the contract failure is
    more useful than a silent repair.

## 6. CLI and reporting

38. **`adhd why <run> <frame>`.** Print exactly why a frame was pruned, with the detector
    output and the pass A row.
39. **`adhd diff <runA> <runB>`.** Two runs of the same fixture, side by side: which frames
    survived in both, which findings are shared, which are seed artifacts.
40. ~~**`adhd replay <run>`.** Re-render the synthesis from artifacts without re-running phases.~~
    **Built, and as a drift check rather than a re-render. `run --phase synth` already re-rendered;
    what did not exist was any check that a recorded synthesis still follows from its artifacts. Four
    of seven do not, all from renderer changes made after they were recorded: the Close call line, the
    split of folds out of the pruned block, `defend` -> `defended`, and the explicit attribution of a
    pruned corroborator. The recordings are kept as written, on the same argument as `former_ids` — a
    recorded synthesis is what the reader was shown — and `evals/replay-baseline.json` carries the
    reason for each. `replay` exits non-zero on drift with no entry, and equally on a baseline entry
    that has gone stale.**
41. ~~**`adhd cost`.** Token spend across recorded runs, by phase and by frame.~~
    **Built, and it found that the D5 gate under-quotes every run. Seven recorded runs cost 2.6x
    to 3.3x their estimate, mean 3.0x: the gate says 156,000 tokens and the run costs around
    460,000. D5's whole purpose is informed consent about spend. `tokens_per_branch_estimate` in
    `config/routing.yaml` sets it and has not been changed — `config/` is the product, and what
    the number should become is item 68 below. Per-frame spend was only ever in the kernel's
    `os.json`, which `adhd os record` does not copy, so `writeCost` now writes `by_frame` into
    `cost.json`; the two pre-kernel recordings cannot be reconstructed and are reported as
    unavailable rather than estimated.**
68. **Recalibrate `tokens_per_branch_estimate`** (owner's call). `adhd cost` shows the D5 preview
    quoting about a third of what a run costs, consistently across seven runs. Setting the mean
    ratio to 1.0 means half of future runs come in over the quoted figure, which for a consent
    gate may be worse than a high quote that is never exceeded. The alternatives are a point
    estimate at the mean, a point estimate at the observed maximum, or a range in the preview
    text. All three change what the gate promises a user, which is why this is not a number to
    pick while nobody is looking.
42. **TTY colour and progress** for `adhd os` while a run advances.
43. ~~**`--json` on every command** that lacks it, for scripting.~~
    **Built. `run`, `traps`, `viewer` and `validate` gained it; `wizard` is interactive and is
    excluded on purpose. `run --phase compile --json` returns `run_dir` and the briefs to spawn,
    which meant widening `PhaseResult`: the run directory was only ever in the prose, so a driver
    had to match a path out of a sentence. `traps --json` carries the exit code rather than
    replacing it. A test asserts no non-interactive command is missing the flag.**
44. **`adhd lint <fixture>`.** Check a fixture's regexes compile, and warn on patterns that
    match the fixture's own `why` text (a common way to write an assertion that cannot fail).
45. ~~**Exit codes** that distinguish contract failure, hash mismatch, and eval failure.~~ Built, documented in the README, tested against the built binary.

## 7. Documentation

46. **A worked example**, end to end, with the actual commands and the actual output.
47. **FAQ**, starting with "why not just prompt the model to consider multiple perspectives".
48. **A frame-authoring guide** with the orthogonality check as a checklist.
49. **A short paper-style writeup** of what five runs have shown, honest about the sample size.
50. **Failure gallery**: every recorded failure, why it failed, and what it taught.

## 8. Distribution

51. **Publish to npm** under a scoped name.
52. **A GitHub Action** that runs `adhd eval` on every PR touching `config/` or `prompts/`.
53. **A one-command demo** that runs a fixture from a clean checkout.
54. **Plugin agents exercised as plugin agents.** Every recorded run so far used
    general-purpose subagents; the shipped agent definitions are untested in their real role.

## 9. Hygiene, done

Findings from a full sweep, all fixed. Recorded because the first one would have shipped.

55. **Every published entry point was wrong.** `bin`, `main` and the `adhd` and `mcp` scripts
    all pointed at `dist/cli.js` and friends, while the build emits `dist/src/`. `npm i -g adhd
    && adhd` would have failed. It survived because development runs `node dist/src/cli.js`
    directly. Fixed, plus `types` and an `exports` map, and a test that asserts every path
    package.json publishes exists after a build *and* is covered by a `files` entry.
56. **`src/rng.ts` had no test.** D3 says every run is seeded and replayable, and the whole
    guarantee rests on that module. Now seven tests: pinned stream values, range, permutation,
    input not mutated, every element reaches every position, phase seeds distinct and pure, and
    a compile-level replay showing a seed reproduces the dispatch order.
57. **Two quadratic regexes.** `template.ts` put an optional directive alternation and two
    `\s*` around a lazy `[^{}]*?`, all able to match the same characters: 15x time for 4x
    input. `synth.ts` `tidy()` rescanned from every position inside a whitespace run. Both are
    now linear, measured. `run.ts`'s detector parser is index-based for the same reason.
58. **`test.yml` had no `permissions` block**, so the token took the default scope. Now
    `contents: read`.
59. **`noUnusedLocals` and friends were off.** Turning them on found two dead variables left by
    an earlier refactor of mine.

62. **The kernel mutex was safe to take and unsafe to release.** Acquisition refuses to break a
    lock whose owner is alive, precisely because breaking one on age alone lets two processes
    run inside it together. Release had the mirror image and no guard: a slow holder whose lock
    *was* broken on age deleted the directory on its way out — evicting whoever had legitimately
    acquired it, and letting a third process in while that holder was still inside. Each
    acquisition now stamps a token and releases only what still carries it; losing the lock
    mid-section is journalled as `lock_lost`, because it explains a corrupted run an hour later.
63. **Aborting on lease expiry dropped one task and left its siblings claimable.** The abort in
    `advanceLocked` drops every outstanding task; the reap path dropped only the task that had
    expired. So a run that was already `aborted` still had four pending branch tasks, and hosts
    went on spending subagents on it and returning work to a kernel with nowhere to put it.
64. **`claim` skipped the run-state filter when given a run id.** The listing path filtered to
    the four active states; naming a run explicitly went straight to `load`. Every non-active
    state also dropped its tasks, so the only reachable leak was through 63 — but the filter now
    applies to both paths, so a future state that keeps its tasks cannot reopen it quietly.
65. **A terminal run accepted returned work.** `return_` checked the task's lease and never the
    run's state, so an artifact could be written into a run that had aborted or been cancelled.
    It is refused now with the reason a host needs — the run ended, and why — rather than the
    symptom that the task is no longer leased.
66. **`result` read the record under the lock and the synthesis outside it.** A cancel landing
    between the two returned a state from before it with a rendering from after: the caller was
    told the run was still deepening and handed the partial. Both are read under one lock now.

67. **The first two-worker test was flaky one run in three, and the flake was the test.**
    Whichever process won the first lock race could burn through all five branch tasks before
    the other was scheduled, so asserting that both did work was asserting the operating
    system's scheduler. Capping each worker at two tasks per wave makes the split structural.
    Recorded because the tempting fix — rerun until green, or drop the assertion — would have
    left a test that passes without checking that the run can actually be shared.

Two of the six tests for these pin intent rather than catch a regression, and say so in place:
64 has no single-process reproduction once 63 is fixed, and the atomicity in 66 is not
observable from one process at all. Recorded rather than dressed up as coverage.

Left alone deliberately: `actions/checkout` is v4 here and v7 in the CodeQL workflow. CI is
green and there is no evidence of a problem, so bumping a working action on cosmetic
inconsistency is churn, not a fix. `commander` stays pinned below 15 because 15 requires Node
22.12 and this package supports Node 20.

70. **Two fixture assertions that `adhd lint` flags** (owner's call). `002/or_so_noticed` matches
    `or so`, which is in 002's prompt verbatim, so any branch quoting the question satisfies an
    assertion meant to check the imprecision is *treated as evidence* — and the negative control
    holds it too. `003/one_way_door` lists `reversib` alongside `irreversib`, so the second can
    never be the alternative that matches. Neither is changed here. Tightening an assertion after
    seeing what it does is the mirror image of the loosening D6 refuses, and both would move a
    recorded outcome: 002 currently holds `or_so_noticed` on both its runs.

71. **Config overlays** (owner's call). `adhd init` copies the shipped library, which forks it: a
    team that scaffolds has no way to pull later improvements. An overlay would fix that and its
    merge semantics are a genuine decision, not a detail. Does an overlay frame reusing an id
    replace the base frame or fail loudly? Does a routing class merge its `frames` list or replace
    it? Each answer changes what `frame_hash` means for a run under a merged library, and one of
    them quietly makes the drift report unable to say which definition ran.

72. ~~**Publishing to npm** (owner's action).~~ **The name decided itself and the pipeline is
    built; one secret remains.** npm already serves `adhd`: a 2022 stub at 0.0.0, description
    "unstable wip, do not use atm". Publishing under it is a 403 that reads like a permissions
    problem, so the package is now `ai-adhd` and the CLI binary is still `adhd`.
    `.github/workflows/release.yml` publishes on a `v*` tag and then registers the same version
    with the official MCP Registry, which needs no secret because it verifies the
    `io.github.drewc611/*` namespace from the workflow's own OIDC identity. **npm still needs an
    `NPM_TOKEN` repository secret, which only the owner can add.** Until it is there, a tag fails
    at the npm step with that sentence. See `docs/DISTRIBUTION.md`.

73. **A mission that runs the whole loop end to end** (evidence). Every part of the SuperAgent is
    tested and `adhd super` drives a real mission through plan, confirm, claim, a contract
    rejection, a retry and done. Nothing has yet run a `deep` mission with live subagents, so the
    stage graph's central claim — that a second research pass after the divergence catches the
    direction chosen too early — is a design argument and not a finding. It needs one real
    mission, which costs real tokens, and is the owner's call for the same reason D5 exists.

74. **Order 5, if the corpus ever shrinks or the runner grows** (owner's call). Held-out
    perplexity is best at order 5 (36.0 against 38.6) and it costs 9.2GB, past `Budget.weekly()`'s
    5120MB. At this corpus size order 4 is the only one that fits a hosted runner. A smaller corpus
    or a larger runner changes the answer, and D13 has the measured table to re-decide from.

75. **Rust RFCs and Kubernetes KEPs, if the network boundary may widen** (owner's call). Both
    licences are read and correct — MIT OR Apache-2.0 and Apache-2.0, better provenance than the
    IETF RFCs already in the corpus — and both are the same genre. Neither is numerically
    enumerable: `text/0002-rfc-process.md` and `keps/sig-node/1234-some-feature/README.md` carry a
    slug the number does not determine, and `rust-lang/rfcs` checks in no index (`SUMMARY.md` and
    `text/SUMMARY.md` are both 404, checked 2026-09-08). The only listing mechanism is GitHub's tree
    API, which means allowing `api.github.com` in the fetcher's prefix allowlist and accepting a
    JSON response where the fetcher today accepts `text/plain` and nothing else.

    That content-type rule is not decoration. D10 banned network in a scheduled job because a job
    that can fetch is a job that can fetch weights, and `text/plain` only is one of the four things
    that keeps the exception small. A JSON carve-out is a real widening of it, so it is the owner's
    call rather than a table entry. What it would buy: roughly 600 more documents under freer
    licences than the largest source currently in the corpus.

76. **Re-measure what pruning costs, on one split** (small, and it invalidates a published figure
    until it is done). D14 priced count-pruning at 2.9x perplexity — 17.4 against 6.06 — and D16
    establishes that both of those are memorisation scores, because each model trained on the whole
    manifest and was scored on a stride of it. The ratio between two numbers that measure nothing
    about unseen text is not a measurement of anything.

    The fix is two runs on one split: order 4 with `--held-out-every 20`, once with the n-gram
    ceiling low enough to force pruning and once without, scored on the same held-out half. About 25
    minutes. The prediction, recorded here so it can be wrong: the real cost is **larger** than 2.9x,
    because a pruned model has less of the tail to memorise and also less to generalise from. Until
    this runs, `agents/adhd-governor.md` says not to quote 2.9x as measured.

77. **Separate the vocabulary half of the generalisation gap** (small). D17 measures 2.83x between a
    model that read 584 PEPs and one that read none, on the same 31 documents, and OOV goes 1.36% to
    2.96% across that pair. Part of the gap is that the never-seen model lacks PEP-specific words and
    part is that it models PEP prose worse, and this run does not say which is which.

    `genericity.py` already computes surprisal over in-vocabulary tokens only, with the OOV rate
    beside it, for exactly this reason. `evaluate.py` does not. Adding the same option there and
    re-scoring the two models on the same 31 documents settles it in about two minutes of compute. No
    prediction recorded, because either answer is interesting: mostly vocabulary would say the model
    generalises better than 2.83x suggests, and mostly modelling would say worse.

78. **Measure how much a percentage point of OOV is worth, and re-derive the threshold from it**
    (small, and a code comment currently promises it). `comparable_heldout` refuses two all-targets
    perplexities whose OOV rates differ by more than one percentage point, because every OOV target is
    charged as a prediction of `<unk>` and `<unk>` is among the most frequent symbols a
    closed-vocabulary model holds — so the model that knows fewer words is asked an easier question on
    a larger share of the same text. E6 needed that refusal: training OOV is 4.83% at 8,192 types
    against 0.39% at 148,353.

    **One percentage point is a judgement and the code says so.** It is calibrated against one thing:
    E4 compared `min_count` 2 against 3 on all targets at 0.63% and 0.85% OOV, that comparison was
    sound, and the threshold must keep passing it. Nothing measures what the discount actually is.

    The run is cheap because E6 produces most of it. Score one model on the frozen set at several
    `max_vocab` values — 8,192 / 32,768 / 148,353 — and read perplexity against OOV rate. That gives a
    slope, and the threshold becomes the OOV gap worth some stated fraction of a perplexity point
    rather than a round number. No prediction recorded, because the direction is not obvious: `<unk>`
    is cheap to predict, but a model that has folded 5% of the corpus into one symbol has also lost
    the contexts those words provided, and the two effects work against each other.

79. **Price a transformer at the n-gram's vocabulary** (large, and it may not be reachable here).
    E6 holds the vocabulary at 8,192 because the output projection is `d_model x vocab_size` and every
    token's loss touches all of it. At the n-gram's 148,353 types that layer alone is 19M parameters,
    and by the measured 7,671 tok/s at 1.46M parameters the arithmetic puts one epoch over the
    training side well past a day. So E6 answers "which model class is better at 8,192 types", which
    is a real question and not the whole one.

    What would make it reachable is an adaptive or sampled softmax, which changes the loss the model
    optimises and therefore needs its own registration. Recorded rather than attempted because the
    honest version of it is not a small change.

## Not doing, and why

- **An inference client.** See CLAUDE.md. This is the design, not an omission.
- **A quality rubric.** Rewards the consensus trap, which is T1, which is the thing the repo
  exists to catch.
- **More frames without the orthogonality check.** Thirteen frames on ten axes is already
  thin per axis; adding a fourteenth on a shared axis makes the library worse, not larger.
