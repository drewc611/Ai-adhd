# Pre-registered experiments

Written before the runs, on purpose. Picking the comparison after seeing the results is the same
failure as tightening a fixture assertion after learning which one the control cleared, and this
repo already refuses that one under D6. What each run is testing, and what would count as which
answer, is fixed here first.

Recorded outcomes go in `docs/DECISIONS.md`. This file is not edited after a run starts, except
to link the result.

---

## E1. What does the seed actually change?

**Registered 2026-09-07, before the seed 2 run.**

The README claimed, and the PR description repeated, that nothing separates "the frame set found
this" from "the seed found this". Reading `config/routing.yaml` before running it shows that
claim was loose for this fixture.

`design_decision` lists exactly five frames and takes `n: 5`. The seed shuffles that list and
then takes the first five, so **for this class the seed cannot change which frames run.** It
changes dispatch order and nothing else. `alternates` exist but are only reached when the
primary list cannot fill `n` on distinct axes.

So the one experiment splits into two, and they answer different questions.

### E1a. Variance floor — same frames, different seed

Fixture 001 at seed 2. Same problem, same five frames, different dispatch order and a fresh
sample from every branch and critic.

**What it measures.** How much of a finding is the machinery and how much is noise. Every
number quoted anywhere in this repo about one run is uninterpretable without this.

**Pre-registered readings.**

- The four `must_surface` assertions either survive or they do not. An assertion that 001 passed
  at seed 1 and fails at seed 2 was never a property of the frame set; it was a property of one
  sample.
- If the same frames prune and survive, the critic is stable on this pack. If the prune set
  changes, `frames --stats` prune rates are single-sample noise and every claim resting on them
  is weaker than stated, including `END_USER` being "pruned in every appearance".
- `adhd diff` reports this pair as **same frames, different seed**, which is the case it was
  built to call a seed effect.

### E1b. Frame-set effect — different frames, same problem

Fixture 001 with an explicit frame list, holding `FRAME_BREAKER` as the anchor (it is the only
frame dispatched in all five recorded runs) and replacing the other four with alternates on axes
seed 1 never used:

| kept | replaced with | axis |
|---|---|---|
| `FRAME_BREAKER` | — | frame_validity |
| `ACTOR_CENSUS` | `PARTICULARIST` | actors → particulars |
| `LEDGER` | `SABOTEUR` | cost → adversary |
| `DOOR_KEEPER` | `MECHANIC` | reversibility → mechanism |
| `MINIMALIST` | `PRIOR_ART` | scope → precedent |

**What it measures.** Whether fixture 001's assertions are properties of the problem or of the
frames that happened to be pointed at it.

**Pre-registered readings, and this is the part that has to be fixed in advance.**

- **If the assertions still surface**, the findings belong to the problem. A competent divergent
  read of "what timeouts should I set" reaches the cancel path and the retry payer from several
  directions, and the specific five frames are not load-bearing. That is good news for the
  architecture and bad news for the frame library's claim to be the IP.
- **If they do not surface**, the frame set is load-bearing, `config/frames.yaml` is doing the
  work, and routing's choice of five matters more than any run has shown.
- **If the run surfaces things fixture 001 does not ask for**, the fixture is under-specified
  rather than the frame set being wrong. Those go in the run's README as findings, and **do not
  get added to the fixture in the same change**, for the D6 reason.

**What would not count.** A prettier synthesis, a higher mean pass A, or a recommendation I
happen to prefer. The fixture's assertions are the measure, and they were written before any of
these runs.

### E1a result, 2026-09-07

Recorded as `evals/recorded/001-seed2`. **Fixture 001 passes at seed 1 and fails at seed 2**,
same problem, same five frames, different dispatch order and a fresh sample.

Failing at seed 2, both passing at seed 1:

- `human_cancel` — the human waiting who can cancel, and the bail-out path
- `retry_cost` — who pays for the retry and in what currency
- `pruned_traps_include_any T1,T2,T3` — only T6 and T7 fired

Two of those are two of the four bullets the README's motivating-failure section holds up as the
point of the whole system. Under the reading registered above they were never properties of the
frame set; they were one sample.

The prune set moved as hard:

| frame | seed 1 | seed 2 |
|---|---|---|
| `LEDGER` | pruned T2, T7 | pruned T7 |
| `MINIMALIST` | pruned T1, T2, T6 | pruned T6 |
| `DOOR_KEEPER` | survivor | survivor |
| `ACTOR_CENSUS` | survivor, **held the recommendation** | **pruned T7** |
| `FRAME_BREAKER` | survivor | pruned T7 |

Two of five pruned became four of five. T7 fired three times in this one run against four times
across the five previous runs combined, which makes it the corpus's most-fired detector on the
strength of a single sample.

**What the pruned block caught that the recommendation did not.** `LEDGER`, `ACTOR_CENSUS` and
`FRAME_BREAKER` independently converged on caller-owned deadline propagation and were clustered
together as `deadline_propagation`. The critic pruned all three. A three-member cluster with zero
survivors is the strongest corroboration anywhere in the corpus, removed entirely on T7. The run
found the thing; the critic threw it away.

**Consequences, none of them optional.**

- Every per-frame rate in `frames --stats` is single-sample noise at this corpus size. "END_USER
  is pruned in every appearance (2/2)" and "DOOR_KEEPER, HORIZON and MECHANIC have never been
  pruned" are two-sample statements, and the one frame with three samples just changed status.
- `docs/RETIREMENT.md`'s five-run floor was set by intuition and is now evidenced: at n=1 the
  prune rate for a frame swung from 0 to 1.
- The D8 agreement figures stand, because those compared two critics on one fixed pack. This
  varies the pack. They measure different things and neither rescues the other.

### E1b result, 2026-09-07

Recorded as `evals/recorded/001-altframes`, also as failing. Same problem, same hash,
`FRAME_BREAKER` held and the other four replaced by alternates on axes seed 1 never used.

Put beside the other two, fixture 001 has passed exactly once: in the run it was written
against.

| assertion | seed 1 | seed 2 | alt frames |
|---|---|---|---|
| `human_cancel` | ok | **miss** | ok |
| `retry_target_questioned` | ok | ok | **miss** |
| `retry_cost` | ok | **miss** | **miss** |
| `trap_named` | ok | ok | ok |

Neither pre-registered reading is right on its own, and the mixture is the finding: **different
assertions have different dependencies.**

- `human_cancel` survived a whole new frame set but not a reseed. It is a property of the
  problem that the machinery finds unreliably.
- `retry_target_questioned` survived a reseed but not the frame swap. It is the frame set doing
  work, and `FRAME_BREAKER` being present was not enough.
- `retry_cost` has passed once. It was `LEDGER`'s at seed 1; `LEDGER` was pruned at seed 2 and
  not dispatched at all in E1b. On this evidence it needs a specific frame, alive.
- `trap_named` passed everywhere, and it is the assertion that asks almost nothing: any `T[1-8]`
  anywhere in the pruned block. The only robust assertion in the fixture is the weakest one.

**What this does to "the config is the product".** The README calls `config/` the actual IP.
Partly earned: one assertion is clearly frame-dependent. But at this sample size the frame set
and the sample are entangled, and the corpus cannot yet separate "this frame finds this" from
"this run found this".

**T3 fired for the first time.** `PRIOR_ART` was dispatched to `adhd-branch-search` with real web
tools, borrowed authority, and the detector caught it. T3 was not dead weight; no frame that
could trigger it had ever been given the tools. That retires the criterion-4 note against
`MECHANIC` in `docs/RETIREMENT.md`, whose only stated reason was attacking T3. T5 remains the
only detector that has never fired, and it is the one the output contract may make unfireable.

**Deadline propagation, twice, from disjoint frames.** At seed 2 `LEDGER`, `ACTOR_CENSUS` and
`FRAME_BREAKER` clustered on it. In E1b `SABOTEUR`, `FRAME_BREAKER` and `PRIOR_ART` clustered on
it again. Six frames across two runs, one shared. Whatever else is unstable, the problem has an
answer the machinery keeps reaching.

**Not done, and it is the obvious next thing.** Three runs of one fixture is still three runs.
Nothing here justifies changing `config/frames.yaml`, the rubric anchors, or a fixture
assertion. It justifies distrusting every single-run number in this repository, which is what
the corrections in `docs/DECISIONS.md` and `docs/RETIREMENT.md` now say.

### What neither answers

Two runs against one baseline. A finding that survives E1a is not thereby robust; it survived
once. Nothing here licenses dropping the sample-size caveat from any figure.
