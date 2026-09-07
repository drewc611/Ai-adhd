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
7. **`adhd frames --health`**: flag frames pruned in every run they appear in, and frames that
   have never once been pruned. Both are suspicious for opposite reasons.

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
22. **Axis coverage report.** Ten axes, thirteen frames. Which axes are thin?
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
28. **Critic refusal path.** What happens when the critic returns "I cannot score this"?
    Currently a contract violation; it should be a distinct, reported state.
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
    after. Evidence in D8 finding 5.

## 5. Kernel (D7)

30. **Two workers, concurrently.** Real concurrency has never run; the lease logic has only
    been unit-tested against a fake clock.
31. **Worker dies mid-task.** Kill a worker holding a lease and assert the task is reclaimed.
32. **Kernel restart mid-run.** Kill the process, restart, resume from the journal.
33. **Token budget enforcement.** Halt a run that exceeds N tokens and render partial.
34. **`adhd os stats`.** Throughput, mean phase duration, expiry rate across the journal.
35. **Run priority.** Two queued runs, one urgent.
36. **Journal compaction** for long-lived kernels.
37. **A worker that returns malformed YAML on purpose**, asserting the contract failure is
    more useful than a silent repair.

## 6. CLI and reporting

38. **`adhd why <run> <frame>`.** Print exactly why a frame was pruned, with the detector
    output and the pass A row.
39. **`adhd diff <runA> <runB>`.** Two runs of the same fixture, side by side: which frames
    survived in both, which findings are shared, which are seed artifacts.
40. **`adhd replay <run>`.** Re-render the synthesis from artifacts without re-running phases.
41. **`adhd cost`.** Token spend across recorded runs, by phase and by frame.
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

Two of the six tests for these pin intent rather than catch a regression, and say so in place:
64 has no single-process reproduction once 63 is fixed, and the atomicity in 66 is not
observable from one process at all. Recorded rather than dressed up as coverage.

Left alone deliberately: `actions/checkout` is v4 here and v7 in the CodeQL workflow. CI is
green and there is no evidence of a problem, so bumping a working action on cosmetic
inconsistency is churn, not a fix. `commander` stays pinned below 15 because 15 requires Node
22.12 and this package supports Node 20.

## Not doing, and why

- **An inference client.** See CLAUDE.md. This is the design, not an omission.
- **A quality rubric.** Rewards the consensus trap, which is T1, which is the thing the repo
  exists to catch.
- **More frames without the orthogonality check.** Thirteen frames on ten axes is already
  thin per axis; adding a fourteenth on a shared axis makes the library worse, not larger.
