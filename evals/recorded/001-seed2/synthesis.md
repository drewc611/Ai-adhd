# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Derive the request's total budget today from the tolerance the product already promises, propagate it as a decrementing deadline so each call gets min(remaining, its own ceiling) and composed calls cannot overspend it, ship bounded hot-reloadable per-call ceilings now as backstops, use the week's histogram only as the feasibility check on whether the dependency fits inside that budget at all, and keep retry-on-timeout off until idempotency keys exist.**

**Decision this forces:** Put conservative connect, read and total values into hot-reloadable config today, add a latency histogram and per-timeout counters for a week, then tighten from the measured tail, and leave retry-on-timeout off until idempotency keys exist.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Ship conservative hot-reloadable timeouts today (separate connect, read, and total budgets, total set below the caller's own deadline), instrument the latency histogram for a week, and keep retry-on-timeout switched off until idempotency keys exist on every non-idempotent call.

**Falsifier:** Nobody can name or derive the caller's tolerance today. No SLO, no product promise, no upstream cut-off, and the answer to 'how long is the answer still worth having' is a shrug. Then the top-down derivation has no anchor, the objection's cheaper input does not exist, and measuring the dependency is genuinely all you have. Second: the client or transport cannot carry a deadline, so composition is unfixable and the per-call ceiling is the only control, which is the case the position now claims to have solved and would not have. Third, retained as the feasibility check: a fat multi-modal tail where p99.9 is several times p99 with no stable ceiling, or a canary at the tightened value that raises your error rate while the dependency reports flat success, meaning the numbers were taste rather than data.

Held by: DOOR_KEEPER. Under the strongest objection it **defended**: The objection is right about the input and wrong about what that costs the position.

## Corroborated findings

(none: no two frames landed on the same action)

## Live singletons (unverified)

- **DOOR_KEEPER**: Ship conservative hot-reloadable timeouts today (separate connect, read, and total budgets, total set below the caller's own deadline), instrument the latency histogram for a week, and keep retry-on-timeout switched off until idempotency keys exist on every non-idempotent call. (defend: The objection is right about the input and wrong about what that costs the position.)

## Folded under objection

(none)

## Pruned, with reason

- **ACTOR_CENSUS**: Derive every timeout from a deadline the caller hands you — read the inbound deadline, subtract time already spent, spend what is left as this attempt's budget — and hardcode only the ceilings (connect, TLS handshake, response-header, idle) that must stay below the nearest proxy's idle timeout.
  - traps: T7
  - detector output: T7: Moves are ranked by speed and cost of the actor who makes them, but no recommendation is examined for cost of being wrong or detection latency, and nothing separates a reversible change from a committed one.
- **MINIMALIST**: Set one total request timeout on the client, pick a number a few times your worst observed response, and stop there.
  - traps: T6
  - detector output: T6: Only the asker and the downstream owner appear; the caller upstream is never named, and that omission is load bearing because the advice to pick something plainly generous when data is missing is exactly the choice a caller's own deadline would overturn, since a total longer than the waiting party will wait converts a slow dependency into thread and connection exhaustion.
- **FRAME_BREAKER**: Stop choosing timeout values on the client and instead thread an explicit end-to-end deadline from the request entry point through every outbound call, deriving each call's timeout from the remaining budget and defining the degraded response you return when that budget is spent.
  - traps: T7
  - detector output: T7: No recommendation is examined for cost of being wrong or detection latency, and threading a deadline through a call path is treated as equivalent in commitment to editing a constant, when it is the more expensive and less reversible of the two.
- **LEDGER**: Set one end-to-end deadline for the whole call, sized from the user-facing latency budget (roughly 1s to connect, the rest of the remaining budget for the total attempt), propagate that deadline to every downstream hop, and cap retries with a retry budget of a few percent of traffic.
  - traps: T7
  - detector output: T7: Every recommendation is priced in currency and payer, but nothing asks what it costs to be wrong or how long until you find out, and no move is sorted into cheap-and-undoable versus committed, so the whole position ships at one level of commitment.

## Run level

- singleton DOOR_KEEPER escalated to deepen, flagged unverified

## What this forecloses

- Leaving any timeout unset or infinite while waiting for data, which is the option that feels cautious and is actually the irreversible one.
- Turning on retry-on-timeout now for write endpoints, including the common shortcut of a client-library default retry policy, before idempotency keys exist.
- Baking hand-picked round numbers into compiled code or a shared client library so that changing them requires a release rather than a config push.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 445330 | 555s from confirm |

problem_hash: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`
seed: 2
