# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Pull the slow requests behind the last 24 hours of p99 spikes, grouped by instance and caller, and read the period's shape before opening any subsystem log; a period that shrinks as traffic rises and lands on instances at different moments points inside the process at something emptied when full (old-generation heap, segment rotation, compaction), a period that stretches with traffic points at a sleep-after-completion loop, and a period pinned at 40:00 that hits every instance in the same second points at an external timer, batch, maintenance cadence, or 60-minute credential refreshed at two thirds, with the caller breakdown naming the owner when it is not this service.**

**Decision this forces:** Pull exact spike timestamps, check whether the interval drifts with request volume, and overlay the spikes on the heap, WAL/checkpoint, memtable, and connection-age curves to see which fill-and-drain metric resets at the spike.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Pull the exact timestamps of the last 24 hours of spikes and check whether the gap between them shrinks when request volume rises; if it drifts with traffic, look at whatever in the process is sized in bytes and emptied when full (old-generation heap, WAL or segment rotation, compaction), and if it holds at 40:00 regardless of load, look for a credential or token with a 60-minute lifetime that the client library refreshes at the two-thirds mark.

**Falsifier:** The slow requests at the spike timestamps do not exist in raw traces, or the drift direction and per-instance alignment point at the wrong class of mechanism once the cause is found, such as a load-compressing instance-staggered period that turns out to be a neighbouring team's batch, or a pinned instance-synchronized period that turns out to be heap.

Held by: PARTICULARIST, MECHANIC. Under the strongest objection it **defend**: The objection is right on two counts and I give them up.

## Corroborated findings

- **Pull exact spike timestamps, check whether the interval drifts with request volume, and overlay the spikes on the heap, WAL/checkpoint, memtable, and connection-age curves to see which fill-and-drain metric resets at the spike.** (frames: PARTICULARIST, MECHANIC). Deepen: defend. The objection is right on two counts and I give them up.
- **Correlate spike timestamps against every scheduled or periodic process around the API, then pause or shift those processes one at a time and watch whether the next spike disappears or moves.** (frames: NIGHT_OPERATOR, FRAME_BREAKER). Deepen: defend. The objection is right about the procedure and wrong about the principle, and the procedure is the part that should give.

## Live singletons (unverified)

(none)

## Pruned, with reason

- **SABOTEUR**: Pull the raw timestamps of the last ten spikes and partition the slow requests by caller, endpoint, instance, and downstream span before touching any tuning knob; the one dimension that concentrates them is where you look.
  - traps: T1
  - detector output: T1: Delete '40 minutes', 'or so', and 'p99' and the position (pull timestamps of recent spikes, partition slow requests by caller, endpoint, instance, span) is the standard tail-latency attribution method, unchanged; only the caller-batch sub-hypothesis touches the period.
- **NIGHT_OPERATOR**: Overlay the spike timestamps on a timeline of every periodic process the API touches (cron jobs, cache TTL expiry, GC or compaction, connection-pool max-lifetime, token or cert refresh, autovacuum, log rotation) and put a runtime kill-switch or knob on each so the on-call can pause the matching one and watch the next cycle pass clean.
  - traps: T2
  - detector output: T2: Accepts that regularity means a clock and that the fix is finding which scheduled job lines up; the only assumption questioned is whether the fault is inside the API process, which is a foreclosure, not a test.

## Run level

- clean: no monoculture, no scatter, no run level trap

## What this forecloses

- Treating a scheduled job (cron, systemd timer, scheduler tick at a fixed minute) as the first suspect.
- Adding replicas or raising limits before the timestamps have been read, since neither mechanism named here is fixed by capacity.
- Blaming a downstream dependency first; both candidate mechanisms live inside the process or its own storage, and the downstream gets looked at only after the local timestamps fail to correlate.
- Scaling out or adding replicas as the first move; per-instance fill-and-flush is unchanged by fleet size.
- Investigating scheduled jobs, cron, or timer-driven tasks first; a wall-clock trigger does not produce a period of "about forty minutes".
- Tuning client timeouts or retry policy; those shape how the stall is felt, not whether it happens.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 454520 | ~45 min wall clock; subagent tokens: branches 229543, critic 130504 (pass A 56447 + pass B 74057), deepen 94756 |

problem_hash: `sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806`
seed: 1
