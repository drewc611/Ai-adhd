# Backlog

Everything worth building next, in priority order within each section. Each item is written
to be implementable without further design work. An item marked **evidence** produces a fact
about the frame library; an item marked **mechanism** changes what the system can do.

The ordering rule: anything that turns recorded runs into evidence beats anything that adds
surface area. The `config/` and `prompts/` directories are the product, and five runs is not
yet enough to know whether they work.

## 1. Evidence from runs we can already do

0. **Decide the four non-discriminating assertions** that `adhd eval --audit` flags
   (`002/periodic_actor`, `003/reframe`, `003/who_pays`, `004/false_means`). Each on its own
   argument, each with a fresh run showing the change measures something. See D6 in DECISIONS.
1. **`adhd frames --stats`** (evidence). Per-frame rates across recorded runs: appearances,
   prune rate, which traps prune it, mean pass A, survivor rate, fold rate, how often it holds
   the recommendation. Five runs is thin but the command is what makes run six worth anything.
2. **Negative controls for 002, 003, 004.** Only 001 has a linear-CoT control. Without one per
   fixture, a passing run has nothing to beat.
3. **Same fixture, different seed.** Run 001 at seed 2 and seed 3. If the frame set is the
   mechanism, the findings should survive a reshuffle; if they are seed artifacts, that is the
   most important thing this repo could learn about itself.
4. **Same fixture, same seed, different day.** Run-to-run variance with everything fixed.
   Establishes the noise floor against which every other comparison is read.
5. **Critic self-consistency.** Score one artifact pack twice with two fresh critics and
   report per-dimension agreement. The rubric is only as good as its inter-rater reliability
   and nobody has measured it.
6. **Trap frequency table across all runs.** Which detectors ever fire? A detector that has
   never fired in five runs is either well-designed prevention or dead weight, and the two
   look identical until counted.
7. **`adhd frames --health`**: flag frames pruned in every run they appear in, and frames that
   have never once been pruned. Both are suspicious for opposite reasons.

## 2. Coverage gaps in the fixture set

8. **006, `enumerate_options`** (n=7). The wide path has never run. Seven branches, seven
   briefs, a critic pack twice the size of any yet, and the frame-selection logic above five.
9. **007, `api_surface`.** The last run class with no fixture.
10. **008 through 010, the decline classes.** `factual_lookup`, `mechanical_refactor`,
    `single_correct_answer`. A decline is a first-class outcome and no recorded run declines.
11. **A fixture designed to produce a monoculture.** The detector has only ever fired in unit
    tests. Pick a problem where every frame lands on the same action and record it.
12. **A fixture designed to produce scatter.** Same reasoning, opposite failure.
13. **A cancel fixture** (D5). Confirm, return two branches, cancel, and assert the partial
    synthesis ships unscored with the pruned block absent and said to be absent.
14. **A fixture whose problem contains an injection attempt** ("ignore the frame above").
    Asserts the branch contract holds against adversarial problem text.
15. **A fixture with a very long problem** (several thousand words) to exercise brief size.
16. **A fixture whose problem is one word.** The compiler should still hash and dispatch it.

## 3. Frame library (D6)

17. **Close the `false_means` gap** found by run 004: no frame asks what a name asserts in its
    negative case. Either a probe on an existing frame or a new frame with the orthogonality
    check run first.
18. **Frame retirement policy.** Written rule for when a frame leaves the library, with the
    evidence bar stated. Currently there is no way for the library to shrink.
19. **Per-frame fixtures.** One fixture per frame that the frame should obviously win, as a
    unit test for the frame's own stance.
20. **Probe ordering experiment.** Do the numbered probes change the answer if reordered?
21. **Forbidden-list audit.** Which `forbidden` entries have ever been violated in a real run?
22. **Axis coverage report.** Ten axes, thirteen frames. Which axes are thin?
23. **A frame that reasons about the negative case generally** (what the absence of the thing
    asserts), candidate name NEGATIVE_SPACE, subject to the orthogonality check.

## 4. Critic and scoring

24. **Rubric weight sensitivity.** Re-score every recorded run under perturbed weights and
    report which prune decisions flip. A prune that flips under a small weight change was
    never a prune.
25. **Dimension correlation matrix.** If two dimensions always move together across runs, one
    of them is not measuring anything.
26. **Blind-pack integrity fuzz.** Generate artifacts that mention their own frame in a dozen
    ways and assert pass A redaction catches all of them.
27. **Second critic on the same pack.** Disagreement is recorded, not resolved — but nothing
    currently records it.
28. **Critic refusal path.** What happens when the critic returns "I cannot score this"?
    Currently a contract violation; it should be a distinct, reported state.
29. **Detector output quality check.** Some evidence strings are one clause. Set a floor and
    reject pass B if a fired trap's evidence is under N words.

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
43. **`--json` on every command** that lacks it, for scripting.
44. **`adhd lint <fixture>`.** Check a fixture's regexes compile, and warn on patterns that
    match the fixture's own `why` text (a common way to write an assertion that cannot fail).
45. **Exit codes** that distinguish contract failure, hash mismatch, and eval failure.

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

## 9. Known CodeQL findings not fixed here

Surfaced by the alert-printing step added to `.github/workflows/codeql.yml`. Three predate
this work and live on `main`, so they are separate changes rather than PR widening. All are
the same shape as the one that was fixed: two quantifiers that can match the same character,
so the engine has to try every split.

55. **`src/template.ts:26`, `js/polynomial-redos`** (high). Slow on `{{{{` followed by many
    spaces. The template engine runs over prompt files, which are repo content, so the
    exposure is small; the fix is still cheap and the query is right.
56. **`src/synth.ts:132`, `js/polynomial-redos`** (high). `tidy()` on many repeated tabs.
    Runs over rendered synthesis text, which contains subagent output.
57. **`src/run.ts:122`, `js/polynomial-redos`** (high). Slow on repeated `*Detector:*`.
    Parses `docs/TRAPS.md`, repo content.
58. **`.github/workflows/test.yml:7`, `actions/missing-workflow-permissions`** (medium). No
    explicit `permissions` block, so the job takes the default token scope. Add
    `permissions: { contents: read }`.

## Not doing, and why

- **An inference client.** See CLAUDE.md. This is the design, not an omission.
- **A quality rubric.** Rewards the consensus trap, which is T1, which is the thing the repo
  exists to catch.
- **More frames without the orthogonality check.** Thirteen frames on ten axes is already
  thin per axis; adding a fourteenth on a shared axis makes the library worse, not larger.
