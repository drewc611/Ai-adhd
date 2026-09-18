# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Set the aggressive config default today as a ceiling rather than as the answer — 2s connect, 5s per-attempt read, 10s total, no retries, verified to sit inside the proxy and mesh cutoffs — ship caller-side cancellation and orphaned-work metrics in the same change, and schedule deadline propagation as the next change with an owner rather than gating it on the dependency's histogram.**

**Decision this forces:** Put a small hard timeout in config today with no retries and no deadline plumbing, and let a named observation decide whether anything more gets built.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Set an aggressive default now — 2s connect, 5s per-attempt read, 10s total deadline, no retries yet — ship it behind a config value you can change without a deploy, and spend the first week reading the resulting latency histogram before you commit to any retry or budget-propagation scheme.

**Falsifier:** Caller-side, within days rather than a week: any non-trivial count of outbound calls still running after the inbound caller has disconnected or cancelled, or any handler making more than one sequential downstream call, means propagation belonged in this change and constant-first sequencing was wrong. Cheaper and equally falsifying: a proxy, load balancer or mesh cutoff below the 10s total deadline, or a connect timeout that does not cover DNS and TLS, either of which means the configured number was never the number in effect. The dependency-histogram falsifier is retained only for choosing the value, and is explicitly not evidence about the shape.

Held by: MINIMALIST, DOOR_KEEPER. Under the strongest objection it **defended**: The objection is right about the end state and wrong about the ordering, and it names one real error in the position that costs something to fix.

## Corroborated findings

- **Put a small hard timeout in config today with no retries and no deadline plumbing, and let a named observation decide whether anything more gets built.** (frames: MINIMALIST, DOOR_KEEPER). Deepen: defend. The objection is right about the end state and wrong about the ordering, and it names one real error in the position that costs something to fix.
- **Stop choosing constants and plumb an inherited absolute deadline through the call path, deriving each attempt's timeout from the remaining budget and bounding retries by what is left.** (frames: LEDGER (pruned after corroborating: FRAME_BREAKER, ACTOR_CENSUS)). Deepen: defend. The objection is right about sequencing and wrong about what the position depends on.

## Live singletons (unverified)

(none)

## Folded under objection

(none)

## Pruned, with reason

- **ACTOR_CENSUS**: Stop choosing timeout constants and make the client take an inherited absolute deadline: read the remaining budget from the inbound request, pass the remainder minus elapsed time to every downstream hop, and wire caller disconnect to a real socket abort.
  - traps: T7
  - detector output: T7: The speed-and-cost column belongs to other actors' moves, not to its own; inheriting a deadline, storing absolute instants at every hop, binding disconnect to a real socket abort and discovering the proxy's limit are presented without any cost of being wrong, detection latency, or statement of what it takes to back out, and dynamic config versus a literal is raised only as a fact about the operator.
- **FRAME_BREAKER**: Stop choosing timeout constants and instead stamp every inbound request with a deadline at the edge, propagate the remaining budget through every outbound call, and let each HTTP attempt's timeout be whatever is left of that budget.
  - traps: T7
  - detector output: T7: The only cheapness it prices is the move it rejects — a constant as a one-line diff that passes review — while its own program of ingress middleware, a wrapped client, a propagated header, idempotency keys and a new metric arrives as one undifferentiated "tomorrow" with no cost of being wrong, no detection latency and no unwind path.

## Run level

- clean: no monoculture, no scatter, no run level trap

## What this forecloses

- A per-endpoint or per-operation timeout table, including separate connect, read, and write budgets; one total number replaces all of it until a specific endpoint proves it needs its own.
- Retry with backoff, jitter, and a circuit breaker on top of the client. The first timeout failure stays a visible error, deliberately, because a visible error is information and a silent retry is not.
- Deadline or cancellation propagation from the inbound request through this client, which would make the timeout a computed remaining budget rather than a constant.
- Any retry policy shipping in this change — no retries at all go in until the idempotency question is answered in writing, which rules out the common "3 retries with exponential backoff" default that most HTTP client wrappers arrive with.
- Deriving the timeout from the dependency's published SLA or from a number copied out of another service's config, since the position commits to the dependency's own measured histogram as the only input that decides the value.
- A generous starting value chosen to avoid false failures — 30s or 60s, or the library default — which is the move that keeps the decision comfortable and pushes detection of being wrong out past the first traffic peak.
- Refactoring now to caller-supplied deadlines and context propagation, which stays shut until the histogram or a discovered sequential fan-out justifies it.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 485412 | 1930s from compile |

problem_hash: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`
seed: 3
