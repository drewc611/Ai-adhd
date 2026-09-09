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
  is weaker than stated, including `SUPPLICANT` being "pruned in every appearance".
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

- Every per-frame rate in `frames --stats` is single-sample noise at this corpus size. "SUPPLICANT
  is pruned in every appearance (2/2)" and "DOOR_KEEPER, SUCCESSOR and MECHANIC have never been
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

---

## E2. Does the background model read, or has it memorised one genre?

**Registered 2026-09-08, before either run. Neither has been executed at the time of writing.**

The instruction that prompted this was to keep training the model "until it can read by itself."
That is not reachable by training an n-gram model and the reason is recorded in D2 and D9 rather
than argued here. What *is* reachable is the measurable half of the question. A model that scores
RFC-shaped text well and everything else badly has not learned to read technical prose; it has
learned one template. Every held-out number this repository has published is same-genre — the
stride split holds out every 20th document across a corpus that is 95% RFCs by bytes — so nothing
so far distinguishes those two cases.

Two runs, because they answer different questions and only the second is an out-of-domain test.

### E2a. Per-genre held-out perplexity, no retraining

Score the shipped 68M-token model on the held-out side of the *full* split, narrowed to one source
at a time. Narrowing happens after the stride, never before: striding a single-source library picks
every 20th PEP by PEP index, and some of those sit in the full split's training half, so the
measurement would score the model on its own training text and call it held out.

**What it measures.** Whether competence is uniform across genres or tracks training share. It is
**not** an out-of-domain test — every source contributes to the training half — and reporting it as
one would be the same error as reading 17.4 against 38.6 as an improvement.

**Pre-registered readings.**

- Perplexity should be lowest on `rfc`, which is 95.4% of training bytes. If it is not, something
  is wrong with the split or the fingerprint and the number to trust is neither.
- A spread within roughly 2x across `rfc`, `pep`, `eip` and `erc` says the model has general
  competence on the genre family. A spread beyond about 5x says it is an RFC model that tolerates
  the others.
- `repo-docs` is the smallest source and the least like the rest. It is reported for contrast and
  it is the one source whose held-out documents number in the single digits, so a wide figure there
  is a sample size and not a finding.
- Every subset is a different test set with its own fingerprint. Numbers across rows are not ranked
  against each other as model quality; the *spread* is the reading, not any single row.

### E2b. Leave one source out

Train an order-4 model on the corpus with `pep` removed entirely, then score it on all 615 PEPs.
The model never saw a single PEP.

`pep` rather than `erc`: ERCs are the same process and template as EIPs, which stay in training, so
a small gap there would prove nothing. PEPs are 3.4% of training bytes, so removing them changes the
model by almost nothing, and `.rst` with its own header conventions is genuinely a different surface
from an RFC.

**What it measures.** How much worse the model is on a genre it has never seen than on the same
genre held out from training. E2a supplies the second number, so the comparison is
`E2b perplexity on PEPs` against `E2a perplexity on held-out PEPs`, both on PEP text.

**Pre-registered readings.**

- The two PEP figures are on different document sets (615 against roughly 30), so the comparison is
  a ratio between two tests and is stated as such. The fingerprints will differ and
  `comparable_heldout` will say so. This is registered as a magnitude question, not a significance
  test, and no p-value will be computed for it.
- **A ratio near 1 would be the interesting result**: it would say the model's competence on PEPs
  comes from technical English generally rather than from having read PEPs, which is the strongest
  evidence available here that it generalises across the genre family.
- **A ratio above about 3 says the opposite** — that most of what looks like competence on any
  source is that source being in the training text, and that the shipped model's numbers are
  memorisation of a corpus rather than a description of a genre. That is the outcome that would make
  the genericity measure weaker than currently stated, and it would be recorded as such.
- OOV rate is reported beside both. A large ratio driven mostly by OOV is a vocabulary result, not a
  modelling one, and the two must not be conflated.

**What neither answers.** Whether any of this bears on the T1 finding. The genericity comparison is
between artifacts scored by one model; a model with a different generalisation profile could move
every artifact's surprisal without moving the difference between two groups of them. That would need
its own run and is not registered here.

### E2 result, 2026-09-09

Both runs are in **D16's successor, D17**. In short: reading a genre is worth **2.83x** on that genre,
measured on identical text; the per-genre spread is wider than the "general competence" band this
registration set; and the registration under-specified one thing, which is that a stride of 20 leaves
31 held-out PEPs and 16 held-out EIPs — too few to separate its own two readings. E2b at 615
documents is the well-powered half and is the number to quote.

