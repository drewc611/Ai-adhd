# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Ship a bounded max_retries default and a minimal durable exhaustion record (one row or log line per delivery ID, written when retries are exhausted) together in the same change, and build richer subscriber-facing status/alerting in parallel rather than as a blocking prerequisite to the bound.**

**Decision this forces:** Bound retries to a finite number and guarantee that exhausting them always produces a dead-letter record or notification, treating the observability pairing as non-negotiable alongside or before the numeric cap.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Do not ship a bare max_retries integer; first build the dead-letter/exhaustion path (where a permanently-failing delivery's payload goes and who gets told), then bound retries against that path rather than picking a count in isolation.

**Falsifier:** Check whether the PR introducing max_retries also writes a durable, queryable record (not just a counter decrement) at the moment a delivery is abandoned; if it does, the concern this position raises is already satisfied regardless of how far behind the subscriber-facing alerting work lags.

Held by: FRAME_BREAKER (pruned after corroborating: CARETAKER). Under the strongest objection it **defended**: The objection is right that strict sequencing -- full dead-letter storage, per-delivery status, and subscriber alerting built and shipped before any retry bound exists -- is the wrong shape, because it turns a live, already-costly harm i...

## Corroborated findings

- **Bound retries to a finite number and guarantee that exhausting them always produces a dead-letter record or notification, treating the observability pairing as non-negotiable alongside or before the numeric cap.** (frames: FRAME_BREAKER (pruned after corroborating: CARETAKER)). Deepen: defend. The objection is right that strict sequencing -- full dead-letter storage, per-delivery status, and subscriber alerting built and shipped before any retry bound exists -- is the wrong shape, because it turns a live, already-costly harm i...

## Live singletons (unverified)

- **NEGATIVE_SPACE**: Add `max_retries` but default it to unlimited (e.g. 0 or null meaning "no cap"), not to any finite number, so the field's default preserves today's infinite-retry behavior exactly and bounded retries become an explicit opt-in rather than a silent, inherited policy. (defend: The objection is right that an unlimited default leaves the unbounded-queue-growth pain unresolved for every config that never touches the field, since defaults are exactly what inertia carries forward.)

## Folded under objection

(none)

## Pruned, with reason

- **PARTICULARIST**: Decide the name and default by whether the field is customer-visible: if webhook-receiving customers can see or set it, call it `max_retry_duration` and default it to a wall-clock window (e.g. 24h) independent of the backoff curve; if it is an internal-only knob, call it `max_retries` and default it to a count calibrated against the five-minute plateau (roughly 288, one day's worth of five-minute-spaced attempts) so the cap preserves today's de facto tolerance window instead of silently shrinking it.
  - traps: T4
  - detector output: T4: The position defers the actual choice of which name/default applies to the reader's own determination of customer-visibility, so the answer doesn't itself force that decision closed.
- **SUPPLICANT**: Name it max_retries and default it to a small finite number that caps the whole retry window at about a day, so a stuck delivery stops and shows up as "failed" instead of silently retrying forever.
  - traps: T1, T2, T6, T7
  - detector output: T1: The core argument is a generic user-psychology narrative about wanting instant delivery and not thinking about retry policy, which would survive unchanged if the five-minute cap, the indefinite-retry detail, or the webhook-specific framing were deleted. | T2: It never questions whether a finite count field is the right fix at all; it accepts the name/default framing wholesale and only argues about the number. | T6: Every actor discussed is the external webhook receiver; no sending-side operator, on-call, or maintainer is named anywhere, unlike the other branches which all name an internal actor too. | T7: Nothing in the reasoning distinguishes a cheap, easily-revised default choice from an expensive, hard-to-undo one; the 'about a day' figure is simply asserted as the right target.
- **CARETAKER**: Ship `max_retries` with a bounded default (around 10 attempts) that always pairs with a mandatory terminal-failure dead-letter notification, so exhausting retries is observable and never a silent drop.
  - traps: T1, T2
  - detector output: T1: The reasoning leans on an invented 'two years since launch, endpoint variety grew' backstory rather than the prompt's own five-minute-cap or indefinite-retry details, and would read the same for almost any 'add a default to an existing field' scenario. | T2: It names that the default and the missing exhaustion signal were both left unexamined but never actually tests that claim against an observation; it layers a notification requirement on top of the 'ship a max_retries field' frame rather than contesting the frame itself.

## Run level

- singleton NEGATIVE_SPACE escalated to deepen, flagged unverified

## What this forecloses

- Shipping a standalone max_retries field (any name, any default) with no corresponding dead-letter record or subscriber-visible failure signal
- Treating "what number should the default be" as the decision that matters most in this change

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 527800 | 1110s since compile (reported by the synth phase; driven by hand via `adhd run --phase`, so there is no kernel-tracked calendar time and the token figure is the compiler's own estimate, not summed real usage) |

problem_hash: `sha256:234e19164082f82c79247218a6e707b249bdafce7c2450f566edabb5d1b99401`
seed: 15
