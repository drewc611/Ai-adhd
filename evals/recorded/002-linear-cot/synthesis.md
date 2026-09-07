## Recommendation

Periodic p99 latency spikes are almost always caused by something running on a schedule.
The most common causes are:

- Garbage collection pauses, especially full collections on a large heap.
- Cron jobs or scheduled batch work competing for CPU and IO.
- Cache entries expiring together and causing a thundering herd on the backing store.
- Connection pool recycling or DNS TTL expiry forcing reconnection.
- Log rotation or metric flushes doing synchronous disk work.
- Certificate or auth token refresh against a slow identity provider.
- Autoscaling events adding cold instances to the pool.

Pull up your dashboards for each of these and see which one lines up with the spike interval.
Most APM tools will let you slice latency by endpoint and by instance, which usually narrows
it down quickly. If nothing lines up, consider adding distributed tracing so you can see where
the time is actually going during a spike window.

**Decision this forces:** none recorded

**Falsifier:** none recorded

## Corroborated findings

- **the usual suspects list** (frames: linear)

## Live singletons (unverified)

(none)

## Pruned, with reason

(none)

## Run level

(none)

## What this forecloses

(none)

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 1 | 0 | 0s |

problem_hash: `sha256:pending`
