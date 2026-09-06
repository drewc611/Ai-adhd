# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Split p99 by instance first: if one instance spikes per event, read that runtime's pause log and heap sawtooth and stop; if every instance spikes in the same bucket and stays synchronised after a rolling restart, the cause is a shared external clock, so stop inspecting the API and match a coarse forty minute period against every scheduled actor on the shared hosts, database, and network (cron, snapshots, token and cert refresh, autoscaler, your largest client's batch job), then pause the match for two cycles to confirm.**

**Decision this forces:** Export the spike timestamps (from the p99 series or, more strictly, from one host's raw request log), compute the true inter-spike interval and its jitter, and let that fingerprint decide whether to grep for an internal timer, a neighbour's cron, an external scheduled actor, or a fill-and-flush accumulator, before profiling, scaling, or tuning anything.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Stop inspecting the API and instead pull the exact timestamps of every p99 spike from the last 48 hours, compute the true period and its jitter, and match that number against every scheduled actor that shares the API's hosts, database, or network (cron, backup snapshots, autoscaler, cert and token refresh, log rotation, and your biggest client's batch job), then pause the matching one for two cycles to confirm.

**Falsifier:** If the per-instance split shows one instance per event, or all instances together but desynchronising after a rolling restart, or the period tracks request rate, the cause is in-process and the external-actor branch is wrong; likewise if the spikes reproduce in a staging copy with all scheduled jobs disabled and no external clients.

Held by: PARTICULARIST, FRAME_BREAKER, SABOTEUR. Under the strongest objection it **defend**: The objection wins two points outright and I take them.

## Corroborated findings

- **Export the spike timestamps (from the p99 series or, more strictly, from one host's raw request log), compute the true inter-spike interval and its jitter, and let that fingerprint decide whether to grep for an internal timer, a neighbour's cron, an external scheduled actor, or a fill-and-flush accumulator, before profiling, scaling, or tuning anything.** (frames: PARTICULARIST, FRAME_BREAKER, SABOTEUR). Deepen: defend. The objection wins two points outright and I take them.

## Live singletons (unverified)

- **MECHANIC**: Pull the per-instance memory-occupancy curve and the runtime's stop-the-world pause log for the last several hours and line the pause timestamps up against the p99 spikes, because a period that is "about" 40 minutes is a bucket filling at request rate and emptying in one blocking step, not a clock. (fold: The objection is right on the point that carries the whole derivation.)

## Pruned, with reason

- **END_USER**: Look at what the slowest 1% of users experience during a spike — whether their request eventually succeeds, how long they sit with nothing happening, and whether they retry — and make the system answer them within a few seconds either way (result, honest wait signal, or clean failure) before you touch a single cause.
  - traps: T1, T7, T8
  - detector output: T1: Delete '40 minutes', 'p99', and 'API' and the reasoning is unchanged; the branch says so itself ('I did not know a 40 minute cycle existed', 'my position is not which subsystem') and the same text would answer any slow-request question. | T7: The ordering (experience first, cause later) is justified by harm, and nowhere does the branch distinguish cheap reversible moves from expensive committed ones; a client-side timeout change and a server-side priority queue are treated as the same kind of bet. | T8: Stripped of the user's-seat voice the position is 'check whether users are harmed and make requests fail fast before chasing the cause', which is general advice that does not answer where to look; the appeal was in the angle.

## Run level

- singleton MECHANIC escalated to deepen, flagged unverified

## What this forecloses

- Profiling the request handler or taking flame graphs under load; the spike is periodic, not load-shaped, so the hot path is not where the stall lives.
- Adding capacity or autoscaling; more instances in the same phase produce the same blip.
- Tuning GC flags before the gap histogram rules a timer in or out.
- Starting with a profiler, flame graph, or distributed trace of the request path, since those only show where time is spent inside the API, which is the place the assumption says to look.
- Adding capacity, autoscaling faster, or tuning GC settings, because a periodic external actor will still land on the same resource regardless of how much of it you have.
- Starting with crontab, GC tuning, or heap sizing before the period is confirmed from raw per-host data.
- Adding capacity or autoscaling as a first move, since it hides a scheduled cause without finding it.
- Widening the p99 aggregation window until the spike disappears from the chart.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 459551 | 767s from confirm |

problem_hash: `sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806`
seed: 2
