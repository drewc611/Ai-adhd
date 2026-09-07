# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Set phase-shaped limits first inside the one client you control today - roughly 1s connect, pool checkout charged against the total, a body-idle cap, and a hard total ceiling on a monotonic clock, with that ceiling set strictly below the tightest limit actually enforced by the load balancer, ingress or sidecar on the path, and retries gated on remaining budget plus a retry budget of about 10 percent of traffic - then, as a second increment, carry the deadline in band and have the receiving handler honour it, since only the server-side half reclaims workers, transactions and locks.**

**Decision this forces:** Stamp an absolute deadline on the request where it enters the system, carry the remaining budget into every outbound call, and derive each call's timeout and each retry decision by subtracting elapsed time from what is left.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Propagate a deadline from the caller and derive every timeout from what remains of it — roughly 1s connect, pool checkout charged against the same budget, a body-idle cap plus a hard total-request ceiling, all measured on a monotonic clock — and gate retries on remaining budget plus a 10 percent retry budget instead of a per-call attempt count.

**Falsifier:** Instrument three things rather than two: requests the caller abandoned as timed out whose server-side handler nevertheless ran to completion, in-flight concurrency against the dependency, and the terminating cause of each failed call attributed to the layer that produced it (client deadline, intermediary idle or request limit, or peer reset). During the next real degradation, with a flat constant timeout in force: if the orphaned-completion counter stays near zero and in-flight concurrency stays flat, retry amplification and orphaned work are not happening here and a single constant is right. Independently, if an intermediary limit is the terminating cause in effectively every failed call, then the intermediary already is the deadline system, the client-side scheme adds nothing over one constant set below that limit, and the correct move is to defer to that layer rather than build a second one.

Held by: SABOTEUR (pruned after corroborating: FRAME_BREAKER, PRIOR_ART). Under the strongest objection it **defended**: The objection lands on three of its four points, and none of the three restores the constant.

## Corroborated findings

- **Stamp an absolute deadline on the request where it enters the system, carry the remaining budget into every outbound call, and derive each call's timeout and each retry decision by subtracting elapsed time from what is left.** (frames: SABOTEUR (pruned after corroborating: FRAME_BREAKER, PRIOR_ART)). Deepen: defend. The objection lands on three of its four points, and none of the three restores the constant.

## Live singletons (unverified)

- **MECHANIC**: Set four separate timers on this client - connect, TLS handshake, wait-for-response-headers, and gap-between-body-bytes - size each one from the thing it physically measures (path round trips for the first two, the far side's work distribution for the third, liveness for the fourth), and carry one absolute deadline inside the request that every hop decrements and refuses to start work against. (defend: The objection makes three moves.)

## Folded under objection

(none)

## Pruned, with reason

- **PRIOR_ART**: Set one deadline for the whole request where it enters the system, pass the remaining budget down into every outbound call, and abandon any call whose remaining budget has fallen below the reserve you need to fail gracefully, instead of assigning each HTTP call its own timeout number.
  - traps: T1, T3
  - detector output: T1: The branch opens by declaring this is not a networking question and states its answer in domain-neutral terms of budget, spend-down and reserve; delete the three specifics and the prescription is word for word the same, with the shared-capacity and fan-out remarks qualifying the position rather than changing it. | T3: Remove ICAO's reserve, EASA's 2022 scheme, United 173, Avianca 052 and the termination-of-resuscitation criteria and the case for a total budget with an untouchable reserve and a standardised declaration is left as assertion, with only the closing disanalogy paragraph reasoning on its own.
- **PARTICULARIST**: Open this client and find out whether it can bound a whole call or only single socket operations, then set one whole-call limit equal to the deadline the code above it is already holding, and if that library has no whole-call knob, wrap the call in an external cancellation instead of tuning its per-socket numbers.
  - traps: T7
  - detector output: T7: It weighs latency costs, a hung request against a slow one and a number larger than the caller's remaining budget, but never once asks what it costs to be wrong about a recommendation or how long until you find out, and no move is characterised as reversible or committed; the nearest trace is the remark that an incomplete connect has produced nothing worth waiting for.
- **FRAME_BREAKER**: Stop configuring per-client timeout numbers and instead stamp every inbound request with a total deadline at your edge, propagate that deadline through each downstream call, and derive every individual timeout by subtracting elapsed time from what is left.
  - traps: T1
  - detector output: T1: Delete this, HTTP and client and the prescription is unchanged, since stamping an absolute deadline at the edge, subtracting elapsed time at each call site and budgeting retries by volume reads identically for a gRPC call, a database call or a queue publish; the only load-bearing use of the deleted words is as the phrase whose localization it objects to, and the objection survives their deletion.

## Run level

- singleton MECHANIC escalated to deepen, flagged unverified

## What this forecloses

- A single tunable timeout constant shared across environments and call sites. Under this position there is no "the timeout" to raise when someone complains, and the config surface that operators are used to editing stops existing.
- Fixed per-call retry counts such as maxRetries=3 with exponential backoff, and retrying at more than one layer of the stack. Retries become conditional on budget, and layers below the deadline owner must stop retrying entirely.
- Relying on the client library's default read or idle timeout as the bound on request duration, which is what most services do today.
- Long-running synchronous requests. Any operation that cannot finish inside an edge deadline must be restructured as an async job with an id to poll, rather than granted a longer timeout.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 519482 | 778s from confirm |

problem_hash: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`
seed: 1
