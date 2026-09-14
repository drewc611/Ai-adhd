# One run, end to end

Every command below was run against this checkout and every block of output is what it printed.
Where output is cut, the cut is marked. Nothing here is illustrative.

The run under examination is `evals/recorded/001-first-run`: fixture 001, five branches, recorded
on 2026-09-04. It is the run `docs/FAILURES.md` calls the one that works, and reading it beside
`001-seed2` at the end is the least flattering thing in this repository.

## 1. Compile, and stop

```
$ printf 'What timeouts should I set on this HTTP client?' > /tmp/adhd-example/problem.txt
$ adhd run --phase compile \
    --problem /tmp/adhd-example/problem.txt \
    --decision '{"problem_class":"design_decision"}' \
    --runs-dir /tmp/adhd-example/runs
```

```
run 20260914102632-7e664e

PROBLEM (verbatim, 47 bytes, this exact text was hashed):
---
What timeouts should I set on this HTTP client?
---
problem_hash: sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394
class: design_decision    seed: 1042211852    n: 5

frames, in dispatch order:
  FRAME_BREAKER     axis=frame_validity agent=adhd-branch
  DOOR_KEEPER       axis=reversibility  agent=adhd-branch
  MINIMALIST        axis=scope          agent=adhd-branch
  ACTOR_CENSUS      axis=actors         agent=adhd-branch
  LEDGER            axis=cost           agent=adhd-branch

estimate (order of magnitude): 156,000 tokens
  branches 60,000  critic 60,000  deepen 36,000

Nothing has been spent. Confirm the text above is exactly what you meant before any branch is spawned.
```

Two things in that output are the point of it.

The hash is `7e664e...`, and so is the hash in `evals/recorded/001-first-run/plan.json`, written ten
days earlier. The same 47 bytes compile to the same hash, which is what lets a branch's echoed hash
mean anything at all. Change one character of the problem and every downstream artifact is refused.

And it stopped. 156,000 tokens is the estimate for what happens next, and D5 says a system that
spawns seven subagents without asking fails its own fixture 001. The gate prints the problem back
verbatim because the most expensive failure is discovering after the spend that the compiler was
given a typo.

The frame order differs from the recorded run's — that run drew a different seed — so this is the
compiler reproducing a hash, not a run reproducing itself. Runs are reproducible at a fixed seed;
`adhd replay` at the end is where that gets checked.

## 2. What one branch is handed

The brief is the entire input to one subagent. `evals/recorded/001-first-run/briefs/LEDGER.md`,
first 22 lines:

````
# Branch brief

You are one reasoning process. You have a problem, a frame, and an output contract. That is
the whole of your input. Do not guess at context beyond this brief; there is none you are
entitled to.

## Problem

Echo this hash in your output exactly: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`

The problem, verbatim:

```
What timeouts should I set on this HTTP client?
```

## Frame: Ledger

Every option has a bill, and someone who did not ask the question pays it. Find the currency: money, tokens, latency, on call sleep, user trust, carbon, opportunity. Find the payer. Your position is the option that minimises the bill the asker has not noticed they are running up, and it must name the payer and the currency.
````

Read what is *not* in it. No other frame's name, no other branch's output, no count of how many
branches there are, no "so far". A test fails the build if any of those appear, because an
instruction to ignore what you read above is not isolation and every in-context divergence
technique is built on exactly that. The separation here is a separate context window.

## 3. What it returns

`branches/LEDGER.yaml`, opening lines and its falsifier:

```yaml
problem_hash: sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394
frame: LEDGER
position: Set a short connect timeout (about 1 to 2 seconds), a per-request total deadline sized
  to the slowest legitimate response you have actually measured plus a small margin (typically 2
  to 5 seconds for an API call), and cap retries at one with jitter, so the bill for a slow
  dependency is paid by the caller failing fast rather than by the downstream service and its
  on-call engineer absorbing a pile-up.
```

```yaml
falsifier: Pull the dependency's real response latency histogram for the last week; if the p99.9
  of legitimate successful responses is well above the proposed total deadline and those slow
  responses are ones the business needs to succeed rather than fail, the deadline is too tight
  and this position is wrong for that endpoint.
```

The contract check on it:

```
$ adhd traps evals/recorded/001-first-run/branches/LEDGER.yaml
```

```
artifact: evals/recorded/001-first-run/branches/LEDGER.yaml
contract: ok (frame LEDGER, confidence medium)
lints: none fired (T3, T4, T5 checked). T1, T2, T6, T7, T8 need the critic.
```

That last line is the honest part. Three of eight traps have mechanical detectors that run here;
the other five need a reader. `adhd frames --forbidden` counts the same gap across the frame
library and finds 35 of 39 `forbidden` entries have no mechanical form at all.

## 4. What happened to a frame that lost

```
$ adhd why evals/recorded/001-first-run MINIMALIST
```

```
MINIMALIST in 001-first-run

Dispatched on the axis: scope
Tools allowed: none

Position: Set a single overall request deadline of 10 seconds on the client and change nothing else.

Pass A (blind, as artifact E). Weighted total 0.7083, weakest first:
  assumption_attack    1/3 x2  Names that the question presumes granularity matters and assumes no streaming endpoints, but tests neither.
  actor_coverage       2/3 x1  Upstream owner named with the action of publishing an SLO or p99 figure, but the 10s stands without it.
  reversibility        2/3 x1  Orders the recommendation as cheap one-number-now, tune-later-on-evidence, without building a full sequence.
  specificity          1/3 x3  Nothing depends on HTTP or this client; the same 'one generous total deadline' applies to any blocking call.
  reasoning_carries    3/3 x1  No authorities; argued from the pain and the smallest fix.
  falsifiability       2/3 x2  A timeout firing against a dependency that responded under 10s is cheap to observe, but the reasoning already treats such errors as the planned next step rather than a refutation.
  committal            3/3 x2  One sentence, one number, 'change nothing else', no escape hatch.
  foreclosure          3/3 x2  Rules out per-phase timeouts, per-route values up front, and retries or circuit breakers, all real and tempting.
  substance            3/3 x2  Flat restatement 'set a 10 second total deadline' is exactly the claim.

[cluster section cut]

Pruned by these detectors:
  T1: The branch itself states connect vs read distinction 'buys nothing' and gives a single wall-clock deadline; delete 'HTTP' and 'this client' and the answer 'one 10s total deadline' is unchanged for any blocking call.
  T2: It accepts that the timeout lives on the client and is picked once by the developer, and explicitly labels per-call and per-route considerations 'imagined pain' rather than testing them.
  T6: Only the asker and the upstream owner are named; the caller who inherits 10s, the end user waiting on it, the operator who needs a knob during an incident, the scheduler, and the attacker are all absent, and the caller in particular decides whether 10s is generous or fatal.
```

"as artifact E" is the blinding. Pass A scored a letter, not a frame: the critic could not know that
E came from the scope frame, and a test fails the run if a frame label reaches the pass A brief.
MINIMALIST scored 3/3 on committal and foreclosure — it is a *good* answer by every instinct a
quality rubric encodes — and was pruned anyway, on T1, for being an answer that does not depend on
the question. That is the whole argument for not replacing the critic rubric with a quality one.

## 5. What the user gets

The pruned block, from `synthesis.md`, in full:

```
## Pruned, with reason

- **LEDGER**: Set a short connect timeout (about 1 to 2 seconds), a per-request total deadline sized to the slowest legitimate response you have actually measured plus a small margin (typically 2 to 5 seconds for an API call), and cap retries at one with jitter, so the bill for a slow dependency is paid by the caller failing fast rather than by the downstream service and its on-call engineer absorbing a pile-up.
  - traps: T2, T7
  - detector output: T2: The load bearing assumption is that the timeout is a property of the client set once by the developer; LEDGER accepts it wholesale and only argues about which static number and who pays for it. | T7: Every recommendation is presented at equal weight with no statement of what it costs to be wrong about connect vs total vs retry or how long until you learn; 'one afternoon of measurement' is a cost estimate, not a reversibility distinction.
- **MINIMALIST**: Set a single overall request deadline of 10 seconds on the client and change nothing else.
  - traps: T1, T2, T6
  - detector output: T1: The branch itself states connect vs read distinction 'buys nothing' and gives a single wall-clock deadline; delete 'HTTP' and 'this client' and the answer 'one 10s total deadline' is unchanged for any blocking call. | T2: It accepts that the timeout lives on the client and is picked once by the developer, and explicitly labels per-call and per-route considerations 'imagined pain' rather than testing them. | T6: Only the asker and the upstream owner are named; the caller who inherits 10s, the end user waiting on it, the operator who needs a knob during an incident, the scheduler, and the attacker are all absent, and the caller in particular decides whether 10s is generous or fatal.
```

The page says "Rendered by code from the run artifacts. No model wrote this page. The pruned block
is always present." Both halves are enforced. A cancelled run has no pruned block because no critic
ran, and it has to say the sweep did not happen rather than shipping a clean-looking page — there
is a kernel test for exactly that, because a reader who has learned to look for the pruned block
reads its absence as nothing having been pruned.

## 6. Checking it

```
$ adhd eval
```

```
OK   fixture 001  evals/recorded/001-first-run  -> PASS
OK   fixture 001  evals/recorded/001-linear-cot  -> FAIL (expected to fail: negative control: the linear CoT answer from README.md. If this passes, the fixture or the harness is broken.)
       x must_surface human_cancel (T6): The human waiting is an actor who can cancel. The bail out path is modelled.
       x must_surface retry_cost (T6): Someone pays for the retry, and the answer says who and in what currency.
       x must_surface trap_named: At least one trap id with detector output appears in the pruned block.
       x expect pruned_min 1: pruned block lists 0
[other runs and assertions cut]
```

The control is the useful line. `001-linear-cot` is what a competent single pass produces on the
same problem, and it fails on four assertions the real run holds. A fixture with no control is a
fixture nothing has to beat.

```
$ adhd replay evals/recorded/001-first-run
```

```
001-first-run: drifted as the baseline records, from line 16: Recorded 2026-09-04, before three renderer changes: the Close call line naming the margin, the split of folded positions out of the pruned block into their own section, and defend -> defended. The run's findings are unchanged.
```

The recording is evidence and is never rewritten to match a newer renderer. Drift that the baseline
explains is fine and exits 0; drift it does not explain is a regression and exits 1.

## 7. The part that should worry you

```
$ adhd diff evals/recorded/001-first-run evals/recorded/001-seed2
```

```
same problem_hash: these runs are comparable.

shared frames: 5

status changed between the runs:
  ACTOR_CENSUS      survivor -> pruned
  FRAME_BREAKER     survivor -> pruned
  Same frames, different seed, so this change is the seed's doing.

pass A moved (>= 0.01):
  LEDGER            0.69 -> 0.79  +0.10
  ACTOR_CENSUS      0.81 -> 0.90  +0.08
  MINIMALIST        0.71 -> 0.63  -0.08
  DOOR_KEEPER       0.75 -> 0.81  +0.06
  FRAME_BREAKER     0.79 -> 0.85  +0.06
  Largest move 0.10 on an unchanged artifact-producing frame. Until the
  run-to-run noise floor is measured, a move this size cannot be called signal.

The recommendations differ at different seeds with the same frames. That is a seed effect.
```

Same problem, same frames, different seed, different recommendation. Both survivors from the run
walked through above are pruned in the other one.

This is the strongest evidence in the repository and it is evidence against. Eleven recorded runs
is not a sample, the noise floor has never been measured, and backlog items 3 and 4 exist to
measure it. Until they are done, everything above demonstrates that the machinery works — the
hash holds, the branches are isolated, the blind pass is blind, the pruned block ships — and
demonstrates nothing about whether the frame library picks better answers than one careful pass.

`docs/FAILURES.md` has the rest of them.
