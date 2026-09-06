# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Do not commit to a year-long microservices rewrite; name the specific pain and its metric first, run the cheapest reversible probe that can actually move that metric (module extraction behind a strangler seam if the pain is coupling or deploy cadence, a database-level probe if the pain is the shared data store) within one quarter, book platform setup as a separate fixed investment rather than charging it to the first seam, and take each one way door only after its preceding probe shows the named metric moved on real traffic.**

**Decision this forces:** Refuse the year-long rewrite, extract a single service behind the existing interface within a quarter without splitting the database, and permit further extractions only if that one measurably relieves a named pain.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Do not commit to a year-long microservices rewrite; instead extract exactly one service behind a strangler seam within the next quarter, and commit to further extractions only if that seam pays its own way in the seam's operational metrics.

**Falsifier:** If the named pain is one that no reversible probe can inform within a quarter, either because module boundaries cannot be isolated in under two weeks in any direction or because the pain is a whole-system property (shared database write ceiling, framework end of life) whose relief demands the database split or the rewrite itself as the first move, then incremental extraction is not viable and the choice is genuinely binary between staying monolithic and a full rewrite, which this position assumed away.

Held by: LEDGER, DOOR_KEEPER (pruned after corroborating: PRIOR_ART). Under the strongest objection it **defended**: The strongest objection: the experiment is rigged to say "stay." Two mechanisms.

## Corroborated findings

- **Refuse the year-long rewrite, extract a single service behind the existing interface within a quarter without splitting the database, and permit further extractions only if that one measurably relieves a named pain.** (frames: LEDGER, DOOR_KEEPER (pruned after corroborating: PRIOR_ART)). Deepen: defend. The strongest objection: the experiment is rigged to say "stay." Two mechanisms.

## Live singletons (unverified)

- **HORIZON**: Do not rewrite the monolith as microservices over the next year; instead extract at most two services this year, chosen by the seams whose ownership or deployment cadence has already diverged, and keep the rest a single deployable with enforced module boundaries. (defend: The objection is right on three points and wrong on the one that would overturn the position.)

## Pruned, with reason

- **PRIOR_ART**: Do not rewrite the monolith over the next year; instead cut over one capability at a time behind the existing interface, exchange-by-exchange as the telephone network did, and only for the parts whose operating cost is already measurable.
  - traps: T1, T2
  - detector output: T1: Step 1 explicitly abstracts the prompt to 'replace a load-bearing system that cannot be paused'; with monolith, microservices, and the year deleted the position (cut over one segment at a time behind a stable interface) is unchanged, and would be the same answer for any replacement question. | T2: Accepts the question's frame that a replacement is happening and asks only how; step 4 notes the precedents say nothing for microservices as a topology but does not test whether the pain is architectural at all.
- **FRAME_BREAKER**: Stop planning any rewrite; instead spend the next two weeks writing down the three specific pains the monolith causes, with a number attached to each, and fix the single most expensive one inside the monolith by the end of the quarter.
  - traps: T1
  - detector output: T1: Delete monolith, microservices, and the year from the prompt and the answer, write down three pains with numbers and fix the most expensive one in place, is unchanged; the reasoning about who benefits from an unexamined rewrite applies to any rewrite proposal.

## Run level

- singleton HORIZON escalated to deepen, flagged unverified

## What this forecloses

- A full rewrite scheduled as a one-year program with a target end state of "microservices."
- Leaving the monolith exactly as it is with no boundary work at all, which lets the unnamed pain keep compounding unmeasured.
- Extracting more than one module before the first extraction has shown a measured improvement in the pain it was meant to fix.
- A big-bang rewrite with a parallel codebase and a planned cutover date.
- Reorganizing the engineering team around service ownership before any service has proven itself on production traffic.
- Splitting the database as the first step of the migration.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 460541 | 707s from confirm |

problem_hash: `sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b`
seed: 3
