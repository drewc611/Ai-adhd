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

**The frames being the same is forced, not chosen, and that was established after the fact.**
`design_decision` lists exactly five primary frames and resolves `n` to five, so the seeded
shuffle can only permute dispatch order: no seed selects a different set, and the reading below
about "one sample" is therefore about branch and critic sampling at a fixed frame set. Seed 3,
compiled on 2026-09-14, drew the same five a third time. Of the six run classes only
`enumerate_options` can vary a frame set by seed — nine primaries at `n=7`, so the shuffle drops
two and which two is the seed's — so a reseed experiment that varies *which frames appear* has to
be run there and cannot be run on 001 at any seed. Backlog 89 and 91.

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

> **Superseded for one of the two by E1b, below.** `retry_cost` missed again under a different frame
> set, so "one sample" is wrong for it: at seed 1 it was `LEDGER`'s, and `LEDGER` was pruned at seed
> 2 and never dispatched in E1b. `human_cancel` survived the frame swap, so the reading holds there.
> Left standing rather than rewritten, per this file's own rule — a registered reading that turned
> out half right is worth more than a tidy one.

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


---

## E3. Is `001/retry_cost` a gap in the library or a gap in the pattern?

**Registered 2026-09-09, before the widened pattern was run against anything.** The candidate
patterns are fixed below and the adoption rule is fixed with them.

`retry_cost` has matched 1 real run in 3, which `adhd eval --audit` now reports as `sometimes`. The
obvious reading is that nothing in the dispatched frame set reliably asks who pays. Reading the runs
says otherwise. At seed 2 `LEDGER` produced:

> cap retries with a retry budget of a few percent of traffic

and the critic's own T7 detector output on that position reads:

> Every recommendation is priced in currency and payer

That is the cost of retries, named, with a payer. None of the five existing patterns match it:
the text says *payer* and not "pays for", *retry budget* and not "cost of the retry". The patterns
were written against seed 1's wording, which was "the bill … is paid by" and "who pays for it".

**Widening a pattern after seeing which runs failed is the mirror of tightening one after seeing
which the control cleared**, and this file refuses that under D6. So the widening is registered
first, and the negative control decides whether it is adopted.

### The candidate patterns

Added to `retry_cost.any_of`, and nothing else changes:

| pattern | what it is meant to catch | risk |
|---|---|---|
| `payer` | the noun form of "pays for" | low; the control never asks who absorbs anything |
| `retry budget` | retries priced as a share of traffic | **highest**, see below |
| `priced in` | an explicit statement that a cost was assigned | low |

`retry budget` is the one to watch. It is standard SRE vocabulary and **the negative control cites
the Google SRE Book**, so it is exactly the phrase a fluent consensus answer might reach for without
ever asking who pays. If it is what makes the control pass, it is recitation and not divergence.

### The adoption rule, fixed now

- **Adopt only if `001-linear-cot` still fails `retry_cost` with the widened set.** The control is
  the whole point: a pattern the consensus answer satisfies does not measure divergence, and the
  audit already says so about `003/reframe`.
- **If the control passes, the widening is refused and reverted**, and which pattern did it is
  recorded. Per-pattern, not all-or-nothing: if one of the three admits the control and the other two
  do not, the other two may stand and the offender is dropped.
- The `must_not` items and every other assertion are untouched. This is one item's vocabulary.

### Predictions, so the result can be wrong

- Seed 2 matches on `payer` and on `retry budget`, taking the rate to at least 2/3.
- `001-altframes` is unknown to me at the time of writing; I have not searched it for these strings.
- The control fails all three. Stated as the expected outcome precisely so that the control passing
  is a result and not a surprise to be explained away.
- If the rate reaches 3/3 the item stops being `sometimes` and the audit stops flagging it. That is
  the outcome to be most suspicious of, because a pattern that suddenly matches everything is what a
  pattern loosened to quiet a report looks like.

### E3 result, 2026-09-09

**The negative control failed all three candidates.** `001-linear-cot` contains none of `payer`,
`retry budget` or `priced in`, so the registered adoption rule permitted all three.

**Two were adopted and the third was refused anyway.** Adopting all three would have taken
`retry_cost` to 3/3, which this registration named in advance as the outcome to be most suspicious
of, so the matches were read rather than counted:

| pattern | control | what it matched in a real run | adopted |
|---|---|---|---|
| `payer` | fails | seed 2, T7 detector output: "priced in currency and payer" | yes |
| `priced in` | fails | seed 2, same line | yes |
| `retry budget` | fails | altframes: "a retry budget of about 10 percent of traffic" | **no** |

`retry budget` names a currency and no payer, and this item's own description asks for who *and* in
what currency. **A pattern can clear the control test and still admit text the description excludes**,
which is the gap the control test cannot see, and it is worth more than the extra passing run.

`retry_cost` goes 1/3 to **2/3** and stays `sometimes`. The prediction that seed 2 would match held;
the prediction about altframes was unstated and it turned out to hinge on the pattern that was
refused. The wider reading: **the item was never the frame-library gap E1b took it for.** `LEDGER`
surfaced the cost question at both seeds. What differed was the wording, and the fixture only knew
one of them.

Nothing in fixture 001 is at 3/3 except `trap_named`, which asks least.


---

## E4. Can held-out perplexity be beaten at order 4, min_count 2?

**Registered 2026-09-09, before any cell was trained.** The grid, the primary statistic and the
refusal conditions are fixed here.

The shipped model scores **26.30** held out. The instruction was to make that better, and there are
two honest levers left at this corpus size and two dishonest ones.

**Honest.** Order 5 has better perplexity than order 4 wherever both have been measured — 36.0
against 38.6 at 22.9M tokens, a 6.8% gain — and it does not fit: 1.7x order 4's 40.8M n-grams is
about 69M, which the measured 257MB per million puts near 17.7GB against a machine with 15.4GB. The
lever that might buy the room is `min_count`, which the governor brief already prefers over ceilings:
3 rather than 2 roughly halves a technical vocabulary's type count and cuts the table with it.

**Dishonest, and named so they are not drifted into.** Scoring in sample, which is D16. Choosing the
corpus that flatters the number, which is what `comparable_heldout` exists to refuse. Neither is
available here and neither is being attempted.

### The grid

Three cells, all trained on one frozen corpus with `--held-out-every 20` and scored on the identical
held-out half:

| cell | order | min_count | why it is in the grid |
|---|---|---|---|
| A | 4 | 2 | the baseline, retrained on this snapshot so every fingerprint matches |
| B | 5 | 3 | the candidate |
| C | 4 | 3 | **the control that makes B readable** |

Cell C is not optional. Without it, a win for B cannot be attributed: `min_count` 3 changes the
vocabulary and the order changes the model, and B moves both at once.

### The primary statistic, and a gap in the tooling

`min_count` 3 drops types that `min_count` 2 keeps, so B and C have smaller vocabularies and higher
OOV than A. All-targets perplexity would then move partly for a vocabulary reason and partly for a
modelling one, which is the confusion backlog 77 was opened to end.

**The primary statistic is in-vocabulary-only perplexity**, with all-targets and the OOV rate
reported beside it. Note what this exposes: `comparable_heldout` compares fingerprints and the
in-vocabulary flag, and it will happily compare two all-targets numbers from models with *different
vocabularies*. It should not. That is the same shape as every check corrected in D16 and D18 —
comparing a property next to the one that matters — and it is recorded here rather than fixed
mid-experiment.

### Fixed readings

- **B wins only if it beats A on in-vocabulary-only perplexity and C does not beat A by as much.**
  If C matches B, the gain was `min_count` and order 5 bought nothing.
- **A ceiling that binds voids the cell.** If B stops on the resident-set ceiling its table is
  truncated and its perplexity describes a prefix; the record's `stopped_because` decides, not the
  number. This is the most likely single outcome and it is a result, not a failure to explain away.
- **If nothing beats 26.30, that is the answer** and 26.30 stands as the best this corpus and this
  machine produce. Reporting a loss is the point of fixing the grid in advance.
- No cell's `min_count` or order is adjusted after seeing a result. A fourth cell may only be added
  as a new registration.


---

## E5. Order 5 pruned to fit, against order 4 unpruned

**Registered 2026-09-10, before the run.** The last lever available on this machine, and the
arithmetic says it fails.

E4 established that order 5 does not fit: killed at 13,943MB against a cgroup near 14GB. Raising
`min_count` does not rescue it, and that is measured rather than assumed — going from 2 to 3 changed
the n-gram table by **−1.3%** (40,839,021 to 40,316,955). `min_count` drops rare *types*, and the
n-grams containing them mostly survive with `<unk>` in one slot instead of merging. So the table is
insensitive to it, order 5 needs about 17.6GB by the measured 257MB per million n-grams at any
threshold, and no vocabulary setting reaches it.

What makes one more attempt worth 15 minutes is backlog 76. Pruning was thought to cost 2.9x and
actually costs **1.36x** held out. An order-5 table pruned to the size of the order-4 table is
therefore a real candidate for the first time: same memory, higher order, a known penalty.

### The comparison

| | order | min_count | max_ngrams | note |
|---|---|---|---|---|
| baseline | 4 | 3 | none (40.3M, unpruned) | the shipped model, **25.65** |
| cell D | 5 | 3 | 42,000,000 | pruned to about the baseline's size |

Both against the frozen set (`8e2d77cbe8901b1e`), so the fingerprints match and
`comparable_heldout` has no grounds to refuse.

### The prediction, which is that it loses

Order 5 bought **6.8%** over order 4 where both were measured (36.0 against 38.6, at 22.9M tokens).
Pruning costs **36%** at this corpus. 36% against 6.8% is not close, so cell D should land near 33 to
35 and lose clearly to 25.65.

**Recorded because it is an extrapolation and not a measurement.** Both inputs come from different
conditions: the order-5 gain was measured on a corpus a third this size, and the pruning penalty was
measured at order 4, where the pruned tail is shorter. Either could travel badly. If cell D wins, the
composition was wrong and that is worth more than the 15 minutes.

### Fixed readings

- **Cell D wins only by beating 25.65 on all targets.** In-vocabulary-only is not the statistic here:
  E4 established it flatters a model whose vocabulary excludes the hardest words, and both cells share
  `min_count` 3 so it adds nothing anyway.
- **A ceiling that binds is still a void, not a number.** If D stops on the resident-set ceiling
  rather than the n-gram ceiling, its table is a prefix and its perplexity describes one.
- **`prunes` must be greater than zero.** If the 42M ceiling never binds, D is an unpruned order-5
  model that somehow fit, which contradicts E4 and means something is wrong with the accounting, not
  that order 5 is free.
- **If it loses, 25.65 stands as the best this machine produces** and the remaining levers are a bigger
  machine or a different model class, neither of which is available here.


---

## E6. A transformer against Kneser-Ney, at the same vocabulary and the same text

**Registered 2026-09-11, before the run.** The prediction this tests has been sitting in
`analysis/adhd_analysis/text/ngram.py` unmeasured since the module was written:

> a transformer trained from scratch needs somewhere north of 10^8 tokens before its perplexity beats
> a well-smoothed 5-gram, and it needs a GPU to get there

E5 closed on the same note, that the only levers left on this machine are a bigger machine or a
different model class. This is the model class. `analysis/adhd_analysis/text/transformer.py` is a
decoder-only transformer over numpy with a hand-written backward pass gradient-checked against central
differences, and `logprob_terms` duck-types `KneserNey`, so `evaluate` scores both with no special case.

### The confound that decides the design

**The shipped 25.82 is not the opponent, and must not be quoted as one.** It was measured at 148,353
types. The transformer's output projection is `d_model x vocab_size` and every token's loss touches
all of it; at 148,353 types that one layer is 19M parameters and dominates the model. So the
transformer runs at 8,192 types, and an all-targets perplexity at 8,192 types is not comparable to one
at 148,353: every OOV target is charged as a prediction of `<unk>`, `<unk>` is among the most frequent
symbols a closed-vocabulary model holds, and the model with the smaller vocabulary is therefore asked
an easier question on a larger share of the same text. `comparable_heldout` now refuses that pair
outright, which is a defect this registration found and not something it works around.

The control is therefore a Kneser-Ney trained at the transformer's vocabulary, not the shipped model.

### The second confound: how much text each model sees

Measured on this machine before registering, so the grid is arithmetic rather than hope. numpy 2.4.6
against scipy-openblas 0.3.31 on 4 cores, `d_model` 128, 2 layers, `context` 128, batch 32, 1.46M
parameters: **7,671 tokens/second**, which is 2.33 hours for one epoch over the 64.4M-token training
side. Three profiler-guided fixes got it there from 2,292 tok/s, a 3.35x, and the remaining gap to the
machine's 420 GFLOP/s is structural.

A Kneser-Ney reads the same corpus in 817 seconds. So the two cannot be given both the same vocabulary
and the same wall clock, and the choice is which to equalise. This registration equalises **text**,
and adds the full-corpus n-gram beside it to price the handicap:

| | model | vocabulary | training tokens | note |
|---|---|---|---|---|
| A | Kneser-Ney, order 4, `min_count` 3 | 8,192 | 64.4M (all) | the strong control |
| A′ | Kneser-Ney, order 4, `min_count` 3 | 8,192 | 20M (first) | the matched-exposure control |
| B | transformer, d128, 2 layers, ctx 128 | 8,192 | 20M (first), 1 epoch | |

20M tokens is not an arbitrary cap. At 1.46M parameters it is close to the compute-optimal ratio of
roughly 20 tokens per parameter, and at 7,671 tok/s it is about 43 minutes, which fits a session.

All three score the frozen held-out set (`8e2d77cbe8901b1e`, 366 documents), so the fingerprints match
and `comparable_heldout` has no grounds to refuse. **A′ against B is the experiment.** A is context.

### The prediction, which is that the transformer loses

Stated plainly so that being wrong costs something. **B lands 1.5x to 3x worse than A′.**

The reasoning, and the part of it that could be wrong. The corpus is RFCs, PEPs, EIPs and ERCs, which
is about as formulaic as English gets: "Security Considerations", "MUST NOT", "This document specifies".
A 4-gram with exact-match memory over 40M contexts is unusually strong on that text, and the genre
effect is already measured at **2.83x** (E2b), meaning the corpus rewards memorising a register. A
1.46M-parameter model at one epoch has neither the capacity to memorise it nor the data to generalise
past it. Against that, the transformer has an unbounded context window where the n-gram has three
tokens of history, and formulaic text is exactly where a long context should pay. If the prediction is
wrong, that is why.

### Fixed readings

- **B wins only by beating A′ on all targets, at a matching OOV rate.** `in_vocabulary_only` is not the
  statistic: E4 established it flatters whichever model's vocabulary excludes the harder words, and
  here both cells share a vocabulary cap so it adds nothing anyway.
- **A′ and B must report the same OOV rate to within a percentage point,** or `comparable_heldout`
  refuses them and the cell pair is void rather than close. Equal `min_count` and equal `max_size` over
  the same first 20M tokens should make them identical; if they are not, the token caps did not line up
  and the run is invalid.
- **A beating A′ is expected and is not a finding about model classes.** It prices the text handicap,
  and it is the number that says how much of any B loss is architecture and how much is 44M tokens.
- **A ceiling that binds voids the cell.** `stopped_because` decides, not the perplexity. For B this is
  the likely case and it is a result: `epochs_completed` below 1.0 means B was scored having seen less
  text than registered, and the number describes that run and not the architecture.
- **A loss is the point.** The claim under test predicts a loss; measuring one confirms an assertion
  that has never been checked and closes it. Reporting it is not a failure to explain away.
- **No cell's shape, learning rate, or token cap moves after a result is seen.** A different
  `d_model`, a second epoch, or a larger cap is a new registration, not an adjustment to this one.

**Result: D21.** A′ 30.7, B 64.1, **2.086x** — inside the predicted 1.5x to 3x. Cell A scored 19.9 and
is refused against both, because a fixed vocabulary cap is not a fixed vocabulary.

### One amendment to the harness, made before any result existed

`Transformer.logprob_terms` originally walked non-overlapping windows of `context`, which starves one
position in every `context`: the token on a window boundary is predicted from the single token before
it when the model could have had the whole window. Its docstring claimed that cost applied
"identically for every model scored this way." **That was wrong.** `KneserNey` slides an order-4 window
continuously with no boundaries and has no starved position at all, so the bias ran one way — against
the transformer, in exactly the comparison this experiment makes.

Fixed to windows that advance by `context // 2` and emit only their final stride, so every scored
position has at least `context // 2` tokens of left context. Recorded here rather than quietly, and
with the two things that make it not a moved goalpost: it was found and fixed **before cell B finished
training**, with no E6 number in existence, and it runs **against** the registered prediction, since it
can only help the model this registration predicts will lose.

It is not justified by a measurement, because a toy cannot honestly produce one: the same untrained
model reverses the direction between a fixture whose period divides `context` and one whose period does
not, because learned positional embeddings make the score depend on window alignment. The argument is
structural. **What the fix is worth was measured on cell B itself: 1.0029x**, 64.29 starved against 64.11
overlapping. The bias was real and negligible, which is the outcome that makes 2.086x safe to quote
without an asterisk about which window produced it.


---

## E7. An LSTM against a transformer and an n-gram, at one vocabulary on one corpus

**Registered 2026-09-11, before the run.** E6 answered "which of two model classes is better at 8,192
types on 20M tokens of RFC English" and the n-gram won by 2.086x. That leaves a question E6 could not
ask: **is the transformer's loss about attention, or about neural language models at this scale?** An
LSTM separates those. It is neural, it has no attention, and its context at scoring time is the whole
document rather than a window.

### The cell, and what it inherits

E6's cells A′ and B stand unchanged as the comparison. Cell C is added to them:

| cell | model | parameters | vocabulary from | training tokens | measured |
|---|---|---|---|---|---|
| A′ | Kneser-Ney order 4, `min_count` 3 | 12.4M n-grams | 20M tokens | 20,000,029 | **30.7** |
| B | transformer, d128, 2 layers, ctx 128 | 1,459,456 | 20M tokens | 18,343,512 | **64.1** |
| C | **LSTM, d128, 2 layers, ctx 128** | **1,311,744** | 20M tokens | ~18.3M | to be measured |

Same vocabulary cap, same `min_count` 3, same first 20M tokens, same frozen held-out set
(`8e2d77cbe8901b1e`), same trainer, same optimiser, same one epoch. The parameter counts differ by
10%, which is closer than any other pair in this table and close enough that the comparison is about
architecture rather than capacity.

Measured before registering, so the budget is arithmetic: **13,896 tokens/second** at this shape,
which is 24 minutes for one epoch. That is 1.8x *faster* than the transformer's 7,671 tok/s, which was
not the expected direction — a sequential time loop beating a parallel-over-time architecture — and is
worth recording as a fact about numpy at this size rather than about either architecture.

### The asymmetry, stated before the result

**The LSTM is scored with its state carried across the whole document. The transformer was scored over
windows of 128 tokens.** This is not the harness bias D21 had to correct, where the transformer was
starved of context the architecture could have used. It is the architectural difference between the
two: a transformer's context is bounded by its position embeddings and an LSTM's is not.

Equalising it would mean resetting the LSTM's state every 128 tokens, which measures the transformer's
limitation rather than the LSTM's ability. So it is not equalised, and **cell C is therefore flattered
relative to a windowed evaluation of the same weights.** If C wins, that is the first number to
challenge, and the way to challenge it is a second scoring of the same model with state reset per
window — cheap, and registered here as the follow-up rather than left to occur to someone.

A second asymmetry, smaller and in the other direction: the LSTM trains stateless (each window starts
from zero state, which is what truncated BPTT means) and scores stateful. It is therefore evaluated in
a regime it never trained in. Standard practice, and it could cut either way.

### The prediction

**C lands between B and A′ — worse than 30.7, better than 64.1.** Stated as a range because two
effects pull against each other and I do not know which dominates: the LSTM's unbounded scoring
context should help on formulaic text where a section heading predicts its own boilerplate, while its
lack of attention should hurt where the transformer could look directly at a specific earlier token.

More precisely: **C between 40 and 60.** If C beats A′'s 30.7, the E6 conclusion narrows sharply from
"a neural LM loses at this scale" to "a transformer loses at this scale", which would be the more
interesting result and the one worth a follow-up. If C is worse than B's 64.1, attention is doing real
work at 20M tokens and the loss in E6 is not about neural models in general.

### Fixed readings

- **C is compared to A′ and B on all targets at a matching OOV rate.** All three share the vocabulary
  pass, so their held-out OOV should agree to within rounding; if it does not, the token caps did not
  line up and the cell is invalid rather than close.
- **A ceiling that binds voids the cell.** `stopped_because` decides. `epochs_completed` below 1.0
  means C saw less text than registered and the number describes that run.
- **The state-carrying asymmetry is quoted with every C figure**, not mentioned once and dropped.
- **A loss is a result.** The prediction is a range and being outside it in either direction is worth
  more than being inside it.
- **No shape, learning rate or token cap moves after a result is seen.** A different `d_model`, a
  second epoch, or a bigger cap is a new registration.

**Result: D24. The prediction was wrong.** C is **159.3**, not 40 to 60 — 2.485x worse than the
transformer rather than between it and the n-gram. Attention is doing substantial work at 20M tokens,
so E6's conclusion narrows to the transformer rather than generalising to neural models. The
state-carrying advantage this registration flagged as flattering cell C closed about 6% of a gap set
during training, and the follow-up registered to challenge a C win is unnecessary because there is no
C win.

## E8. What is a percentage point of out-of-vocabulary worth?

**Registered 2026-09-14, before any cell ran.** `comparable_heldout` refuses two all-targets
perplexities whose held-out OOV rates differ by more than **one percentage point**. That number is a
judgement and the code says so in the comment beside it, which also names this run as the one that
should replace it. Backlog 78 is the item; this is the registration.

The reason a refusal is needed at all: an all-targets perplexity charges every OOV target as a
prediction of `<unk>`, and `<unk>` is by construction among the most frequent symbols a
closed-vocabulary model holds. A model that knows fewer words is therefore asked an easier question on
a larger share of the same text. E6 needed the refusal — two Kneser-Ney models at the same
`max_size` over 20M and 64M tokens land 1.09 points apart on held-out OOV and share only 82.6% of
their 8,192 types.

What nothing has measured is how large that discount actually is. Until it is measured, the threshold
is a round number defending a real effect of unknown size, which is the same epistemic position as
D14's 2.9x before D16 took it apart.

### The cells

One model class, one corpus, one training budget, one held-out set. **The vocabulary cap is the only
thing that moves.**

| cell | `max_vocab` | expected types | measured |
|---|---|---|---|
| A′ | 8,192 | 8,192 | **30.7** (E6, reused unchanged) |
| V1 | 16,384 | 16,384 | to be measured |
| V2 | 32,768 | 32,768 | to be measured |
| V3 | none | ~71,883 | to be measured |

Every cell is Kneser-Ney order 4, `min_count` 3, trained on the **train side of frozen set
`8e2d77cbe8901b1e`** under a 20,000,000-token ceiling, and scored on that set's 366 held-out
documents. A′ is E6's cell A′ at exactly this configuration, so it is reused rather than retrained —
and because it is reused, a disagreement between V1/V2/V3 and A′ on anything other than vocabulary is
a defect in this run rather than a finding.

V3's expected size is arithmetic from A′'s record, not a guess: 8,192 kept types plus 63,691 types the
cap discarded is **71,883 types that clear `min_count` 3 in the first 20M tokens**. If V3 reports a
different number, the corpus read moved and the sweep is invalid.

This sweep deliberately does **not** reach the shipped model's 148,353 types. That vocabulary comes
from 64M tokens, and adding a cell that changes both the cap and the training size would reproduce
exactly the confound E6 found in the cap-versus-vocabulary distinction. 148,353 types at 20M tokens
does not exist to be measured.

### Two readings, because one of them is confounded and the other is not

**All targets** is the measurement the threshold governs, and it mixes two effects that pull against
each other: raising the cap removes the cheap `<unk>` predictions, and it also gives the model real
histories where it previously had `<unk> <unk>`. The net slope is the confounded quantity, and it is
the *right* quantity for the threshold, because `comparable_heldout` is guarding against precisely
that confounded difference.

**In-vocabulary only** drops every OOV target from the sum. It isolates modelling ability from the
`<unk>` discount, at the cost of each cell summing over a different target set — which is why
`comparable_heldout` refuses those comparisons outright rather than tolerating a gap. Reported here as
a decomposition of the net slope, never as a ranking.

### The prediction

Backlog 78 recorded no prediction on the grounds that the direction is not obvious. I disagree that it
is unpredictable, so here is one that can be wrong.

**All-targets perplexity rises as the cap rises.** The slope of perplexity against held-out OOV rate is
**negative**: more OOV means a lower, flattered number. The reason is that the 63,691 types the cap
discards are the tail — each is rare, each is expensive to predict, and the context they return to the
model is worth less than the `<unk>` discount they cost.

**Magnitude: between 3 and 10 perplexity points per percentage point of OOV**, read at A′'s base of
30.7. Concretely, V3 lands between **45 and 70** at roughly 2% held-out OOV.

If that holds, the current threshold is far too loose rather than too tight: one percentage point
would be worth 10% to 30% of the score, and two models the function currently calls comparable could
differ by more than E6's entire 2.086x effect. If the slope comes out under 1 point per point, the
round number was generous and the refusal is close to decoration.

### Fixed readings

- **The threshold is re-derived from the fitted slope, and E4 must still pass.** E4 compared
  `min_count` 2 against 3 on all targets at 0.63% and 0.85% OOV. That comparison was sound. A
  threshold that refuses it is wrong however it was derived, so the derived value is floored at the
  gap E4 needs and the floor is reported if it binds.
- **The slope is fitted on all four points and also read pairwise.** A single pair is a difference,
  not a slope. If the pairwise slopes disagree by more than 2x the relationship is not linear in OOV
  and the threshold is stated as a curve or as the worst case, not as one number.
- **A ceiling that binds voids the cell.** `stopped_because` decides, on both passes. A cell whose
  token ceiling did not bind at 20,000,0xx read a different amount of text than A′ did.
- **V3's type count is checked against 71,883 before its perplexity is read.** The arithmetic above is
  a pre-registered prediction about the corpus, and it is cheaper to be wrong about it early.
- **A truncated score voids the cell.** V3 is the largest model here and the one most likely to hit the
  resident-set ceiling; `scripts/score_heldout.py` already exits 2 on truncation.
- **Being outside the predicted range is the more useful outcome.** E7's registered range was wrong by
  2.7x and that was worth more than a hit.

**Result: D25 and D26. Half right, and the half that was wrong is the specific one.** The slope is
negative as predicted and the fit of **-3.391 points per percentage point** (r-squared 0.977) is inside
the registered 3-to-10 band, but V3 came in at **42.77**, below the registered 45-to-70 range. The four
cells are 30.95 / 35.52 / 39.31 / 42.77 at 5.797% / 4.044% / 3.063% / 2.391% held-out OOV.

The sweep was measured twice, and every fixed reading fired.

**"V3's type count is checked against 71,883 before its perplexity is read."** The first measurement
said **71,934**, and the cause is that `docs/` was a corpus source: the commit carrying this
registration added 94 lines to this file, and `docs/SECURITY-OPS.md` had arrived since A′ was trained.
**Writing the registration changed the corpus the registration was about.** The reading's verdict stood,
the 8,192 cell was retrained rather than reused, and it reproduced A′ to 0.03 perplexity points.

Writing up the *result* did it again and worse — each cell of a retrain landed on a different corpus
digest — so **D26 took the repository's own prose out of every measurement** and the sweep above is the
re-measurement on the stable corpus, one digest across all four cells. The pre-D26 figures are in
`analysis/records/e8-v*-pre-d26.json` and agree closely: 30.73 against 30.95, 42.50 against 42.77.

**"The slope is fitted on all four points and also read pairwise."** This is the reading that paid for
itself. The stable corpus gives six pairwise slopes of -2.610 to -5.148, a spread of **1.972x** — under
the 2x line, so the rule says use the fit. The pre-D26 corpus gave -2.583 to -5.179, a spread of
**2.005x** — over it, so the rule said use the worst case. **The two corpora differ by 0.105% and the
verdict flips.** So the registered test does not discriminate, the threshold takes the worst pairwise
slope unconditionally as the conservative side of a coin toss, and `oov_slope.py` records
`slope_used: "worst_pairwise"` with `linear` reported as a reading wired to nothing.

**"E4 must still pass."** It does, and the floor needed correcting to make it: set to E4's gap exactly it
refused E4 by six parts in 10^19, because `0.0085 - 0.0063` is `0.0022000000000000006` and the refusal is
a strict `>`. The floor is 0.0023 and the derived gap is 0.3006 points at the 8,192 cell's perplexity, so
the floor does not bind.

The decomposition also corrected the reason written beside the threshold. Scoring every cell over
in-vocabulary targets only puts `<unk>` **cheaper** than the average real token at 8,192 types (32.51
against 30.95) and **dearer** at 71,603 (41.76 against 42.77), crossing over near 3% OOV, while
all-targets perplexity rises monotonically throughout. The `<unk>` discount the comment named is real,
small, and changes sign; the dominant term is rare words the cap used to hide.

The threshold is now `allowed_oov_gap` in `evaluate.py` — 5% of the smaller perplexity divided by the
worst measured slope, floored at E4's gap and capped at the old 0.01 so that E8 tightens the guard at
every perplexity and loosens it at none.

## E9. A transformer at the n-gram's vocabulary, via sampled softmax

**Registered 2026-09-14, before any code was written.** Backlog 79 is the item and it says why this needs
a registration rather than a run: reaching 148,114 types means changing the loss the model optimises,
and a cell whose loss is not the loss every other cell used is a cell that has to declare itself.

### The question E6 could not ask

E6 held both classes at **8,192 types** because the output projection is `d_model x vocab_size` and
every token's loss touches all of it. That is a real constraint and it bought a real comparison, but it
also means every transformer figure in this repository describes a model that has never been asked the
question the shipped model answers.

Worse, the two cannot be compared even in principle. `comparable_heldout` refuses the shipped model at
0.915% held-out OOV against cell A at 4.711% — a 3.80-point gap where D25 allows 0.23 — and it is right
to: E8 measured that the vocabulary difference alone could account for **19.5 perplexity points** of
whatever separates 19.9 from 25.8. At one vocabulary that refusal goes away.

**So this is the first cell that could be compared to the shipped model on all targets.** That is the
point of it.

### The cell

| cell | model | vocabulary | training tokens | measured |
|---|---|---|---|---|
| shipped | Kneser-Ney order 4, `min_count` 3 | 148,114 | 64,347,232 | **25.82** |
| **D** | **transformer, d128, 2 layers, ctx 128** | **148,114** | **64,347,232** | to be measured |

Same corpus read (`de7c24b2218ad055`), same `min_count` 3, same uncapped vocabulary, same frozen
held-out set. The transformer's output projection is tied to its embedding, so at this vocabulary that
one table is **18,958,592 parameters** against the 1.46M of every transformer cell so far.

### What changes, stated precisely

**Training** uses a sampled softmax: for each position the loss is computed over the target plus a
shared set of negatives drawn log-uniformly over the frequency-sorted vocabulary, each logit corrected
by `-log Q(id)`, with any negative that collides with the target masked out. That is an estimator of the
full softmax loss, not the full softmax loss.

**Evaluation does not change.** `logprob_terms` computes the full normalised distribution over all
148,114 types, exactly as every other cell is scored. A sampled softmax at scoring time would be a
different measurement wearing the same name, so the registered reading is that **cell D's perplexity is
a true held-out perplexity and is comparable to the shipped model's.**

### The prediction

**D lands between 55 and 110**, a loss of **2.1x to 4.3x** against the shipped model's 25.82, and my
point estimate is about 78 — roughly 3x.

Two forces pull against each other and I do not know the crossover. The transformer gets **3.2x more
text** than any transformer cell so far, and more data is the thing transformers are supposed to convert
into quality better than an n-gram does: Kneser-Ney converts that same 3.2x into only 1.2x (30.95 to
25.82), which is the shape of a model that has stopped learning from more of the same genre. Against
that, the output space is **18x larger**, the tail it now has to predict is exactly the part a cap used
to hide, and E8 measured that going from 8,192 to 71,603 types costs 38% of perplexity on its own.

If D beats 25.82 the headline of this repository changes and D20's "needs somewhere north of 10^8 tokens
before its perplexity beats a well-smoothed 5-gram" is wrong at 6.4 x 10^7. I do not expect that.

### Fixed readings

- **A ceiling that binds voids the cell.** `stopped_because` decides, on all three budgets, and
  `epochs_completed` below 1.0 means D saw less text than registered.
- **D is compared to the shipped model on all targets, and the comparison must not be refused.** Both
  sit at 148,114 types on one corpus read, so their held-out OOV should agree to the digit. If
  `comparable_heldout` refuses the pair, the cell is invalid rather than close — that refusal is the
  whole reason this cell exists.
- **The sampled-softmax gap is reported, not assumed away.** The final training loss is recorded twice,
  once under the sampled estimator and once under the full softmax on the same batch. A large gap means
  the number measures my estimator rather than the architecture, and it is the first thing to doubt.
- **The backward pass is gradient-checked exhaustively against central differences**, on a fixed sample
  set so the loss is deterministic, to the same standard D24 held the LSTM to. The sampled path is new
  code on the one part of the model that carries 93% of its parameters.
- **A loss is a result.** Being outside 55-to-110 in either direction is worth more than being inside.
- **No shape, learning rate, sample count or token cap moves after a result is seen.**

### E9 amended 2026-09-14, before any result was seen: a training cap, and why

The cell as registered is **not reachable in this environment**. Measured rather than estimated: at
148,114 types the step is ~1.0s — 684ms in `loss_and_grads_sampled` and 307ms in the optimiser — which
puts one epoch over 64,347,232 tokens at about **4.7 hours**, in a container that has already restarted
once mid-run and killed it.

I looked for a faithful speedup first and did not find one. `np.add.at` on the tied embedding table was
the obvious suspect and is 4.9ms; replacing it with a sort-and-`add.reduceat` scatter is **slower** at
7.1ms. The real cost is the transformer body — 127ms for a forward pass of roughly 1.5 GFLOP, about 12
GFLOP/s on a machine measured at 420 — and that is E6 cell B's cost too, not something this cell
introduced. Making Adam sparse over the embedding table would help and is **not** faithful: dense Adam
decays `m` and `v` for untouched rows, so a sparse version optimises a different objective and would be
a different cell.

**So the amendment is a token cap and nothing else.** `--max-train-tokens 20000000`, giving cell D
about 18.3M real training tokens.

The vocabulary is untouched, which is the point: the vocabulary pass still reads all 64,347,232 tokens
and still produces exactly **148,114 types**, because that is what `min_count` 3 over the full training
side yields. E9's claim was never about training size — it was that a transformer at the n-gram's
vocabulary can be compared to the shipped model on all targets at last, and that still holds.

**The new asymmetry, stated before the result and running against cell D.** The shipped model read
64,347,232 tokens; cell D now reads about 18.3M. That is 3.5x less text, it is quoted with every cell D
figure, and it means a loss is *weaker* evidence than it looks while a win would be *stronger*.

It also buys a comparison the original could not make. Cell D and E6's cell B now train on the same
~18.3M tokens and differ only in vocabulary — 8,192 against 148,114 — which is E8's question asked of a
transformer instead of an n-gram.

**The prediction moves with the training size, and this is the honest place to say so.** The registered
55-to-110 assumed 3.2x more text than any transformer cell had seen. At 18.3M tokens I expect cell D
between **90 and 200**, against cell B's 64.29 at the same text and one eighteenth of the vocabulary.
The original 55-to-110 is recorded as superseded rather than deleted, and if cell D lands there anyway
that is a result about how little the extra text was worth.

### The amendment above was committed fifteen seconds after the run started

Noted 2026-09-14, with cell D at step 4,400 of 4,882 and no result of any kind in existence. This
file's own rule, six lines from the top, is that it "is not edited after a run starts, except to link
the result", and the amendment breaks it: the training process started at 09:20:10 and the commit
carrying the amendment landed at 09:20:25. I launched and then committed, rather than committing and
then launching.

**What the rule is for held; what the rule says did not.** The purpose of registering before the run
is that no reading may be chosen in light of a result, and at 09:20:25 there was no result to choose
in light of — the first progress line printed minutes later, and the first number that could move a
prediction is the perplexity, which does not exist while this is being written. The token cap itself
was derived from a timing measurement made before either moment, and the cap is in the command line
that started at 09:20:10, so the run and the registration describe the same experiment.

**It is recorded because the alternative is worse.** A fifteen-second gap is the exact size of
violation that is easiest to not mention and most corrosive to mention selectively: the discipline is
worth something only if it is reported when it is inconvenient and trivial, not only when it is
serious. Anyone reading E9's result is entitled to know the registration landed after the process id.

**No reading changes.** The prediction stays 90 to 200, the superseded 55-to-110 stays recorded, the
fixed readings stay as registered, and this note adds nothing to what cell D is measured against. It
was written before the number existed precisely so it cannot be read as an excuse constructed after
seeing one.

### E9 result, 2026-09-14

**Cell D scores 142.41 against the shipped Kneser-Ney's 25.82. The n-gram wins by 5.52x, at the same
vocabulary, on the same frozen set, with the comparison not refused.**

| | shipped Kneser-Ney | cell D transformer |
|---|---|---|
| types | 148,114 | 148,114 |
| training tokens | 64,347,232 | 18,341,790 |
| held-out OOV | 0.915101% | 0.915101% |
| **held-out perplexity, all targets** | **25.815** | **142.408** |
| truncated | none | none |

Both scored 3,443,116 tokens over 366 documents, 3,411,608 of them in vocabulary, on frozen-set
fingerprint `1446762140db7f1a`.

**The registered readings, in the order they were registered.**

*A ceiling that binds voids the cell.* None bound. Training stopped on `epochs` at
`epochs_completed` 0.99982, and both scorings report `truncated: null`. The cell is valid.

*The comparison must not be refused.* It is not. The two OOV rates are not close, they are
**identical to every digit** — 0.009151013210127124 against 0.009151013210127124 — because both
models draw the same 148,114 types, so the same tokens fall outside on the same frozen set.
`allowed_oov_gap` sized a budget of 0.2507% for these perplexities and the gap is zero. This was the
whole reason the cell exists: E6 could not separate the architecture from the vocabulary, and this
pair differs in nothing but architecture and how much text each read.

*The sampled-softmax gap is reported, not assumed away.* It is **0.679 nats** — final training loss
4.6145 under the sampled estimator against 3.9352 under the full softmax on the same batch, or 100.94
against 51.17 as training perplexities. That is large, it runs in the direction that flatters nothing
(the estimator reports the model as *worse* than it is), and it is the first thing to doubt. It does
not touch the 142.41: scoring never uses the estimator, only the full normalised distribution, which
is why D2's "a sampled softmax at scoring time is a different measurement wearing the same name" was
worth the extra two hours of wall clock. What the gap does mean is that **the training signal cell D
learned from was a noisy estimate of the loss it was minimising**, and a cell trained against the
full softmax might land elsewhere. That is the honest caveat on this number and it is not small.

*A loss is a result.* 142.41 lands **inside** the amended 90-to-200 band and **outside** the original
55-to-110, which is recorded as superseded rather than deleted. The amendment moved the band because
the token cap cut the training text, not because a result had been seen; that it lands inside the
amended band and above the original is what you would expect if the cap mattered, and is weak
evidence that it did.

**The asymmetry, quoted here as registered.** Cell D read 18,341,790 tokens; the shipped model read
64,347,232. **3.51x less text.** The 5.52x is therefore not "a transformer loses to an n-gram by
5.5x" — it is "a transformer on 3.5x less text loses by 5.5x". Whether the transformer closes the
gap on equal text is not answered here and this cell cannot answer it: the full epoch that would
answer it is 4.7 hours of training on this machine, measured, in a container that has already
restarted once mid-run.

**What it does answer**, and the reason backlog 79 was worth doing: **the vocabulary was not the
explanation.** E6 found the transformer losing at 8,192 types and left open whether that was the
architecture or the 18x smaller vocabulary it had been forced into. At the n-gram's own vocabulary,
against the n-gram's own OOV rate, on the n-gram's own frozen set, it loses by more, not less. The
gap E6 measured was not an artefact of the cap.

**A defect the cell found, which is worth as much as the number.** Cell D trained for two hours and
then could not be loaded by its own loader: `MAX_LINE_BYTES` was a 64MB constant justified by a
comment about an 8,192 x 128 matrix, and cell D's `tok` line is 204,355,608 bytes. Every other line
in the file is under 1MB, so exactly one line in the format scales with vocabulary and nothing had
ever pushed on it. The bound is derived from the header's declared shape now, which tightens it for
every model that existed before this one. A constant that happens to exceed the largest model so far
is not a bound; it is a record of what had been trained by then.

**And a second one, in the tooling around it.** `score_heldout.py` defaults `--max-seconds` to 3600.
Cell D's scoring needs about 122 minutes, measured at 471 positions per second before it was
launched. The default would have stopped it at 60 minutes and reported a prefix score with
`truncated` set — a number that looks like a perplexity, is not one, and would have been compared to
the shipped model's full score. The ceiling was raised for this scoring run and the reading
`truncated: null` above is what confirms it did not bind.

#### The amendment's second claim was wrong, and the tool said so

The amendment above wrote: "It also buys a comparison the original could not make. Cell D and E6's
cell B now train on the same ~18.3M tokens and differ only in vocabulary — 8,192 against 148,114 —
which is E8's question asked of a transformer instead of an n-gram."

**Differing only in vocabulary is precisely what makes them incomparable.** `comparable_heldout`
refuses the pair:

> these were scored at 5.80% and 0.92% out-of-vocabulary, a gap of 4.88% against the 0.62% these
> perplexities can carry. E8 measured a point of out-of-vocabulary at up to 5.1 perplexity points on
> this corpus, so the vocabulary difference alone could account for 25.1 points of whatever separates
> 64.3 from 142.4

The naive reading is 64.285 against 142.408, a 2.215x loss for the larger vocabulary. Of the 78.1
points between them, up to 25.1 are the vocabulary rather than the model — so the ratio is not a
ratio, and E8's whole point is that a model can lower its perplexity by knowing fewer words.

I wrote that claim into the amendment on the way to the run and the machinery built to catch exactly
this caught it. That is the discipline working rather than failing: the registration was checkable,
it was checked, and it was wrong.

**The rescue, and it is exact.** Cell B's 8,192 types are a strict subset of cell D's 148,114 —
verified, zero B-only types, same frequency ordering — so `shared_vocabulary` restricts both sums to
the same targets and neutralises the gap completely rather than approximately. That is what
`evaluate(shared_vocabulary=...)` was built for under backlog 77, and the comparison it enables was
unreachable from a shell until now: nothing on `score_heldout.py`'s command line could pass it. It
takes `--shared-vocabulary MODEL` as of this result.

The restricted comparison asks a sharper question than the one the amendment claimed: **given the
same targets, is a transformer that also had to model 140,000 rare words worse at the common ones
than one that spent all its capacity on 8,192?** That is capacity dilution, and it is a better
question than the one refused.

#### The shared-vocabulary result: capacity dilution is real and is 1.291x, not 2.215x

Both cells re-scored over the same 8,192 targets, contexts untouched, `restricted_to_types: 8192` on
both records, neither truncated, same frozen set.

| | cell B, 8,192 types | cell D, 148,114 types |
|---|---|---|
| all targets | 64.285 | 142.408 |
| **restricted to the shared 8,192** | **69.120** | **89.229** |

`comparable_heldout` accepts the restricted pair — that path exists precisely so this decomposition
can be made — and the answer is **1.291x**, against the naive **2.215x** the refused comparison would
have reported.

**Most of the apparent gap was the question, not the model.** 58.0 of the 78.1 points between the two
cells, **74% of it**, disappears when both are asked about the same words. What remains is the real
effect: a transformer carrying 140,000 rare types is **1.29x worse at the common ones** than one that
spent all its capacity on 8,192. Capacity dilution exists and is modest.

**Both numbers move, in opposite directions, and that is the mechanism.** Cell B *rises* 64.285 →
69.120: it loses the `<unk>` targets that were cheap for it, because `<unk>` is common in its training
by construction. Cell D *falls* 142.408 → 89.229: it stops being charged for 140,000 rare types it
alone had to predict. Neither model changed; the question did.

**The refusal's own estimate was conservative, in the safe direction.** Its message said the
vocabulary difference "could account for 25.1 points of whatever separates 64.3 from 142.4". The
measured displacement is 58.0 points — more than twice that — so refusing was even more warranted than
the message claimed. The two figures are related and not the same quantity: 25.1 comes from E8's
slope, fitted on *n-grams* at different caps and extrapolated here, while restriction changes the
target set for both models rather than isolating an OOV term. That the extrapolation understates
rather than overstates is worth knowing and is not evidence against E8.

**What this does not rescue.** The 5.516x against the shipped n-gram is untouched: that pair needed no
restriction, because both models already sat at the same 0.915101% out-of-vocabulary. D28's headline
stands as measured.
