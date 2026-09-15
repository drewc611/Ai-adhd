# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Set per-phase static ceilings under the ingress idle limit first and today since that removes the only unbounded failure; then wire the caller's disconnect signal - which the runtime already provides at the entry point - through to the outbound call so an abandoned request stops holding its pool slot; and propagate an explicit deadline header only across hops you own or have confirmed will cancel on it, with entry points that have no waiter, such as cron and batch, correctly answered by a constant.**

**Decision this forces:** Stop treating the timeout as a constant on the client and instead stamp a deadline where the request enters, carry the remaining budget to every outbound call, and compute each attempt's timeout by subtraction, keeping static values only as ceilings or unclaimed-case defaults.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Derive every timeout on this client from a deadline that arrives with the request and is decremented as it travels, and keep static per-call timeouts only as a hard ceiling.

**Falsifier:** The ceiling stage needs no evidence and should not wait for any. For the cancellation stage, count over one day of access logs the fraction of requests that ended with the client already gone and the peak share of connection pool slots held by such requests; under roughly 1% abandoned with the pool never approaching saturation, the wiring is not worth doing. For the propagation stage, test one upstream directly - cut the connection mid-request and check whether their handler stops - and if it does not, the header is unfunded regardless of what the abandonment numbers say.

Held by: FRAME_BREAKER, ACTOR_CENSUS, LEDGER. Under the strongest objection it **defended**: The objection is right about ordering and right about the header, and wrong that those two concessions take the position with them.

**Close call.** ACTOR_CENSUS and FRAME_BREAKER scored level in pass A. The tie was broken by frame id, alphabetically, not by the rubric. FRAME_BREAKER's position in the corroborating block is as well supported as this one.

## Corroborated findings

- **Stop treating the timeout as a constant on the client and instead stamp a deadline where the request enters, carry the remaining budget to every outbound call, and compute each attempt's timeout by subtraction, keeping static values only as ceilings or unclaimed-case defaults.** (frames: FRAME_BREAKER, ACTOR_CENSUS, LEDGER). Deepen: defend. The objection is right about ordering and right about the header, and wrong that those two concessions take the position with them.

## Live singletons (unverified)

- **MINIMALIST**: Set one total-request deadline of 10 seconds on this client and change nothing else. (defend: The objection lands on the prose and glances off the move.)
- **DOOR_KEEPER**: Set a 2s connect timeout, a 5s per-attempt read timeout, a 10s total deadline, and no retries today, then ship the deadline-propagation and idempotency-key work that lets you raise retries later without a rewrite. (defend: The objection lands one clean hit and three glancing ones.)

## Folded under objection

(none)

## Pruned, with reason

(none pruned)

## Run level

- singleton MINIMALIST escalated to deepen, flagged unverified
- singleton DOOR_KEEPER escalated to deepen, flagged unverified
- propagated_deadline_budget: the rubric did not separate this cluster. ACTOR_CENSUS ships because its id sorts first, not because it scored higher.

## What this forecloses

- Picking a static per-client constant like "connect 2s, read 10s" and treating reliability as settled; under a budget the same client gets a different timeout on every call.
- Fixed retry policies such as "three attempts with backoff" configured independently of the caller's remaining time, since retries must now fit inside the budget or not happen at all.
- Tuning each service's timeouts locally and in isolation; the budget is a cross-team contract that has to be agreed at the edge and honored inward.
- A single global timeout constant on the client shared by every call site: once the budget travels with the request, the health check and the report export cannot use the same number, and the constant becomes unreachable dead configuration.
- An independently configured retry policy: retries must fit inside the deadline that is left, which rules out the usual three-attempts-with-backoff block that quietly multiplies the caller's wait by four.
- Treating the load balancer and upstream server timeouts as somebody else's setting: the client ceiling is now derived from them, so changing either without changing this is a breaking change.
- One global timeout constant applied to every dependency and retuned whenever it hurts, which ignores that different calls sit behind different deadlines.
- Exponential backoff with independent retries at every layer, which is the common default and which bills the dependency during its own incident.
- Setting the read timeout from the dependency's p99 latency alone, with no reference to who upstream is still waiting.
- Leaving the library default or an infinite timeout in place on the theory that slow is always preferable to failed.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 270696 | 2162s from compile, host-bound |

problem_hash: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`
seed: 3
