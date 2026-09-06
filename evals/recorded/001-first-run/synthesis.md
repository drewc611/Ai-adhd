# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Set the client's fixed floors now (connect 1-2s, per-read idle 5s, total cap 30s, chosen to sit under the load balancer and liveness-probe cutoffs and exposed as runtime config for the operator), and have the client honor an optional caller deadline or cancellation, threaded from the runtime's existing request context where one exists, that can shorten but never lengthen those floors, instead of requiring a new deadline parameter at every call site.**

**Decision this forces:** Change the client's call interface so every request carries a deadline supplied by the caller from its own remaining budget, keep only short fixed floors (connect, idle, hard cap) on the client as backstops, and remove the ability to call without a deadline.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Make every request carry a deadline handed in by the caller and propagated from whoever is waiting on it, and give the client itself only short fixed floors (connect 1-2s, per-read idle 5s, hard total cap 30s) that the caller's deadline can shorten but never lengthen.

**Falsifier:** Query the load balancer access logs and framework metrics that already exist for client-side aborts (499s, connection reset by client, cancelled request contexts) over a representative week; if they are negligible or the client is only invoked from unattended jobs with no upstream deadline, skip the cancellation plumbing and ship the fixed floors alone.

Held by: ACTOR_CENSUS, FRAME_BREAKER. Under the strongest objection it **defend**: The objection is right about one thing and it costs the position its mandatory clause: "impossible to call the client without a deadline" is a signature migration, and callers who do not know their budget will invent constants, which is ...

## Corroborated findings

- **Change the client's call interface so every request carries a deadline supplied by the caller from its own remaining budget, keep only short fixed floors (connect, idle, hard cap) on the client as backstops, and remove the ability to call without a deadline.** (frames: ACTOR_CENSUS, FRAME_BREAKER). Deepen: defend. The objection is right about one thing and it costs the position its mandatory clause: "impossible to call the client without a deadline" is a signature migration, and callers who do not know their budget will invent constants, which is ...

## Live singletons (unverified)

- **DOOR_KEEPER**: Set connect timeout to 2s, per-request total deadline to 10s, and no infinite anything, then ship it behind a config value and tighten from observed p99 after one week of traffic. (defend: The first point does not overturn the position, but it exposes a missing sentence.)

## Pruned, with reason

- **LEDGER**: Set a short connect timeout (about 1 to 2 seconds), a per-request total deadline sized to the slowest legitimate response you have actually measured plus a small margin (typically 2 to 5 seconds for an API call), and cap retries at one with jitter, so the bill for a slow dependency is paid by the caller failing fast rather than by the downstream service and its on-call engineer absorbing a pile-up.
  - traps: T2, T7
  - detector output: T2: The load bearing assumption is that the timeout is a property of the client set once by the developer; LEDGER accepts it wholesale and only argues about which static number and who pays for it. | T7: Every recommendation is presented at equal weight with no statement of what it costs to be wrong about connect vs total vs retry or how long until you learn; 'one afternoon of measurement' is a cost estimate, not a reversibility distinction.
- **MINIMALIST**: Set a single overall request deadline of 10 seconds on the client and change nothing else.
  - traps: T1, T2, T6
  - detector output: T1: The branch itself states connect vs read distinction 'buys nothing' and gives a single wall-clock deadline; delete 'HTTP' and 'this client' and the answer 'one 10s total deadline' is unchanged for any blocking call. | T2: It accepts that the timeout lives on the client and is picked once by the developer, and explicitly labels per-call and per-route considerations 'imagined pain' rather than testing them. | T6: Only the asker and the upstream owner are named; the caller who inherits 10s, the end user waiting on it, the operator who needs a knob during an incident, the scheduler, and the attacker are all absent, and the caller in particular decides whether 10s is generous or fatal.

## Run level

- singleton DOOR_KEEPER escalated to deepen, flagged unverified

## What this forecloses

- A single global timeout constant (or the library's default, which is often infinite) compiled into the client and shared by every call site regardless of who is waiting.
- Tuning the timeout purely to the upstream's observed p99 latency, which treats the upstream as the only actor and ignores that the person waiting may have already left.
- Letting the load balancer, liveness probe, or thread-pool exhaustion be the mechanism that eventually ends a stuck request.
- A single global timeout number in the client's configuration that all callers inherit.
- Choosing timeouts by looking at the upstream server's p99 latency rather than the caller's budget.
- Retry policies that add their own time on top of the request instead of consuming the caller's remaining deadline.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 407407 | ~75 min wall clock including two classifier-blocked respawns; subagent tokens: branches 225290, critic 130617 (pass A 55969 + pass B 74648), deepen 95500 |

problem_hash: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`
seed: 1
