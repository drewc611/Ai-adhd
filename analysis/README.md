# `adhd_analysis`

Statistics over `evals/recorded/`. It reads the corpus the runs produced and reports how much of
it is real. Nothing here calls a model, nothing here runs during a run, and nothing under `src/`
imports it. If that stops being true, the package has become an inference client and D2 says
delete it.

```
cd analysis
pip install -e '.[dev]'
python -m adhd_analysis --root ..              # the report
python -m adhd_analysis --root .. --json       # the same numbers, machine readable
pytest                                         # 58 tests
```

## Why this exists

Every headline figure in the repository is a point estimate over seven runs. 79% critic
agreement. A 3.0x cost ratio. Per-frame prune rates out of two or three appearances. An
orthogonality rate of 2 in 3. `docs/EXPERIMENTS.md` says those are single-sample noise and
`docs/RETIREMENT.md` refuses to act on one of them for that reason, but neither says *how*
uncertain, because nothing had computed it.

Two things follow from computing it.

**79% agreement is not 79% reliability.** Percent agreement counts matches and never asks how
many of those matches chance explains. Krippendorff's alpha does. Over the same 630 marks:

| dimension | alpha | 95% interval | % exact | ceiling | distinct values |
|---|---|---|---|---|---|
| `reversibility` | **+0.850** | [+0.73, +0.94] | 76% | 19% | 4 |
| `assumption_attack` | +0.773 | [+0.57, +0.91] | 70% | 50% | 3 |
| `specificity` | +0.731 | [+0.43, +0.94] | 84% | 14% | 3 |
| `reasoning_carries` | +0.678 | [+0.68, +0.70] | 98% | 94% | 3 |
| `actor_coverage` | +0.557 | [+0.34, +0.71] | 84% | 36% | 2 |
| `falsifiability` | +0.517 | [+0.16, +0.82] | 82% | 76% | 3 |
| `substance` | +0.508 | [+0.31, +0.65] | 76% | 69% | 3 |
| `committal` | +0.402 | [-0.05, +0.68] | 86% | 86% | 3 |
| `foreclosure` | **-0.017** | [-0.04, +0.00] | 96% | 94% | 2 |

The two orderings invert. `foreclosure` is second-best by percentage and last by alpha: the
critics agree 96% of the time because 94% of its marks are the same mark, and corrected for
chance that agreement is worth nothing. `reversibility` is third from the bottom by percentage
and first by alpha, because the thing the critics agree about actually varies.

That is D8 finding 5 arriving from a second direction and with a sign on it. Finding 5 identified
`foreclosure` and `reasoning_carries` as scoring the output contract and the D4 tool allowlist
rather than the reasoning, and reached that conclusion from ceiling rates. Alpha reaches it
without being told which dimensions to suspect.

**`committal` and `foreclosure` have intervals that contain zero.** Whatever their point
estimates, seven runs cannot distinguish them from chance. A dimension whose interval spans
chance is unmeasured, not weak.

**All nine dimensions push the same way on whether an artifact is pruned.** `learn --correlation`
already reports max |r| = 0.51, so no two dimensions are redundant with each other. Fit a
logistic regression on all nine and every coefficient is negative. That is one latent factor
wearing nine names, and a pairwise correlation matrix has no column that could show it.

## The model, and what it is not

`signal.py` fits `sklearn.linear_model.LogisticRegression` on the nine blind pass A scores and
predicts whether an artifact was pruned. Leave-one-run-out accuracy is 71% against a 54%
always-majority baseline.

It is a measurement instrument, not a component. **Pass A does not prune; a fired trap does**
(`docs/BACKLOG.md` item 24). So the model is not modelling the mechanism, it is asking whether
the blind critic score carries information about an outcome it does not drive. Separation means
the critic pass and the detector sweep are measuring overlapping things, which is a redundancy
finding. No separation means they are independent, which is what a critic pass and a detector
sweep are supposed to be.

Every number is cross-validated leave-one-*run*-out. Grouping by run is not a detail: artifacts
within one run share a problem, a critic and a frame set, so a random split leaks across all
three and reports a score several points too high. At n=35 with 9 features an in-sample accuracy
would be near-perfect and would mean nothing.

## Modules

`corpus.py` loads `evals/recorded/` into arrays, forwarding frame ids through `former_ids` so the
two runs that wrote `END_USER` land on `SUPPLICANT` instead of becoming a tenth frame. Negative
controls are not runs and are not loaded as runs.

`reliability.py` is Krippendorff's alpha over a coincidence matrix, with nominal, ordinal and
interval difference metrics, plus percent agreement, within-one, ceiling rate and distinct value
count for comparison. A constant returns `None`, not `1.0` — every rater giving every unit the
same mark means there is no variance to explain, and calling that perfect reliability is exactly
how a dimension pinned at its ceiling gets reported as the best-defined one in the rubric.

`resample.py` is a percentile bootstrap over whole groups and a two-sided permutation test. Runs
are the unit of independence, not cells: resampling 225 correlated cells as if they were
independent produces an interval several times too narrow. Percentile rather than BCa, because
BCa's bias correction comes from a jackknife with seven points and would be noisier than the
thing it corrects. Permutation p-values use the (r+1)/(n+1) convention, so a p of zero is never
reported at a sample size that cannot support it.

`signal.py` is the model above. `report.py` is the text.

## Alpha was wrong once

The first implementation used raw value frequencies where the coincidence matrix's row sums are
required. The two agree when every unit has the same number of raters and diverge when they do
not, and this corpus has runs with one, two and four raters. It produced plausible numbers.

What caught it was refusing to validate against a remembered constant. For two raters and no
missing cells, nominal alpha has a closed form that can be derived from the coincidence
definition rather than looked up:

```
alpha = 1 - (1 - Po)/(1 - Pe) * (2N - 1)/(2N)
```

`test_reliability.py` checks the implementation against that over 25 random datasets to 1e-9.
When the fixed implementation still disagreed with figures remembered from a paper, the closed
form was the thing to trust.

## Sources

Krippendorff, K. (2004). *Content analysis: An introduction to its methodology* (2nd ed.). Sage.

Krippendorff, K. (2011). *Computing Krippendorff's alpha-reliability*. Departmental Papers (ASC),
University of Pennsylvania. https://repository.upenn.edu/asc_papers/43

Efron, B., & Tibshirani, R. J. (1993). *An introduction to the bootstrap*. Chapman & Hall.

Phipson, B., & Smyth, G. K. (2010). Permutation p-values should never be zero: Calculating exact
p-values when permutations are randomly drawn. *Statistical Applications in Genetics and Molecular
Biology, 9*(1), Article 39. https://doi.org/10.2202/1544-6115.1585

Pedregosa, F., Varoquaux, G., Gramfort, A., Michel, V., Thirion, B., Grisel, O., … Duchesnay, É.
(2011). Scikit-learn: Machine learning in Python. *Journal of Machine Learning Research, 12*,
2825–2830.

## The background model

```
python -m adhd_analysis.text.train --manifest corpora.yaml --out models/background.kn.gz \
  --record models/training-record.json --order 4 --min-count 2
python -m adhd_analysis --root .. --model models/background.kn.gz
```

Modified Kneser-Ney, trained from scratch on the document libraries declared in `corpora.yaml`.
Standard library only: no weights are downloaded, none ship, and the package gained no dependency
for any of it. Every parameter is a count taken from a corpus on this machine.

Not a transformer, for a reason that is arithmetic rather than policy. A transformer trained from
scratch needs somewhere north of 10^8 tokens before its perplexity beats a well-smoothed 5-gram,
and a GPU to get there. Kneser-Ney reaches useful perplexity at 10^6 to 10^7 tokens, trains in one
pass on a CPU, and its parameters are inspectable: a suspicious score traces to the exact context
that produced it.

**What it measures.** T1 is the consensus trap, and it is the one trap whose detector cannot see
the thing the trap is about: prose that reads like every other document on the subject. Mean
surprisal under a background model is low exactly there, and the per-token vector says which
clauses were the predictable ones.

**The corpus is RFCs**, fetched by `scripts/fetch_corpus.py` and gitignored. Not literature: the
artifacts being scored are engineering arguments with a fixed shape, and that is the RFC genre
almost exactly. A model trained on public-domain novels would faithfully report that a branch
artifact reads unlike a Victorian novel.

4,901 RFCs, 615 PEPs, 529 EIPs and the repository's own prose: **55.4M tokens, 177,507-word
vocabulary, 36.5M 4-grams, 622 seconds, 9483MB peak, nothing pruned.** Held-out perplexity **6.06**
on 3,097,500 tokens at 0.15% OOV. Every discount row is a real modified-Kneser-Ney estimate rather
than the 0.75 fallback.

Two comparisons, neither preregistered:

- **Pruned against kept**: 9.60 bits against 9.65, permutation p = 0.68. Null, and null is the
  better outcome — it says the detectors are catching something the surface statistics miss.
- **T1 fired against the rest**: 9.82 bits against 9.58, +0.243 at p = 0.078, and **the sign is
  backwards**. T1 is the consensus trap, so the artifacts it fires on should read as *more*
  predictable. They read as less. The detector is a written rule over what an artifact claims, not
  over how it reads, and on this evidence those measure different things.

**The effect size is stable across four corpora. Its p-value is not.**

| corpus | tokens | difference | p |
|---|---|---|---|
| 492 RFCs | 5.6M | +0.226 bits | 0.048 |
| 1,974 RFCs | 22.9M | +0.261 | 0.0455 |
| mixed, pruned | 40.0M | +0.224 | 0.0950 |
| mixed, unpruned | 55.4M | +0.243 | 0.0780 |

Ten times the text and a change of genre moved the difference by 0.04 bits. The p-value wanders
across 0.05 and never clears it decisively.

Earlier versions of this file read the p-value as the finding twice, in opposite directions: after
the RFC-only increase it said the effect had *survived*, and when the genre-diverse corpus moved p
to 0.095 it said the effect had *weakened*. Neither was right. **What is underpowered is n=7 in the
fired group against 28, and no amount of background text fixes that.** Backlog item 1, multi-seed
replay, is the only thing that would. The report prints that caveat beside the number every time.

**Two things the measure will lie about if you let it.** It is relative to what it trained on:
against these docs, "it is important to note that this is a comprehensive solution" scores as
*surprising*, and against a general library it scores as generic. And a closed vocabulary maps
invented words to `<unk>`, which is common in the training data by construction, so nonsense reads
as unremarkable rather than original. Mean surprisal is taken over in-vocabulary tokens only and
the OOV rate is reported beside it.

### Held-out perplexity, and the two defects finding it exposed

```
python -m adhd_analysis.text.evaluate --manifest corpora.yaml --orders 3,4,5 --out models/orders
```

Until this existed, "we trained on more text" was a claim with no way to be wrong. The trainer
reports vocabulary size, n-gram count and wall clock, and **all three go up when the model gets
worse**: a model that memorises its corpus has the largest table available.

Documents are split by a deterministic stride, one in twenty held out, and the vocabulary is built
from the training half only — `SplitLibrary` yields one side, so `train()` never sees the other.
Building the vocabulary over everything hands the model every word it is about to be tested on and
the OOV rate collapses for a reason that has nothing to do with the model. The stride is over
*documents*, never sentences: two sentences from one RFC share a topic, an author and a vocabulary.

Over 1,974 RFCs, 21.8M training tokens, scored on the same 1,088,715 held-out tokens:

| order | n-grams | held-out perplexity | peak RSS | seconds |
|---|---|---|---|---|
| 3 | 7.5M | 46.2 | 1.9GB | 102 |
| 4 | 16.7M | 38.6 | 4.9GB | 207 |
| 5 | 27.8M | **36.0** | 9.2GB | 340 |

**Order 5 has the best perplexity and order 4 is still the right default.** 3→4 buys 16.4% for
2.2x the table; 4→5 buys 6.8% for another 1.7x and 9.2GB, which is past `Budget.weekly()`'s
5120MB. Order 5 does not fit a hosted runner at this corpus size and order 4 fits with about 200MB
to spare. The corpus size is what decides it, not taste.

**The first run of this comparison got the answer backwards**, and its own output said so. It
reported order 5 at perplexity 101.1 and named order 4 the winner. Two numbers gave it away: the
vocabulary was identical across all three orders and the OOV rates were not, which is impossible on
one held-out set. Scoring is deeper per token at a higher order, so the wall-clock ceiling shared
with training truncated order 5's evaluation and not order 3's, and the three orders were ranked on
three different slices of text. `comparable()` now refuses to print a ranking when the held-out
token counts differ or any evaluation was cut short.

**And loading a model was outside the budget entirely.** `Budget` governed reading a corpus and
counting n-grams and nothing about reading the result back, so a model trained under a 9.5GB
ceiling was loaded into a process that reached 11.9GB. `KneserNey.load` now takes an optional
budget, and `Budget.touch()` exists because `spend(0)` never advances the counter that gates the
periodic memory check — a load spends memory and no tokens.

### The ceiling

`budget.py` is consulted by the trainer, not wrapped around it. A refused `allows()` stops the
read and seals the model that exists, with the reason in its metadata — a legitimate model of a
truncated corpus. A timeout kills the process and leaves nothing, on the week the corpus grew
rather than the week the code changed, which reads as flake and gets the job disabled.

Four ceilings: tokens against corpus growth, wall clock against the runner's job limit, distinct
n-grams against table growth, resident set against the runner's memory. `relieve()` clears only a
size refusal, and checks the stored reason rather than trusting the caller, because a clearable
wall-clock refusal leaks one batch of work per call.

`agents/adhd-trainer.md` runs it weekly; `agents/adhd-governor.md` sets the ceilings and has no
Bash, because a governor that can run the job it caps eventually runs it.

### Sources

Chen, S. F., & Goodman, J. (1999). An empirical study of smoothing techniques for language
modeling. *Computer Speech & Language, 13*(4), 359-394. https://doi.org/10.1006/csla.1999.0128

Kneser, R., & Ney, H. (1995). Improved backing-off for m-gram language modeling. *1995
International Conference on Acoustics, Speech, and Signal Processing, 1*, 181-184.
https://doi.org/10.1109/ICASSP.1995.479394
