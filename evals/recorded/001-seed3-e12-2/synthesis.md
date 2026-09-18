# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

No recommendation. Every branch was pruned. The pruned block is the result.

## Corroborated findings

(none: no two frames landed on the same action)

## Live singletons (unverified)

(none)

## Folded under objection

(none)

## Pruned, with reason

- **ACTOR_CENSUS**: Set explicit, short timeouts on every phase of the request (DNS/connect, TLS handshake, per-read/write, and total deadline), each sized to bound how long a stalled or adversarial peer can hold a socket, thread, or pool slot, not to the expected happy-path latency.
  - traps: T1, T2, T7
  - detector output: T1: The per-phase, adversarial-peer framing is a generic security-hardening template the branch would produce for any bare timeout question, since the prompt names no protocol, traffic pattern, or trust boundary for it to depend on. | T2: The branch tests whether the upstream should be trusted by default, not whether a single client-level number is the right unit of decision at all; it still ends up setting several client-level values, just more of them. | T7: The branch compares actors by how fast and cheap their actions are, but never frames the timeout choice itself in terms of cost-of-being-wrong versus time-to-detect for a reversible-versus-committed bet.
- **DOOR_KEEPER**: Spend an afternoon measuring the real latency distribution of the downstream dependency, then commit to a client architecture with deadline/cancellation propagation built in from day one, while keeping the numeric timeout values and retry policy as runtime-adjustable config rather than hardcoded constants.
  - traps: T1, T2, T6
  - detector output: T1: The one-way/two-way-door framework is a generic decision-analysis template that would be produced for this question regardless of any detail the prompt supplied, since none were supplied. | T2: The branch never names or tests the assumption that a client-level timeout number is the right unit of decision; it arrives at deadline propagation through a reversibility argument, not by attacking that framing directly. | T6: A downstream service owner is named, but an attacker, a scheduler, on-call, and whoever pays for infrastructure never appear in the reasoning.
- **LEDGER**: Set explicit connect and read timeouts derived from the dependency's measured p99 latency (never leave them unset or at a framework's default/infinite value), and cap retries so the timeout choice cannot be silently multiplied.
  - traps: T1, T2, T6, T7
  - detector output: T1: Deleting the prompt's near-absent details leaves the p99-anchoring-and-retry-cap advice untouched, since nothing in the branch's argument depends on anything the prompt actually said. | T2: The branch still treats 'set connect and read numbers on the client' as the right unit of decision and never questions whether the timeout should instead vary per call or per caller. | T6: Users, on-call, and a downstream-owning team are engaged, but an attacker, a scheduler, and whoever owns the infrastructure budget never appear anywhere in the reasoning. | T7: The branch names an 'ongoing cost' of retuning but never contrasts a cheap, reversible bet against an expensive, committed one, or states how long a wrong choice would take to surface.
- **FRAME_BREAKER**: Stop looking for a single timeout value to set on the client object; instead define a per-operation deadline budget and retry/idempotency policy for each distinct call this client makes, driven by the caller's own request deadline.
  - traps: T1, T6, T7
  - detector output: T1: The per-operation-budget argument is a generic architectural stance the branch would produce for literally any bare timeout question, since the prompt gives it no operation list, idempotency facts, or deadline figures to work from. | T6: Only a downstream service owner is named as missing; an attacker, a scheduler, and whoever pays for infrastructure never enter the reasoning at all. | T7: The branch never distinguishes a cheap, reversible bet from an expensive, committed one, or discusses how long a wrong per-operation policy would take to surface.
- **MINIMALIST**: Set one overall request timeout (a single hard cap on total time from request start to response) and stop there.
  - traps: T1, T2, T6, T7
  - detector output: T1: The prompt supplies no case-specific detail beyond 'this HTTP client', so deleting any of its sparse details leaves the single-timeout-first advice completely unchanged. | T2: The branch never questions whether timeout configuration belongs at the client level at all; it accepts that framing and only asks how many client-level numbers to set. | T6: Only an on-call/observability owner is named; the caller's own deadline budget, the upstream service, an attacker, a scheduler, and whoever pays for infrastructure never enter the reasoning. | T7: The branch sequences 'fix now, expand later' but never frames the choice in terms of cost-of-being-wrong or time-to-detect, so cheap and expensive moves are never explicitly distinguished.

## Run level

- every branch was pruned. Nothing to deepen.

## What this forecloses

(nothing recorded)

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 120402 | 667s from compile |

problem_hash: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`
seed: 3
