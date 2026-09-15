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
3. ~~**Same fixture, different seed.** Run 001 at seed 2 and seed 3. If the frame set is the
   mechanism, the findings should survive a reshuffle; if they are seed artifacts, that is the
   most important thing this repo could learn about itself.~~
   **Done. Both seeds recorded. The first attempt at seed 3 (`20260914223732-7e664e`) aborted at
   critique under D30 with three of five artifacts unparseable — that is item 87, resolved as D37 —
   and the second (`20260915013807-7e664e`) completed and is recorded as `001-seed3`.**

   **The answer is that the two kinds of dependency are separable, and the original reading had them
   the wrong way round.** `human_cancel` holds at seeds 1 and 3 and under a new frame set, and
   missed only seed 2: sample variance, with seed 2 the outlier rather than seed 1 the fluke.
   `retry_cost` and `retry_target_questioned` hold on all three seeds and miss only where the frames
   changed: frame-set properties. What actually fails at seed 3 is
   `pruned_traps_include_any T1,T2,T3`, which has now held on one run of four. Full amendment in
   `docs/EXPERIMENTS.md` under E1a.

   **Read it with item 89 in hand**: a reseed of this fixture cannot change its frame set, so the
   frame-set column is one run. The experiment the item's title describes still wants
   `enumerate_options`, which is item 91.
4. ~~**Same fixture, same seed, different day.** Run-to-run variance with everything fixed.
   Establishes the noise floor against which every other comparison is read.~~
   **Run and recorded as `evals/recorded/001-seed3-repeat`. All five briefs byte-identical to
   `001-seed3`, same dispatch, so the only variable is the session. Two quantities, two answers.**

   **Pass A is stable.** Mean absolute move 0.019 across the five frames, largest 0.048, two
   unchanged to four decimal places. So a pass A gap under **0.05** is noise, which retires the
   hedge `adhd diff` had been printing since it was built.

   **The trap sweep is not stable, and it is the part that prunes.** Identical artifacts and
   identical detector text: one critic fired T7 twice and pruned two of five, the other fired
   nothing and pruned none. Clusters went 2 to 3, the recommendation changed hands, and three of
   the four failed fixture assertions are that one event.

   The consequence for E1a is larger than the item asked for: E1a varied seed and session together
   and read the difference as a seed effect, and the same swing happens with the seed held. Full
   write-up in `docs/EXPERIMENTS.md` under "E1a completed by the same-seed repeat". What reproduced
   untouched was the blind letter mapping, the three-member cluster, and the branch positions
   themselves, one of them almost verbatim. **Divergence reproduces; adjudication does not**, which
   is the opposite of where the design put its risk.
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

8. ~~**006, `enumerate_options`** (n=7). The wide path has never run. Seven branches, seven
   briefs, a critic pack twice the size of any yet, and the frame-selection logic above five.~~
   **Built as fixture 014, queue-options: `enumerate_options` was the last run class in
   `config/routing.yaml` with no fixture. It asserts the compiler rather than a run, per 008 through
   011, and the run it waits for is still open.**

   **Two assertions had to be added before the fixture could say anything.** The `compiles: true`
   path checked the hash, the verbatim passthrough and the brief size, and never the branch count —
   so the wide path, whose entire subject is that `n` is 7 and every other class derives 5, could not
   assert the one property it exists for. A compile that fell back to `max_branches` would have
   produced a correct hash, five verbatim briefs and a passing fixture. `branches_expected` is that
   check, and `distinct_axes` is the other one: D6's one-frame-per-axis rule is trivially true at
   n=5 from a list of five and a real constraint at n=7 from a list of nine, and nothing checked it
   on a compiled plan.

   Both are falsifiable and tested against doctored fixtures rather than asserted: asking for 5
   branches on a plan that carries 7 fails and names both numbers, and asking for a count routing
   cannot fill fails rather than returning a short plan quietly.

   The problem in the fixture is deliberately weak — overlapping cron jobs have an obvious answer —
   because that is what `enumerate_options` is for and also the combination most likely to converge,
   so the run may say something about fixture 012 too.
9. ~~**007, `api_surface`.** The last run class with no fixture.~~
    **Built as fixture 011, retry-api-surface: whether `send()` takes a `retries: number`, a
    `RetryPolicy`, or neither. The linear answer to any API question is "take an options object, it is
    more extensible", which is available without reading the question — so the assertions are the three
    things a run must surface to have read this one: who holds the call site, whether retrying is a
    property of the service or of the request, and what each shape forecloses. It lints clean and the
    harness reports it as awaiting a run rather than as a pass, because no run exists yet.**
10. ~~**008 through 010, the decline classes.** `factual_lookup`, `mechanical_refactor`,
    `single_correct_answer`. A decline is a first-class outcome and no recorded run declines.~~
   **Built as fixtures 005, 006 and 007. A decline has no run to record, so `expect.decline` asserts the routing decision and its reason directly.**
11. ~~**A fixture designed to produce a monoculture.** The detector has only ever fired in unit
    tests. Pick a problem where every frame lands on the same action and record it.~~
    **Built as fixture 012, one-obvious-answer: a fourteen-month on-call rotation of one person, and
    budget for a better paging tool. Every stance should land on the same action from a different
    direction — cost prices the sleep, actors finds the tool routes between people who do not exist,
    scope finds the smallest change is a second person, adversary finds she leaves.**

    **The constraint that shapes it: a monoculture fixture cannot be a problem with a right answer.**
    Those route to `single_correct_answer` and are declined before a branch spawns (fixture 007), so
    it has to be a genuine design decision where the stances happen to converge, which is rarer.

    The monoculture here is the system working and the answer is not wrong. What would be wrong is
    reporting five-way agreement as corroboration across five axes when the problem admitted one
    action and divergence bought nothing — which is T1 at run level, and the thing the repository is
    named for. `pruned_min` is deliberately unset: run-level monoculture and per-frame T1 are two
    findings and a critic can record the first without the second, so asserting both would let the
    fixture fail for a reason unrelated to what it tests.

    Recorded as awaiting a run, per fixture 011's precedent. If it produces an ordinary run instead,
    that failure is worth more than the pass — it would mean five stances are harder to converge than
    this reasoning assumes, which nothing has tested.
12. ~~**A fixture designed to produce scatter.** Same reasoning, opposite failure.~~
    **Built as fixture 013, several-problems: six months of runway, the only backend engineer
    interviewing elsewhere, 40% of revenue renewing in four months, and onboarding that costs three
    weeks per customer. Four problems wearing one question, sharing no constraint, so each stance
    should answer a different one and no cluster should reach two.**

    The dangerous outcome is not scatter, it is a confident recommendation. Without the rule the
    highest pass A total ships as the answer and the other four read as also-rans rather than as the
    evidence that the question was never one question.

    Also awaiting a run, and also more interesting if it fails: two frames converging on the engineer
    would mean a problem built to have no shared constraint has one anyway.

    Both fixtures were caught by `adhd lint` on the first draft — three patterns were satisfiable by
    quoting the prompt, including the negative control — and rewritten onto the inference rather than
    the restatement.
13. ~~**A cancel fixture** (D5). Confirm, return two branches, cancel, and assert the partial
    synthesis ships unscored with the pruned block absent and said to be absent.~~
    **Already built and found open by the audit in item 83, as three kernel tests rather than a fixture
    — "cancel mid-diverge renders the returned branches unscored (D5)", "a cancelled run ships no pruned
    block and says why, rather than omitting it quietly", and "cancel before confirm spends nothing and
    renders nothing". That is the right home for it: a fixture asserts what a recorded run *said*, and
    this is a claim about what the kernel *does*, which needs no model and runs on every commit.**
14. ~~**A fixture whose problem contains an injection attempt** ("ignore the frame above").
    Asserts the branch contract holds against adversarial problem text.~~
   **Built as fixture 008, asserting the D5 gate rather than a run. Building it found the detector caught only injections phrased in this repo's own vocabulary.**
15. ~~**A fixture with a very long problem** (several thousand words) to exercise brief size.~~
    **Built as fixture 010, 5,014 words, and it asserts the compiler rather than a run — the precedent
    008 set. Largest brief 32,496 bytes, five of them per run. Verified against the failure it is for:
    truncating the problem to 200 characters in the compiler fails it on every frame.**
16. ~~**A fixture whose problem is one word.** The compiler should still hash and dispatch it.~~
    **Built as fixture 009, "Retries?". The risk at this size is not truncation but *expansion* — every
    instinct says a terse prompt needs helping — and a substring check cannot see it, because "What
    should we do about Retries?" contains "Retries?". The check compares the fenced problem block
    exactly instead, allowing one trailing newline for YAML's block scalar and nothing else. Verified:
    a compiler that expands a short problem fails this fixture and passes the substring version.**

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
    unit test for the frame's own stance. **Still open, and the scope is now known: twelve
    fixtures, and one frame that cannot have one.**

    **Built first, because it had to be: `adhd frames --reach`.** `--stats` and `--axes` count what
    recorded runs did, and a frame missing from both is either unlucky or unreachable. They cannot
    tell you which, and the difference decides everything — an unlucky frame needs a fixture, an
    unreachable one can never appear in a run anyone starts. So `--reach` asks routing instead of
    the corpus: every run class at its own default `n` plus the floor and the hard cap, 400 seeded
    shuffles each, through `selectFrames` itself rather than a re-implementation that could agree
    with a bug in it.

    **`FIRST_PRINCIPLES` is unreachable at every class's default n.** It is an alternate in six
    classes and primary in none, and its axis (`mechanism`) is held in primary lists by `MECHANIC`
    — a primary is drawn before any alternate, so the axis is taken every time. It appears only at
    `n=9`, the hard cap, which needs an explicit `n` in the decision. A fixture states a class and
    lets routing choose, so this frame cannot have one. `--stats` had reported it as never
    dispatched and there was no way to tell that from bad luck across eleven runs.

    **And the finding is proved rather than sampled, which is a different claim.** A frame reachable
    on one seed in ten thousand reads as unreachable at any seed count you can afford, so "did not
    turn up in 400 shuffles" and "cannot turn up" look identical in a report and are not the same
    thing. This one is structural: alternates are appended after the primary list, every run class's
    default `n` is at most the length of its primary list, so no class reaches an alternate at
    default `n` at all — and a frame in no primary list is unreachable there for every seed there
    is. `--reach` says which kind of claim it is making, `proved_unreachable` carries it, and a test
    checks both premises and that widening one class's `n` past its primary list ends the proof for
    every frame. (Sampling agreed anyway: 0 hits in 120,000 class/seed combinations.)

    Five tests pin it: that the report obeys D6 because it runs the real selector, that every frame
    primary for a class is reachable at that class's default n unless a same-axis frame sits earlier
    in the same list, the FIRST_PRINCIPLES finding itself — which fails when routing gains a
    class where it is primary or `MECHANIC` moves off `mechanism`, both of which make this record
    stale. A fourth checks every fixture names a class that can dispatch something.

    Left open as item 85, because it is a decision.
85. ~~**What to do about `FIRST_PRINCIPLES`** (owner's call). `adhd frames --reach` establishes that
    no class dispatches it at its default `n`. Three ways out and they are not equivalent.

    Make it primary somewhere — but the only class whose primary list has room on the `mechanism`
    axis is one where `MECHANIC` is not primary, and putting a from-scratch derivation frame into
    `design_decision` or `strategy` displaces something already earning its place.

    Give `mechanism` to one of them and move the other — the stances are genuinely different
    (`MECHANIC` asks how the thing works, `FIRST_PRINCIPLES` refuses to look at how anything works)
    and sharing an axis may simply be wrong. That is a D6 question and wants the orthogonality
    check, which currently has no data on the pair because they have never co-occurred.

    Retire it, per `docs/RETIREMENT.md`. The exemption there is real and may apply: a frame that
    produces the question nobody else asks is doing its job even when pruned. But this one has
    never run, so there is no evidence either way — which is itself the argument for one of the
    first two before the third.

    **The second option does not fix the thing this item is about, and `--reach` already said so in
    the sentence under the table.** FIRST_PRINCIPLES is unreachable because it is in no class's
    primary list, not because it shares an axis. Checked directly: every one of the six run classes
    has `n` at or below its primary length — five at 5 of 5, `enumerate_options` at 7 of 9 — so
    alternates are appended after a list that is already long enough and no seed ever draws one.
    Give `mechanism` to MECHANIC alone and put FIRST_PRINCIPLES on an axis of its own and it is
    still in no primary list, so it is still never dispatched. The axis was never the binding
    constraint.

    That leaves the split defensible on its own terms and not as a fix: the stances really are
    different, and `frame_hash` covers `axis`, so splitting changes FIRST_PRINCIPLES's hash and
    nothing else — MECHANIC keeps `mechanism`, and no recorded run contains FIRST_PRINCIPLES, so the
    comparability cost is zero. What it cannot have is D6's orthogonality check, which needs the two
    frames to have co-occurred and they never have. So the split is a judgment about the stance text
    with no data behind it, and making FIRST_PRINCIPLES *reachable* is a separate decision that
    still costs what option one costs: a primary slot, taken from a frame currently earning it.~~
    **Resolved as D35, and neither of the first two options was the answer on its own.** The axis
    is split — `derivation`, because MECHANIC asks how the thing works and this frame refuses to look
    at how anything works — and that fixed nothing, because the frame was unreachable for sitting in
    no primary list rather than for sharing an axis. It is now a sixth primary in `strategy` at
    `n: 6`, displacing nothing: `PRIOR_ART` was the obvious frame to demote and is protected by
    RETIREMENT.md's five-run floor and its pruned-but-asking exemption, so demoting it would have
    destroyed the evidence needed to judge it. The bill is spend instead — a `strategy` run is six
    branches and the D5 preview quotes about 624,000 tokens. `adhd frames --reach` now reads "every
    frame is reachable at some class's default n".

20. **Probe ordering experiment.** Do the numbered probes change the answer if reordered?
21. ~~**Forbidden-list audit.** Which `forbidden` entries have ever been violated in a real run?~~
    **Built as `adhd frames --forbidden`, and the answer to the question asked is one: MECHANIC forbids
    "conventional" as support and used it in `002-first-run` and `002-kernel-enduser`.

    The answer worth having is the other one. **35 of the 39 entries have no mechanical form at all** —
    "Answering the literal question", "Costing only the asker's side of the ledger" — so they are
    instructions to a model that this repository states and never checks. That is the shape D13 lost a
    rule in and the shape `cut_heldout.py` reached a wrong conclusion in, and it is now counted rather
    than assumed. An entry binds only its own frame, because a phrase in someone else's artifact is not
    a violation of it.

    Writing the extractor produced a small instance of the same failure: a 40-character cap on quoted
    phrases silently dropped FRAME_BREAKER's rule at 42 characters, so the audit *undercounted* what
    could be tested — the one number it exists to produce. Caught by reading the output rather than the
    count.**
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
69. ~~**Decide whether to tell the critic it may refuse** (owner's call). Nothing in `prompts/` mentions
    refusing, and a test asserts that, so today the handler only catches a refusal a critic produces
    unprompted. Offering one explicitly is a change to the product with a real cost: an escape hatch a
    critic is told about is easier to take than scoring, and the critique phase is where T1 gets caught.
    The argument for is that a critic with no way to say "these two artifacts are byte-identical" will
    invent a score instead, which is worse than refusing. Neither side is settled by anything recorded.~~
    **Decided as D32: leave it unmentioned.** The critique phase is where T1 gets caught, and an escape
    hatch a critic is told about is easier to take than scoring. The counter-argument is recorded
    rather than dismissed — an invented score is worse than a refusal — and what settles it is that
    the capability already exists unadvertised: `criticRefusal` recognises an unprompted refusal in two
    shapes. So the choice was only whether to advertise it, and not advertising it means a critic
    reaches for it when scoring is impossible rather than when it is hard.

29. ~~**Detector output quality check.** Some evidence strings are one clause. Set a floor and
    reject pass B if a fired trap's evidence is under N words.~~
   **Built. Floor set from data: real fired evidence runs 29 to 50 words.**
60. ~~**Rewrite the two ceiling dimensions (v1 rubric).** `foreclosure`'s anchor 0 is half
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

    **The cost is larger than this item states, measured rather than argued.** Dropping
    `foreclosure` and bumping `version` was tried on 2026-09-14 and reverted. `validatePassA`
    rejects any dimension the *current* rubric does not list, so all seven recorded runs stop being
    readable — not non-comparable, unreadable: "critic pass A: A.foreclosure is not a rubric
    dimension" for every letter of every run, and 13 tests fail across `replay`, `learn`, the rubric
    linter and the corpus rollup. Every tool that reads a recorded run breaks, `adhd why` and the
    viewer included.

    So this item is blocked on a mechanism it never named: validating a recorded run against the
    rubric version it was scored under rather than the one on disk. `score.json` already records
    `rubric_version`, so the fact is there and nothing reads it. Three shapes, and the choice is the
    owner's because each says something different about what a rubric version is: mark the dimension
    `retired: true` and keep it in the file, excluded from scoring and from the critic brief but
    accepted in old pass A files, which keeps one file as the whole record and means "dropped" is
    not quite what happened; split the rubric into versioned files and validate against the run's
    recorded version, which is honest and duplicates 140 lines per version; or store the dimension
    list in each run's own record, which is the most correct — a run carries its own contract — and
    leaves the seven already-recorded runs with nothing to validate against.~~
    **Half done as D34, and the half that landed is not quite what was asked.** `foreclosure` is
    **retired** rather than deleted — `retired_in: 1` in the rubric, excluded from scoring and from
    the critic brief, still accepted in the pass A files of the runs that were scored with it. The
    item priced deletion as non-comparability and it was unreadability: `validatePassA` rejects a
    dimension the current rubric does not list, so all seven recorded runs stopped being readable
    and thirteen tests failed across `replay`, `learn`, the rubric linter and the corpus rollup.
    Every run now carries `rubric_version` in its plan and is scored with the dimension set that
    version declared, so a later retirement cannot rescore the archive. `reasoning_carries` is
    untouched; the item's other half is open and item 92 carries it.

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
33. ~~**Token budget enforcement.** Halt a run that exceeds N tokens and render partial.~~
    **Already built and found open by the audit below. `submit --budget-tokens` sets it, `budget_tokens`
    is on the run record, `overBudget` sums what the tasks reported and `cancelLocked` ends the run with
    "token budget exceeded: N reported against a ceiling of M". Tested in `test/os.test.ts`.**
34. ~~**`adhd os stats`.** Throughput, mean phase duration, expiry rate across the journal.~~
    **Built. Over five kernel runs the longest task the journal has seen is 280s (`critique_b`),
    against a 900s default lease — so the default is roughly 3x the worst observed task, which is
    a defensible margin and is now a measured one rather than a guess. No lease has ever expired
    in a real run; the reclaim path is exercised only by `test/concurrency.test.ts`.**
35. ~~**Run priority.** Two queued runs, one urgent.~~
    **Already built and found open by the audit below. `priority` is on the run record and `claim` sorts
    `b.priority - a.priority || a.created_at.localeCompare(b.created_at)`, so an urgent run jumps the
    queue and ties still go to the older run. Tested in `test/os.test.ts`.**
36. ~~**Journal compaction** for long-lived kernels.~~
    **Already built and found open by the audit below: `adhd os compact` moves journal lines belonging
    to finished runs into a dated archive beside the journal. Tested in `test/os.test.ts`.**
37. ~~**A worker that returns malformed YAML on purpose**, asserting the contract failure is
    more useful than a silent repair.~~
    **Built as `test/malformed.test.ts`, five tests over the four shapes of garbage a worker can
    return. The useful part is what it found rather than what it confirmed.**

    **Confirmed: the pruned block is more useful than a repair would be.** An unparseable branch is
    dropped from the scored set, and the user's pruned block names the frame, says "no valid
    artifact", and carries the YAML parser's own message down to `line 1, column 12`. A reader can
    open that artifact and look at that character. The run finishes on the other four.

    **Found: the abort message named the wrong cause.** `validateBranchArtifact` throws
    `HashMismatch` the moment `problem_hash` is not the expected string, and `String(got)` turned an
    *absent* hash into "got undefined. Paraphrase drift. Run invalidated." Prose, an empty artifact
    and a document of the wrong shape all aborted under an accusation none of them had earned, and
    paraphrase drift has a specific meaning and a different fix. `HashMismatch` now takes `unknown`
    and distinguishes the two: a hash that is *different* still reports drift, a hash that is
    *missing* reports contract failure and says it is not drift. Both still abort — behaviour is
    unchanged, only the diagnosis is true now.

    **Not built: a `--malformed` flag on `test/worker.ts`.** That worker exists for multi-process
    contention, and nothing about malformed YAML is about contention. The flag would have been
    surface area with no claim behind it.

    Left open as item 84, because it is a decision rather than a defect.
84. ~~**Should an unparseable branch artifact abort the run** (owner's call). Item 37 found the
    severity inverted and did not change it. A branch that returns *valid* YAML with no
    `problem_hash` aborts the whole run; a branch whose YAML will not parse at all costs one
    branch and the run continues with four. Both are "the worker returned garbage", and the
    lenient case is the one where less is known — an unparseable artifact cannot be shown to have
    addressed this problem either, which is the exact argument the abort rests on.

    The case for leaving it: pruning is what the pruned block is for, four branches is a real run,
    and aborting on one bad parse hands a whole run's spend to one flaky subagent. The case for
    changing it: `monoculture_fraction` is 0.8, so dropping a branch moves the denominator — four
    of four is a monoculture where four of five is exactly at the threshold, and the arithmetic
    changed without anyone deciding it should. Whichever way it goes it wants a D-number, because
    the current split reads like an accident and `test/malformed.test.ts` currently pins it as
    intent.~~
    **Decided as D30: both abort.** The lenient case was the one where less is known — an artifact
    that will not parse shows strictly less than one carrying no hash, which is not a wrong answer to
    the right problem but no answer at all. And pruning moved the monoculture denominator silently: a
    cluster of four is a monoculture at n=4 and sits exactly on the 0.8 threshold at n=5, so a run
    that lost a branch to a parse error was scored under a rule its plan never declared.

    `UNPARSEABLE` is a separate code from `HASH_MISMATCH` because the fixes differ, the parser's
    message still reaches the reader down to the column, and the abort reason states why it is an
    abort rather than a prune. The cost is accepted and recorded: one flaky subagent now ends a run
    that has already paid for four branches.

## 6. CLI and reporting

38. ~~**`adhd why <run> <frame>`.** Print exactly why a frame was pruned, with the detector
    output and the pass A row.~~
    **Already built and found open by the audit below. It also answers the case this item did not think
    of: a frame that was never dispatched reads "A frame that was never asked cannot have been
    rejected", with the set routing chose instead. `src/why.ts`, `test/why.test.ts`.**
39. ~~**`adhd diff <runA> <runB>`.** Two runs of the same fixture, side by side: which frames
    survived in both, which findings are shared, which are seed artifacts.~~
    **Already built and found open by the audit below. `src/cli.ts` declares it, and the description it
    ships with is the item's own sentence: "what survived, what moved, what was the seed".**
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
68. ~~**Recalibrate `tokens_per_branch_estimate`** (owner's call). `adhd cost` shows the D5 preview
    quoting about a third of what a run costs, consistently across seven runs. Setting the mean
    ratio to 1.0 means half of future runs come in over the quoted figure, which for a consent
    gate may be worse than a high quote that is never exceeded. The alternatives are a point
    estimate at the mean, a point estimate at the observed maximum, or a range in the preview
    text. All three change what the gate promises a user, which is why this is not a number to
    pick while nobody is looking.~~
    **Decided as D32: the observed maximum.** `tokens_per_branch_estimate` 12,000 -> **51,000**, so a
    five-branch preview reads 520,200 against the worst recorded run of 519,482, and the label is now
    "up to" rather than "order of magnitude" — which described the old figure honestly and was not an
    estimate. The shape was wrong too: the critic was priced at `tpb * n` against a measured 30/49, so
    it was over-weighted by a third while diverge was under-weighted. Components are proportions of the
    measured split now. `adhd cost` prices the current config beside the historical ratio, because the
    recorded estimate is what each run was quoted and that number never changes.

42. ~~**TTY colour and progress** for `adhd os` while a run advances.~~
    **Already built and found open by the audit below. `src/tty.ts` carries the colour table, a
    `Progress` line that redraws in place and one line per change when piped, and `stateColour` so a
    terminal state is the one worth spotting; `adhd os watch` uses all three. `NO_COLOR` is honoured
    because it is the convention every other tool honours. `test/tty.test.ts`.**
43. ~~**`--json` on every command** that lacks it, for scripting.~~
    **Built. `run`, `traps`, `viewer` and `validate` gained it; `wizard` is interactive and is
    excluded on purpose. `run --phase compile --json` returns `run_dir` and the briefs to spawn,
    which meant widening `PhaseResult`: the run directory was only ever in the prose, so a driver
    had to match a path out of a sentence. `traps --json` carries the exit code rather than
    replacing it. A test asserts no non-interactive command is missing the flag.**
44. ~~**`adhd lint <fixture>`.** Check a fixture's regexes compile, and warn on patterns that
    match the fixture's own `why` text (a common way to write an assertion that cannot fail).~~
    **Already built and found open by the audit below, and it checks more than this item asked: every
    pattern compiles, none matches everything, none uses a bare dot as a separator, and none is lifted
    from the fixture's own prose. Naming a file rather than a fixture id prints the eight it knows.**

45. ~~**Exit codes** that distinguish contract failure, hash mismatch, and eval failure.~~ Built, documented in the README, tested against the built binary.

86. ~~**The MCP server had stopped offering what the CLI offers.**~~
    **Found while wiring `--reach` in item 19. `adhd frames` has seven report modes on the CLI and
    `adhd_frames` accepted five: `--drift` and `--forbidden` had been added to one surface and not
    the other, so a host could see five of the seven reports this repository can produce with no way
    to learn that two were missing. CLAUDE.md ships the MCP server as "the same four as stdio tools",
    and "the same" had quietly stopped being true.**

    All three are wired now, each with its description, and a test reads the modes out of
    `src/cli.ts` itself rather than from a list kept beside it, a hand-kept list being a third thing
    to forget. A second calls all seven through MCP and asserts they return seven *different*
    reports, because a wiring bug that fell through to the default listing would pass every other
    check.

    **Generalising that test found the same gap on `adhd_eval`, which was worse.** It accepted three
    directory arguments and none of `--audit`, `--history` or `--gate` — so a host driving evals over
    MCP could replay fixtures and could not gate on a regression, which is the one thing a host would
    want the command for, and could not run the audit that says whether an assertion discriminates a
    real run from its control at all. All three wired.

    `--update`, which rewrites the gate's baseline, is deliberately withheld: a gate whose baseline
    the caller can move is not a gate, and a host is exactly the caller who would move it by
    accident. The CLI keeps it, where a person types it on purpose. The test names the withholding
    rather than skipping it, because a deliberate omission and a forgotten one look identical from
    outside, and it asserts the tool description explains it where a host actually reads.

    Verified by deleting each in turn from the MCP schema: the test fails and names the mode.

## 7. Documentation

46. ~~**A worked example**, end to end, with the actual commands and the actual output.~~
    **Built as `docs/WORKED-EXAMPLE.md`, seven sections over `001-first-run`: compile and the D5
    gate, the brief one branch is handed, what it returns, `adhd traps` on it, `adhd why` on a frame
    that lost, the pruned block in full, `adhd eval` against the linear-CoT control, and `adhd diff`
    against seed 2.**

    **Every block is output I ran, and two tests keep it that way** — one comparing the quoted hash,
    pruned-block bullets and brief opening against the files on disk, one checking that the brief the
    document calls isolated names no sibling. A document whose entire claim is "this is what it
    printed" rots the moment a detector is reworded, and rereading it is not a check.

    The section that earns the document is the last one. Same problem, same frames, seed 1 against
    seed 2: both survivors are pruned in the other run and the recommendation changes. The worked
    example ends on evidence against itself, because eleven runs is not a sample and items 3 and 4
    are what would make it one.

    **Found while capturing output: `adhd replay <dir>` and `adhd replay` disagreed about the same
    run.** The all-runs form says "drifted as the baseline records" and gives the reason; the
    single-run form said "DRIFTED" and exited 0, so a reader checking one run got an alarm and a
    success code together. The exit code had consulted `expected_drift` from the start and only the
    printed line had not. Fixed, with a test on both spellings and one that keeps unexplained drift
    shouting.
47. ~~**FAQ**, starting with "why not just prompt the model to consider multiple perspectives".~~
    **Built as `docs/FAQ.md`, opening with exactly that question. Seven answers, each with the evidence
    attached and every number checked by an existing test — including the ones that are least flattering:
    a run costs about 460,000 tokens against a gate that quotes a third of it, `foreclosure` scores an
    alpha whose interval spans zero, and eleven recorded runs is thin.**
48. ~~**A frame-authoring guide** with the orthogonality check as a checklist.~~
    **Built as `docs/AUTHORING-FRAMES.md`. Six steps with the orthogonality check as step five, and the
    bar stated before any of them: the question is not whether a stance is good but whether its axis is
    empty, because seven of the ten axes carry one frame and a fourteenth on a shared axis makes the
    library worse rather than larger. Also what the check cannot tell you — it flags one pair today and
    lists six more at 100% that it refuses to flag on one or two shared runs.**
49. ~~**A short paper-style writeup** of what five runs have shown, honest about the sample size.~~
    **Built as `docs/WRITEUP.md`. Written at eleven runs rather than five; the extra six did not change
    the shape of the answer. Claim, method, what holds, what does not, and what would change it.**

    **The "what does not hold" section is longer than the other one and that is the finding.** Fixture
    001 has passed once, in the run it was written against. Two critics on the same pack agree on 79%
    of cells and change the ranking in all five runs, once changing the shipped representative. All
    four contested decisions were settled by two anchor points or fewer out of 48, and two by exactly
    one — so `--sensitivity`'s "no representative changed under ±1" reads as stability and is the
    opposite. Two dimensions sit at 91% and 94% ceiling with two distinct values ever used, carrying
    weight and separating nothing. A run costs 2.6x to 3.3x its estimate, and the D5 gate quotes the
    estimate.

    **Guarded rather than reread.** `test/docs.test.ts` recomputes the agreement, the cell count, the
    contested-decision count, the widest margin, the run counts and the test count from the same
    functions the CLI calls, and fails when any of them drifts. Verified against a doctored copy: a
    79 changed to 82 and a 225 changed to 200 both fail. A writeup whose unflattering numbers have
    gone stale reads as honesty and is not, which is the failure mode worth a test.
50. ~~**Failure gallery**: every recorded failure, why it failed, and what it taught.~~
    **Built as `docs/FAILURES.md`. Six of eleven recorded runs fail and four of those are supposed to —
    linear-CoT controls, where a pass would mean the fixture is broken. The two real failures are
    `001-seed2`, which loses two assertions the same fixture passes at seed 1 and is the strongest
    evidence here that five runs is not a sample, and `002-first-run`, which names a hole in the frame
    library that `002-kernel-enduser` then closes. Also what has never failed: no run has ever missed on
    `problem_hash` or shipped without a pruned block.**

## 8. Distribution

51. **Publish to npm** under a scoped name.
52. ~~**A GitHub Action** that runs `adhd eval` on every PR touching `config/` or `prompts/`.~~
    **Already built and found open by the audit in item 83. `.github/workflows/library.yml` is
    path-filtered on `config/**`, `prompts/**`, `evals/fixtures/**` and `agents/**`, and it is separate
    from `test.yml` on purpose: the reports it runs are evidence rather than gates, and gating a PR on a
    co-clustering rate is the thing `docs/RETIREMENT.md` explicitly says not to act on.**
53. ~~**A one-command demo** that runs a fixture from a clean checkout.~~
    **Already built and found open by the audit in item 83: `npm run demo` runs `scripts/demo.sh`. It is
    honest about the one thing it cannot do — D2 means the package never calls a model, so a demo cannot
    produce a run, and what it shows is everything either side of that boundary.**
54. ~~**Plugin agents exercised as plugin agents.** Every recorded run so far used
    general-purpose subagents; the shipped agent definitions are untested in their real role.~~
    **Done, on rung 2 of D38's ladder.** Three branches of run `20260915065417-7e664e` were dispatched
    as `adhd-branch-search` — a shipped plugin agent, declaring its own grant, launching under its own
    definition — and returned three valid artifacts with zero contract violations at critique. That is
    the first time in the project that a branch ran on an agent whose grant **cannot reach a sibling
    artifact**, which is the property the item was really about: `general-purpose` carries `Read`, and
    every earlier run used it.

    Not fully closed by this, and the remainder is item 93: `adhd-branch`, `adhd-critic` and
    `adhd-deepen` themselves still cannot launch in this host, because it resolves neither name in
    their permit. Rung 1 is unexercised. What changed is that the isolation guarantee no longer
    depends on rung 1 existing.

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

## 10. Raised after the first pass

Everything below was added once the numbered sections above were written, and until now it sat
under section 9 with no heading of its own. That section is titled **Hygiene, done** and opens
"Findings from a full sweep, all fixed", so sixteen open items — six of them decisions waiting on
the owner — were filed under a heading asserting they were finished. Nothing read them as open
because nothing had to: a reader trusts the heading, and so did every count of what was left.

Section 9 is a record of fixes rather than a list of work, which is why its entries are not struck
through: there is no original ask to strike, they were written as findings. That is fine and it is
also exactly what let this happen, because an unstruck entry there looks like an open item to
anything counting. The guard is in `test/docs.test.ts`: **a section whose heading claims *done* may
not be the one holding the file's highest-numbered item.** New items are appended at the end, so if
the end is a record section they have been mis-filed — which is the whole of what went wrong here.

70. ~~**Two fixture assertions that `adhd lint` flags** (owner's call). `002/or_so_noticed` matches
    `or so`, which is in 002's prompt verbatim, so any branch quoting the question satisfies an
    assertion meant to check the imprecision is *treated as evidence* — and the negative control
    holds it too. `003/one_way_door` lists `reversib` alongside `irreversib`, so the second can
    never be the alternative that matches. Neither is changed here. Tightening an assertion after
    seeing what it does is the mirror image of the loosening D6 refuses, and both would move a
    recorded outcome: 002 currently holds `or_so_noticed` on both its runs.~~
    **Both fixed, and the cost this item warned about did not exist.**

    `002/or_so_noticed` drops `or so`. `003/one_way_door` changes `reversib` to `\breversib`, which
    is the sharper reading of what `adhd lint` was pointing at: the bare form matches inside
    *ir*reversible, so one pattern covered a two-way door and a one-way one — words that mean
    opposite things in an assertion about which is which. The boundary separates them because
    "irreversible" has a word character before `reversib` and "reversible" does not.

    **No recorded outcome moved.** The item predicted one would, and it was wrong twice over. First,
    `002-first-run` matched `or so` *and* `drift`, and `002-kernel-enduser` matched `jitter`, so the
    four patterns that remain were already carrying both runs. Second, the item says the negative
    control holds the assertion too; `adhd eval --audit` had it **discriminating at 2/2 against 0/1**
    before the change and after it. The control never reached for the imprecision at all.

    `adhd lint` is clean on all fourteen fixtures, `eval --gate` passes unchanged, and the test in
    `test/fixtures.test.ts` that pinned these two warnings as deliberate now pins their absence —
    including that 002's *prompt* still says "or so", because a prompt is evidence and is never
    edited to suit an assertion.

71. ~~**Config overlays** (owner's call). `adhd init` copies the shipped library, which forks it: a
    team that scaffolds has no way to pull later improvements. An overlay would fix that and its
    merge semantics are a genuine decision, not a detail. Does an overlay frame reusing an id
    replace the base frame or fail loudly? Does a routing class merge its `frames` list or replace
    it? Each answer changes what `frame_hash` means for a run under a merged library, and one of
    them quietly makes the drift report unable to say which definition ran.~~
    **Built as D33: a reused id replaces the base definition whole.** `config/overlay.yaml`,
    `$ADHD_OVERLAY` or `--overlay <file>`. Frames, routing classes and rubric dimensions merge by id
    and nothing merges field by field, because `frame_hash` exists to answer "is this the same
    definition" and a field-wise merge makes the answer depend on two files and an order.

    The cost was chosen rather than overlooked: changing one probe means restating the stance, the
    attacks, the tools and the forbidden list. Verbose on purpose — a one-line stance override is
    exactly the edit whose provenance nobody can reconstruct later.

    The provenance question the item raised is answered on the plan: `overlay: { path, hash,
    replaced_frames, added_frames }`, or null on the shipped library, which separates "this definition
    changed since" from "that install runs an overlay". `adhd doctor` says both in two lines.

    Two things the build found. A merged library is cross-checked as a library — the overlay applies
    *before* `crossCheck`, so a routing class naming an undefined frame fails at load. And reporting
    every restated definition as a replacement defeats the report: the first version called all ten
    rubric dimensions replaced when one weight moved, so frames now compare by `frame_hash` and the
    rest by canonical JSON. An overlay that edits the rubric without moving `version` is refused,
    because two installs writing the same `rubric_version` over different weights makes every
    cross-install pass A total look comparable when it is not.

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

76. ~~**Re-measure what pruning costs, on one split** (small, and it invalidates a published figure
    until it is done). D14 priced count-pruning at 2.9x perplexity — 17.4 against 6.06 — and D16
    establishes that both of those are memorisation scores, because each model trained on the whole
    manifest and was scored on a stride of it. The ratio between two numbers that measure nothing
    about unseen text is not a measurement of anything.

    The fix is two runs on one split: order 4 with `--held-out-every 20`, once with the n-gram
    ceiling low enough to force pruning and once without, scored on the same held-out half. About 25
    minutes. The prediction, recorded here so it can be wrong: the real cost is **larger** than 2.9x,
    because a pruned model has less of the tail to memorise and also less to generalise from. Until
    this runs, `agents/adhd-governor.md` says not to quote 2.9x as measured.~~
    **Done, as D29. The cost is 1.355x and the prediction above is wrong — not by a little, and not in
    the direction it guessed.**

    Unpruned **25.815**, pruned **34.973**, at 40.8% of the n-grams (`prunes` 2). The pair differs in
    nothing else: same corpus digest `de7c24b2218ad055`, same 64,347,232 tokens, same 148,114 types,
    same frozen set, and out-of-vocabulary rates identical to every digit — pruning removes n-grams,
    not types, so both models are asked the identical question and `comparable_heldout` accepts them.

    **Why the prediction failed is the result.** Pruning deletes the n-grams seen exactly once. On a
    memorisation test those are precisely what the score asks about, so deleting them looks
    catastrophic and 2.9x is what that looks like; on unseen text a singleton was mostly not going to
    recur anyway. D14's 2.9x measured how much memorisation the pruning destroyed, which is what D16
    had already said those two numbers were made of. I reasoned about the memorisation case without
    noticing, and predicted the cost would be *higher*.

    **Two things the run needed on the way.** `--max-ngrams` does not truncate the corpus read as its
    name suggests — it triggers count-1 pruning, which took reading the counting loop to establish.
    And nothing on the training record said whether a model had been pruned, so `ngrams` alone could
    not tell a small model from a pruned one; `TrainingRecord.prunes` carries it now. The original b76
    models on disk are superseded rather than scored: they predate the corpus fingerprint and read
    text differing by 846 tokens and one type, which `comparable_training` would refuse.

77. ~~**Separate the vocabulary half of the generalisation gap** (small). D17 measures 2.83x between a
    model that read 584 PEPs and one that read none, on the same 31 documents, and OOV goes 1.36% to
    2.96% across that pair. Part of the gap is that the never-seen model lacks PEP-specific words and
    part is that it models PEP prose worse, and this run does not say which is which.

    `genericity.py` already computes surprisal over in-vocabulary tokens only, with the OOV rate
    beside it, for exactly this reason. `evaluate.py` does not. Adding the same option there and
    re-scoring the two models on the same 31 documents settles it in about two minutes of compute. No
    prediction recorded, because either answer is interesting: mostly vocabulary would say the model
    generalises better than 2.83x suggests, and mostly modelling would say worse.

    **Two corrections to this item, both found while doing it.** `evaluate.py` already had
    `in_vocabulary_only`; the sentence above was stale. And the method it proposes is the one D25
    forbids: scoring both models `in_vocabulary_only` at 1.36% and 2.96% OOV means each sums over *its
    own* in-vocabulary targets, which is two tests rather than two scores, and `comparable_heldout`
    refuses exactly that.

    **Worse, D25 retroactively refuses D17's own pair.** The gap is 1.60 percentage points against the
    0.53 those perplexities can carry, so `comparable_heldout` returns None no longer — it returned None
    when D17 was written, which is why nobody noticed. By E8's slope the vocabulary difference alone
    could account for **8.2 of the 99.2-point difference, 8.3% of it**, so the finding is very likely to
    survive; it is not currently defensible as stated.

    `evaluate(shared_vocabulary=...)` is the method that works: hand both models one set of words and
    both sum over the same targets, so a difference in their own OOV rates no longer means they were
    asked different questions. Built and tested.

    **And then reading the two models' headers found the real problem: the pair was never controlled.**

    | | `nopep.kn.gz` | `background.kn.gz` |
    |---|---|---|
    | read PEPs | no | yes, 584 |
    | `min_count` | **2** | **3** |
    | split | **None — the whole manifest** | frozen `8e2d77cbe8901b1e`, train side |

    `min_count` is a second independent variable and it moves the thing the comparison is about: a
    model at 2 keeps every type seen twice, so `nopep` carries *more* rare words than `background`
    does, which partly offsets the PEP words it lacks. The 1.36%-against-2.96% OOV gap is that
    difference and the PEP difference added together, and D17 attributes all of it to PEPs.

    **Closed as D31: 3.036x, and the gap widens under restriction rather than shrinking.** All
    targets 53.422 against 147.467 (refused, 1.57% OOV against 3.14%); restricted to the 141,899 types
    both models share, **49.066 against 148.983**, comparable. `shipped` *falls* when the 6,215
    PEP-only types are dropped, so those words were harder than its average even though it had read
    them; `nopep` *rises*, losing the `<unk>` targets that were cheap for it. Mostly modelling, and
    the vocabulary was flattering the weaker model — D17 understated its own finding.

    Remaining confound, recorded: `nopep` read 4.1% less text, because removing a source removes its
    words. Smaller than E9's 3.5x asymmetry and not zero.

    What follows below is the analysis that led here, kept because the diagnosis is the work.

    So the re-score could not close this item on its own. `nopep` had to be retrained at `min_count` 3 on
    the frozen split — matching `background` in everything except the source under test — and both are
    pre-D26 anyway, so they read the repository's own prose. About 15 minutes of compute, queued behind
    E9's cell D because an order-4 Kneser-Ney peaks near 10.6GB and would take the transformer down
    with it.

78. ~~**Measure how much a percentage point of OOV is worth, and re-derive the threshold from it**
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
    the contexts those words provided, and the two effects work against each other.~~
    **Done as E8, and it is worth up to 5.1 perplexity points, so the round number was 3.3x too loose.
    Four caps on one corpus read: 30.95 / 35.52 / 39.31 / 42.77 at 5.797% / 4.044% / 3.063% / 2.391%
    held-out OOV, fit -3.391 points per point at r-squared 0.977. `allowed_oov_gap` scales with the
    perplexities in hand — 0.30 points at E8's own base — floored just above E4's 0.22-point gap and
    capped at the old 0.01 so the change tightens everywhere and loosens nowhere.

    Three corrections fell out, and two of them are about this repository rather than about OOV. The
    `<unk>` discount the comment blamed is real but changes sign near 3% OOV and is not the dominant
    term. This registration's own commit moved the corpus it was about, which is why models carry a
    `corpus_fingerprint` and why D26 exists. And **the pre-registered 2x linearity test does not
    discriminate**: the same four cells measure 2.005x of pairwise spread on the corpus with the prose
    in it and 1.972x without, straddling the line on a 0.105% change, so the threshold takes the worst
    case unconditionally as the conservative side of a coin toss. D25 has all of it.**

79. ~~**Price a transformer at the n-gram's vocabulary** (large, and it may not be reachable here).
    E6 holds the vocabulary at 8,192 because the output projection is `d_model x vocab_size` and every
    token's loss touches all of it. At the n-gram's 148,353 types that layer alone is 19M parameters,
    and by the measured 7,671 tok/s at 1.46M parameters the arithmetic puts one epoch over the
    training side well past a day. So E6 answers "which model class is better at 8,192 types", which
    is a real question and not the whole one.

    What would make it reachable is an adaptive or sampled softmax, which changes the loss the model
    optimises and therefore needs its own registration.~~
    **Done, as E9 and D28. It was reachable: sampled softmax at training time, the full normalised
    distribution at scoring time, because a sampled softmax when scoring is a different measurement
    wearing the same name. Cell D scores 142.408 against the shipped model's 25.815 — a 5.516x loss
    at 148,114 types — and `comparable_heldout` accepts the pair, which is the reading the cell
    existed for: both sit at 0.915101% out-of-vocabulary, identical to every digit.**

    **E6's open question is closed in the direction that strengthens it.** The 8,192 cap was not
    flattering the n-gram; at its own vocabulary the transformer loses by more, not less. Quoted with
    the figure everywhere: cell D read 3.51x less text, under a cap set before any result existed.

    **The `− log S` term was missing from the importance weight and no gradient check could have found
    it** — constant in the parameters, cancels from every derivative. The convergence test caught it:
    the estimator ran *away* from the full loss by exactly log S.

    Four defects surfaced only because the cell ran. A model this repository trained that it could not
    load (a 64MB per-line constant against a 204,355,608-byte `tok` line). A scoring default that
    would have reported 60 minutes of a 122-minute score as a perplexity. `shared_vocabulary`, built
    under item 77 for exactly this comparison, with no route from a shell. And `publish_record.py
    --name` silently writing an extensionless file that no test would ever read.

    One thing E9 registered was wrong and the machinery said so: the amendment claimed the cap bought
    a comparison against cell B at the same text and different vocabularies. Differing only in
    vocabulary is what makes two all-targets perplexities incomparable, and `comparable_heldout`
    refuses the pair. The shared-vocabulary rescue is exact, because cell B's 8,192 types are a strict
    subset of cell D's 148,114.

80. **Segment the scripts that are written without spaces** (large, and it needs a model rather than
    a regex). Chinese, Japanese, Thai, Khmer and Lao put no spaces between words, so a Unicode word
    class matches a whole run as one token: `评论者应根据反对意见修剪该工件` is a single type, and a
    30-character Thai clause is another. That is a wrong answer rather than a missing feature — the
    vocabulary fills with sentence-length types that never recur, and every one of them is `<unk>` on
    the next document.

    Two fixes exist and both are real work. A dictionary-and-longest-match segmenter needs a word list
    per script and gets Thai roughly right and Chinese roughly wrong. A character n-gram model over
    the target script segments better and is a second model to train, validate and version. Neither is
    a change to `tokenize.py`.

    **Worth stating plainly: the corpus is RFCs, PEPs, EIPs and ERCs, which are written in English.**
    Nothing in the current library exercises this, so closing it buys capability for a corpus that
    does not exist yet rather than accuracy on the one that does. That is the argument for it being
    backlog rather than a defect, and it stops being the argument the moment a non-English source is
    added to `corpora.yaml`.

81. ~~**Decide whether the repository's own prose stays in the training corpus** (owner's call, and it
    re-bases every published figure if it goes). `repo-docs`, `repo-prompts` and `repo-readme` are
    sources in `corpora.yaml`, so **writing down a measurement changes the corpus the measurement came
    from.** E8 hit this twice: its registration commit moved the type count 51 types off the number it
    had registered in advance, and writing up its result moved the retrain by one n-gram in 12.4M and
    one discount in its fourth decimal. D25 has the arithmetic and the reproduction records.

    The consequence is structural rather than a size: a corpus digest can never cover a state that
    includes its own description, so a published cell cannot be re-derived exactly while this holds.
    Today the drift does not reach two significant figures of any published number, and the frozen
    held-out set contains no repository prose at all, so nothing measured is wrong. It is
    reproducibility that is gone, not correctness.

    Three options, none free:

    - **Remove the three sources.** Reproducibility returns immediately. Every figure in the repository
      re-bases at once — 25.82, E6's four cells, E7's LSTM, this sweep — and each needs re-measuring or
      marking superseded, which is the D19 pattern and is expensive but honest.
    - **Freeze them.** Snapshot the prose as it stood, point the manifest at the snapshot, and let the
      live documents drift away from it. Cheap and it makes the corpus say something false about itself:
      a source named `repo-docs` that is not this repository's docs.
    - **Keep them and stop claiming reproducibility.** Record the drift per experiment, as D25 now does.
      Cheapest, and it means every future cell carries the same asterisk.

    Worth weighing against what the prose buys, which D10 cared about: it is the only source in the
    manifest whose licence is unambiguously this repository's own. It is also **0.105% of the manifest
    by bytes** — 369,505 of 351,101,283 — so what it buys is licence comfort rather than data.~~
    **Resolved as D26, by the first option. The three sources carry `mutable: true` in `corpora.yaml`
    and the trainers read `Library.stable()`; they stay in the manifest so a clean checkout still trains,
    behind `--include-mutable-sources`, which no measurement passes. The licence comfort is untouched
    because the entries remain. E8 is re-measured on the stable corpus; 25.82, E6 and E7 are marked as
    pre-D26 and item 82 is the re-measurement.**

82. ~~**Re-measure the pre-D26 figures on the stable corpus** (real compute, and nothing is wrong with
    them). 25.82, E6's cells A / A′ / B and E7's cell C all read the repository's own prose, which D26
    took out of every measurement. They are not incorrect — they read 0.105% more text than a run today
    would, and the frozen held-out set they were scored on never contained that prose — but they cannot
    be re-derived exactly, and a figure that cannot be re-derived is a figure nobody can check.

The cost, read off the records rather than estimated: **A 452s, the shipped model 817s, cell B 2,539s
    and cell C 1,514s** — about 90 minutes of training in total, plus scoring. An earlier version of this
    item said cells B and C were 3.6 hours between them, on the grounds that the transformer runs at 2.33
    hours per epoch. That figure is per epoch over the *whole* training side; these cells train under a
    20M-token cap, which is 42 minutes and 25 minutes. Wrong by 3x in the direction that makes work look
    unaffordable, which is the expensive kind of estimate to get wrong.

    A′ needs no run at all: `e8-v0` is order 4, `min_count` 3, cap 8,192 on the train side of the same
    frozen set, which is A′'s configuration exactly, so **A′ post-D26 is 30.95** already.

    Order matters if this is done piecemeal. E6's claim is A′ **against** B, so re-measuring one and not
    the other produces a ratio between a stable-corpus number and a mutable-corpus one, which is the
    comparability mistake `comparable_training` now exists to refuse. Either pair moves together or
    neither does.~~
    **Done as D27, and every conclusion survives. 25.82 → 25.82, A 19.9 → 19.94, A′ 30.7 → 30.95,
    B 64.1 → 64.29, C 159.3 → 154.81; E6's ratio 2.086x → 2.077x inside its 1.5–3x band and E7's
    2.485x → 2.408x. The shipped figure reproduced to two decimals across 73,496 fewer training tokens.
    Three defects turned up on the way and none were in the figures: D26 had missed `train_lstm.py`,
    `score_heldout.py` held two models at once and was OOM-killed, and two ReDoS bounds let quadratic
    blowup through. All three surfaced only because the run actually ran.**

87. ~~**The output contract cannot hold prose in its plain-scalar fields, and under D30 that ends a
    run.** Three of the five branches in run `20260914223732-7e664e` returned YAML that will not
    parse, all for the same reason: `falsifier` and `missing_actor` are specified as plain scalars
    and each branch wrote a second `: ` inside the value. DOOR_KEEPER wrote "A second, equally cheap
    falsifier: the would-have-retried counter", LEDGER wrote "Cheaper still: find one production
    incident report", FRAME_BREAKER wrote "Equally falsifying: if deadline-exceeded work is a
    rounding error". Each becomes a nested mapping in a compact mapping and the parser refuses it.
    ACTOR_CENSUS and MINIMALIST parse only because neither happened to punctuate that way.

    This is a defect in `prompts/branch.md`, not in the branches. `reasoning` is specified as a
    block scalar and is safe at any length with any punctuation; `position`, `falsifier` and
    `missing_actor` are the three free-text fields specified without one, and a colon-space
    anywhere in them is fatal.

    Every artifact in the eleven recorded runs parses, and counting them says why. Across 39 branch
    artifacts there are 117 values in those three fields. **None is folded. 106 are bare plain
    scalars and not one carries an internal `: `.** That is the whole of the protection: eleven runs
    of coincidence, broken on the twelfth by three branches at once. The remaining 11 values are
    quoted, which is the other way out, and exactly one of them needed to be — `001-seed2`'s
    ACTOR_CENSUS falsifier opens "Look at the inbound path for one hour of real traffic: if no
    caller sends a deadline". So quoting happens, unprompted, in 9% of values. It is a habit some
    branches have and not a property the contract secures, and that is the sharpest evidence that
    the contract is at fault: it shows these fields as bare `<placeholder>` text and branches copy
    the shape they are shown.

    D30's own record priced this as "one flaky subagent now ends a run that has already paid for
    four branches". The first real run after the decision lost three branches out of five to a
    systematic cause, and the run aborted having paid for all five. The decision is not wrong — an
    artifact that will not parse shows nothing, and scoring the parseable subset would score under
    an undeclared rule — but its cost estimate assumed independent flakiness and this is not that.
    At the observed rate a run of five aborts more often than it completes.

    Three candidate fixes, none of them free, and the choice is the owner's because it changes the
    product: specify the three fields as block scalars in the contract, which makes them safe and
    changes the brief every recorded run was produced under; keep the contract and quote the values,
    which pushes the same requirement onto the branch and will be forgotten the same way; or parse
    the three fields leniently in `validate.ts`, which keeps every recorded run comparable and puts
    a YAML-shaped guess in the validator, which is how a parser stops being a contract. The middle
    option is the weakest: it is what the contract already implies and three branches out of five
    did not do it.~~
    **Resolved as D37: every prose field is folded with `>-`.** `position`, `falsifier`,
    `missing_actor` and the `forecloses` items; `problem_hash`, `frame` and `confidence` stay plain
    because each is a closed vocabulary. The fix is free because it changes what the contract asks
    for and not what the validator accepts, so all 39 recorded artifacts still parse and nothing
    needs migrating — the opposite of what the same shape of change did to the rubric in D34.

88. ~~**`TaskList` is not a launch permit in every host, and in at least one it is not a launch permit
    at all.** D4 grants `adhd-branch`, `adhd-critic` and `adhd-deepen` exactly one tool, `TaskList`,
    on the reasoning that the host refuses to launch an agent with zero tools. Attempting to spawn
    `adhd-branch` in a Claude Code remote session refuses with "would be spawned with zero tools —
    refusing. Its tools list resolved to nothing: recognized but matched no tools in this session
    [TaskList]". The name is recognised and resolves to nothing, so the permit buys nothing and the
    three agents cannot be dispatched. Loading `TaskList` into the parent session first does not
    change it; subagent grants resolve against a fixed set that excludes it.

    `adhd-branch-search` launches in the same session without complaint and reports exactly
    `WebSearch, WebFetch` when asked what it holds. So the plugin agents are not broadly untestable
    and item 54 overstates it: the two web tools resolve, and the failure is specific to the one
    tool D4 chose precisely because it does nothing. D4 already names the remedy shape — "if it
    turns out to leak, the fix is a different launch permit, not a weaker rule" — and this is the
    neighbouring case, where it does not leak because it does not load.

    Picking the replacement is a decision and not a small one, because the permit has to resolve in
    every host the plugin ships to and this repository can observe one. `ListAgents` is the worst
    candidate available and worth naming as such: it resolves, it is read-only, it touches no file —
    and it enumerates sibling agents, which is the one thing the architecture exists to prevent.
    Any permit chosen on D4's stated criteria alone can be that.~~
    **Resolved as D36: the permit is `TodoWrite`, and the run procedure probes it before diverge.**
    `TodoWrite` reads nothing, so D4's open question about what the permit shows a branch mid-dispatch
    is retired rather than answered. It is not verified: agent definitions are read at session start,
    so the session that made the change could not test it — after the edit the refusal still named
    `TaskList`. What is verified is the failure it replaces. `skills/adhd/SKILL.md` step 1b spawns one
    probe agent before any spend, so a host where the permit does not resolve stops the run at the
    gate with a message naming D4 and D36 instead of a row of refusals after the plan was approved.

89. ~~**A reseed of fixture 001 cannot change its frame set, so item 3 measures less than it reads
    like it does.** `design_decision` lists exactly five primary frames and `n` resolves to five, so
    every seed selects all of them and the shuffle only permutes dispatch order. Seed 1 ran
    LEDGER, MINIMALIST, DOOR_KEEPER, ACTOR_CENSUS, FRAME_BREAKER; seed 2 ran ACTOR_CENSUS,
    DOOR_KEEPER, MINIMALIST, FRAME_BREAKER, LEDGER; seed 3 compiled ACTOR_CENSUS, DOOR_KEEPER,
    LEDGER, FRAME_BREAKER, MINIMALIST — the same five, three times. E1a's finding that
    `001/human_cancel` survived a whole new frame set but not a reseed is therefore a statement
    about dispatch order and branch sampling, not about frame composition, and `001-altframes` is
    the only recorded run that varies which frames appear. Worth stating in `docs/EXPERIMENTS.md`
    where E1a is registered, because the pair of results reads as stronger than it is.~~
    **Recorded and acted on; nothing left open.** `docs/EXPERIMENTS.md` states it under E1a — holding
    the frame set fixed across seeds 1, 2 and 3 was forced by the class rather than chosen — and the
    README's fixture table carries the same caveat. The experiment the title describes is item 91.
90. ~~**First observation bearing on D4's untested isolation claim, and it did not survive the second
    run.** All five branches of the aborted run `20260914223732-7e664e` were dispatched as
    `general-purpose`, as all eleven recorded runs were, which grants the filesystem tools D4
    forbids, and every one returned `tool_uses: 0`. That read as evidence that the brief's "You have
    no tools. Everything you need is in this brief." carries on its own.

    **It does not, and the next run said so.** Every one of the five branches of
    `20260915013807-7e664e` reported `tool_uses: 1`, as did the critic. So the count is not a
    property of the instruction; it varies run to run under an identical brief, and a single run of
    zeroes was a sample rather than a finding. What the counter cannot say is *which* tool, so
    neither run establishes whether a branch reached the filesystem — only that the earlier one
    reached nothing at all. Getting further needs the grant removed rather than counted, which is
    D36 and item 93.

    Either way it was never evidence about the launch permit, which is the claim D4 flags. D36
    retires that question by making the permit `TodoWrite`, which reads nothing.~~
    **Recorded, corrected, and closed as a finding.** The correction is in the item above: a single
    run of zeroes was a sample, not a property, and the next run's ones said so. What is left is not
    this item but the instrument — the counter does not name the tool — which is item 97.
91. **`enumerate_options` is the only class where a reseed changes the frame set, and item 3 used the
    one where it cannot.** Its primary list holds nine frames and `n` is seven, so the seeded shuffle
    drops two primaries per run and which two is a property of the seed. Every other run class has
    `n` exactly equal to its primary length, so a reseed there permutes dispatch order and nothing
    else (item 89). Fixture 001 is `design_decision`, which is why seeds 1, 2 and 3 selected the same
    five frames.

    So the experiment item 3 was written to run — do the findings survive a reshuffle, or are they
    seed artifacts — is answerable today, on a fixture routed to `enumerate_options`, and is not
    answerable on 001 at any seed. Two of the eight fixtures route there. This is not an argument
    against the 001 reseeds, which measure branch sampling at a fixed frame set and are worth having
    under that description; it is an argument that the description in item 3 belongs to a different
    class, and that `docs/EXPERIMENTS.md` should say which of the two E1a measured.

92. ~~**`reasoning_carries`, the other half of item 60.** It reads a near-constant 3 because twelve of
    thirteen frames have no web tools, so the dimension is measuring the D4 allowlist rather than the
    reasoning. D34 retired `foreclosure` and left this one alone, and the mechanism D34 built is what
    this needs: `retired_in: 2` and a rubric version bump would cost nothing to the archive now.
    What it wants first is the decision the item posed and nobody has answered — drop it, or make it
    conditional on the frame having had tools, which is a different dimension wearing the same id.
    D35 changes the arithmetic slightly in its favour: `strategy` now dispatches six frames and
    `PRIOR_ART` is one of them, so the one frame with a tool grant appears more often than it did.~~
    **Resolved as D39, and the answer is keep it.** The item inherited item 60's framing that the two
    ceiling dimensions were one case. They are not. `foreclosure` and `reasoning_carries` sit at
    almost the same ceiling — 0.943 against 0.947 — and separate completely on the statistic that
    matters: `foreclosure`'s interval contains zero, `reasoning_carries` reaches alpha **0.678 on
    [0.678, 0.700]**, above `committal`, `substance`, `falsifiability` and `actor_coverage`. It is one
    of the better dimensions in the rubric. The ceiling rate was doing all the work in the original
    framing and it is the one statistic that cannot tell prevention from dead weight.

    The ceiling has a mechanism, and `docs/RETIREMENT.md` already records it for T3: twelve of
    thirteen frames carry no tools, so they have nothing to cite, so they score 3. Untriggered rather
    than useless. The conditional option was rejected on a separate ground — it would vary the
    dimension set between branches *inside one run*, and pass A normalises by total weight, so two
    branches on different denominators stop being comparable to each other, which is the one
    comparison pass A exists to make.
93. **Verify that a launch permit resolves, and which one.** D36 guessed `TodoWrite` and the next
    session measured it: this host refuses with **"unrecognized [TodoWrite]"**, where `TaskList` had
    been "recognized but matched no tools in this session". Two names, two different failures, both on
    reasoning rather than measurement. D38 is the correction — the permit is now the pair
    `TodoWrite, TaskList`, so a host with either can launch the three agents.

    **Still open, and narrower than it was.** No host has yet been observed resolving *either* name for
    a subagent, so rung 1 of D38's ladder is unexercised and `adhd-branch`, `adhd-critic` and
    `adhd-deepen` have never launched anywhere. What is no longer blocked is the isolation guarantee,
    which rung 2 now carries (item 54). Settling this needs a host that resolves one of the pair;
    step 1b of the run procedure probes for it before any spend, so the next run answers it either way.
    If neither name ever resolves anywhere, the honest conclusion is that a zero-capability subagent is
    not a thing this ecosystem supports, and the three agent files are a fiction that rung 2 quietly
    replaces.

94. ~~**Re-run seed 3 under the folded contract.** The abort that produced items 87 through 91 spent
    262,788 tokens and scored nothing. D37 removes the cause, so the run item 3 asks for is available
    again, and item 91 is the argument for spending it on a fixture routed to `enumerate_options`
    instead — that is the only class where a reseed changes the frame set, and 001 is not it. Either
    way it is spend, so it is the owner's call under D5.~~
    **Done, on 001 rather than `enumerate_options`, because the first job was to show D37 works.**
    Recorded as `001-seed3`, 485,412 tokens. Critique reported 5 valid artifacts and 0 contract
    violations at the phase the previous attempt aborted in, and one branch wrote
    `isolation: under this position` inside a `forecloses` item — the exact construct that aborted
    it. D37 is demonstrated rather than argued. Item 91 is still the argument for the
    `enumerate_options` run, which has not happened.

95. ~~**The critic contract has the defect D37 just fixed in the branch contract.** `prompts/critic-pass-a.md`
    shows each cell as `{ score: <0-3>, evidence: <one sentence> }`, a flow mapping with the evidence
    unquoted, so an evidence string containing `: ` closes the mapping early and the pass is rejected
    — the same failure that cost run `20260914223732-7e664e`, one contract over. Pass B is the same
    shape: `T1: { fired: <bool>, evidence: <text> }`, plus `action`, `strongest_objection` and the
    `lint_verdicts` rows.

    It has never fired. Every recorded pass A quotes its evidence and so did the critic of
    `20260915013807-7e664e`, which wrote `evidence: "One sentence, one imperative verb..."` in all
    40 cells unprompted. That is the same luck D37 found in the branch artifacts — 106 plain values,
    not one with an internal colon — and the same reason not to rely on it.

    The fix is not identical, because a folded scalar cannot sit inside a flow mapping. Either the
    cells become block mappings, which makes a pass A file about three times longer and changes the
    shape of every recorded one, or the contract shows the evidence quoted and says why. The second
    is what the branch contract rejected as "asking harder is not a mechanism" — the difference here
    is that quoting inside `{ }` is the only option the syntax leaves, so the argument that beat it
    there does not apply. Worth doing before the next real run, and it is a contract change, so it
    wants a D-number.~~
    **Fixed, and the fix differs by contract because the syntax does.** `critic-pass-a.md` and
    `critic-pass-b.md` put their free text inside `{ }` flow mappings, where a folded scalar is not
    legal, so every free-text placeholder there is now **quoted** and the contract says why. The
    argument that beat quoting in the branch contract — "asking harder is not a mechanism" — does not
    carry here, because the syntax leaves no third option. `deepen.md` is ordinary block context, so
    `revised_position` and `revised_falsifier` **fold** with `>-` like the branch contract's, with
    `revised_position: null` on one line for the fold verdict, since a folded scalar cannot be null.

    Two tests pin it, including the null path through the real validator, because that is the shape
    most likely to break: a fold that cannot report a fold would be a silent loss.

96. ~~**The Python analysis could not read a fenced artifact and the TypeScript side could.** A branch
    returns its artifact as its final message and the host writes that message unedited, so an
    artifact may arrive wrapped in a ```` ```yaml ```` fence. `src/validate.ts` has always stripped
    one. `adhd_analysis` did not, and `001-seed3` is the first recording to carry a fence, so the
    entire Python suite errored — `found character '`' that cannot start any token` — while all 476
    TypeScript tests stayed green.

    Fixed by teaching the Python loader the same tolerance rather than by unfencing the recording,
    because the recording is what the branches actually returned and that is the property the corpus
    exists to preserve. What is left open is the asymmetry itself: two loaders, two notions of what
    an artifact is, and nothing that fails when they disagree. A test that round-trips one artifact
    through both would have caught this before a run did. Worth building; it is the same shape as
    the `comparable_heldout` and `comparable_training` guards, which exist because a claim that
    nothing checks is a claim that drifts.~~
    **Closed. The asymmetry now has a contract that fails when the two sides disagree.**
    `evals/artifact-loader-cases.json` holds nine hand-written cases, and both suites assert against
    it: `test/contract-prose.test.ts` for `unfence` in `src/validate.ts`, and
    `analysis/tests/test_corpus_and_findings.py` for `unfence` in `analysis/adhd_analysis/corpus.py`.
    Writing the cases found a second divergence nobody had hit yet: the Python side was closing the
    fence with `rfind`, so a backtick run inside a value ended the artifact early. The TypeScript
    side takes the first closing fence after the body starts, not the last. That case is now case 4,
    and it is the reason the file exists rather than a docstring saying the two agree.

97. ~~**The subagent token counter does not say which tool was used, and a claim now rests on it.** D38's
    cost is stance purity: a plain branch dispatched on rung 2 holds `WebSearch` and `WebFetch` and is
    told in its brief not to look for anything. Whether it obeys is the difference between a cost in
    principle and a cost in fact, and the only instrument available is `tool_uses`, which reports a
    bare count. All three rung-2 branches reported 1. So did five branches dispatched as
    `general-purpose`, and a bare diagnostic probe reported 0, so the count is not simply the hand-back
    and something is being called.

    Nothing in reach distinguishes "searched the web" from "wrote a checklist". Until it does, D38's
    stance-purity cost is unmeasured in both directions, and item 90's correction is the precedent for
    how that goes wrong: a count read as a finding twice, once each way. The cheap partial answer is a
    lint over rung-2 artifacts for the shape of borrowed material — a cited URL, a named product, a
    date the brief never carried — which is T3's detector pointed at the dispatch rather than the
    reasoning. That would catch the case that matters without needing a better counter.~~
    **Partly answered, and the cheap half is built.** Nothing in reach distinguishes "searched the
    web" from "wrote a checklist", so the count stays uninformative and D38's stance-purity cost stays
    unmeasured *as a count*. What is now checked is the thing the count was a proxy for: whether a
    rung-2 artifact shows borrowed material. `adhd traps` already runs the T3 detector over an
    artifact, and T3 is exactly "remove every citation, does a chain of reasoning remain". Pointing it
    at the dispatch rather than at the reasoning needed no new detector, only the discipline of
    running it on every rung-2 artifact and recording the result, which the run procedure now says to
    do. A branch that searched and leaned on what it found fires T3 and is pruned by the existing
    hard rule. One that searched and did not lean on it is indistinguishable from one that did not
    search, which is the honest limit and is the same limit the corpus has always had.

    **First datum: clean.** All three rung-2 artifacts of `20260915065417-7e664e` pass `adhd traps`
    with nothing fired across T3, T4 and T5. One run is not a rate, and the residual question stays
    open as stated, but the check that would have caught the failure did run and did not catch one.
98. **`committal` is the dimension that now carries `foreclosure`'s problem** (owner's call, and
    harder than the last one). Alpha **0.402** on an interval of **[-0.054, 0.683]** that contains
    zero, at 84% ceiling and three distinct values across the corpus. D34 noted the interval in
    passing and nothing acted on it, because item 60 had named `reasoning_carries` as the second
    ceiling dimension and D39 found that was the wrong one.

    It is not `foreclosure`'s case repeated. `foreclosure` was pinned at zero with a tight interval
    and two distinct values: unmeasured, and no amount of corpus would have rescued it. `committal`
    has a point estimate worth something and an interval wide enough to contain both "as good as
    `substance`" and "chance". That is a corpus-size problem rather than a rubric problem, and the
    honest move is more runs before any retirement — which is the opposite of what D34 concluded
    about `foreclosure`, on the same kind of evidence, for a reason worth being explicit about.

    What would settle it: the interval narrows with scored runs, and there are eight. If it stays
    across zero at fifteen, the dimension is measuring nothing and `retired_in: 2` is the move. If it
    lifts clear, it was thin evidence and the rubric keeps a dimension that scores the thing the
    output contract is built around. Do not retire it on the current interval; D39's whole finding is
    that a ceiling rate is not evidence of that.

99. **The corpus counts a deliberate replicate as an independent run, and a retirement criterion just
    moved on one.** `001-seed3-repeat` is fixture 001 at seed 3 with briefs byte-identical to
    `001-seed3`'s. It exists to measure the noise floor (item 4) and it is the right thing to have
    recorded. But `frames --health` counts nine runs where there are eight distinct problem-and-seed
    draws, and at nine `LEDGER` became the first frame ever to meet the retirement bar: criterion 3
    reads "held the recommendation 0 of 5" where two of those five are the same problem declining to
    pick it twice.

    `docs/RETIREMENT.md` stands `LEDGER` down by hand and says why, so nothing is being acted on
    wrongly today. What is missing is a way for the counter to know. The obvious shape is a field on
    a recorded run naming the run it replicates, with `frames --stats`, `frames --health` and
    `learn` collapsing a replicate group to one draw for rate criteria while still counting every
    artifact for reliability, where more samples of the same pack is exactly what is wanted. Those
    two treatments genuinely differ, which is why this is not a one-line filter.

    Until it exists, every rate in `frames --health` is over runs rather than over draws, and the
    gap is one run wide. It will widen: item 4 is the kind of experiment worth repeating, and each
    repeat makes the denominator less honest. **Resolve before any frame is retired on a rate.**

## Not doing, and why

- **An inference client.** See CLAUDE.md. This is the design, not an omission.
- **A quality rubric.** Rewards the consensus trap, which is T1, which is the thing the repo
  exists to catch.
- **More frames without the orthogonality check.** Thirteen frames on ten axes is already
  thin per axis; adding a fourteenth on a shared axis makes the library worse, not larger.
