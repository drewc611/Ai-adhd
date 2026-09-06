# Critic, pass B (unblind)

Labels are now restored. You have each branch's frame and your own pass A scores. You are
now doing structure, not scoring: cluster, sweep for traps, flag singletons, and name the
strongest objection to each survivor.

## Problem

Echo this hash exactly: `sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806`

```
Our API's p99 latency spikes every 40 minutes or so. Where should I look?
```

## Branches

### PARTICULARIST

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
frame: "PARTICULARIST"
position: "Pull the exact timestamps of the last ten spikes and measure the gaps, because a constant 40:00 that shifts when you restart a process points at a 2400-second timer inside your own service or a client library, an alternating 40/20 gap points at a `*/40` cron on a neighbour, and a scattered 30-to-50 gap points at something filling at traffic rate and flushing, and each of those sends you to a different place."
reasoning: "1. The three most specific details: the period is \"40 minutes or so\" (approximate, not \"exactly 40\"); the metric is p99, not p50 or mean, so roughly one request in a hundred is hit and the rest are fine; and the asker has no candidate yet (\"where should I look\"), meaning nothing has been correlated with anything.\n\n2. The detail that changes the answer is the 40-minute figure and how exact it is. 40 minutes is an awkward number. Cron cannot express it: `*/40 * * * *` fires at :00 and :40, so the gaps alternate 40, 20, 40, 20. A true constant 40:00 therefore is not cron; it is a timer counted from process start (a scheduler with fixed delay, a connection-pool max lifetime, a token refresh, a cache rebuild) or a dependency default that happens to be 2400 seconds. If the \"or so\" hides real drift, then there is no timer at all and the period is set by how fast something fills: a write buffer, a log file rotating by size, a compaction threshold, a queue that drains in a burst. So the single detail whose value flips the answer is the histogram of gaps between spikes. Constant and phase-locked to restart time: grep your service and its client libraries for 2400, 40m, or 40 * 60. Alternating 40/20: find whoever owns a cron on the same hosts or the same database. Scattered: find what accumulates at request rate and empties in one go.\n\nThe p99 detail adds one more split. If all instances were deployed in the same rollout, their per-process timers are phase-aligned and a per-instance stall shows up as one fleet-wide p99 blip. Split the p99 by instance: if every instance spikes at the same moment the cause is shared (database, cache, a node-level agent); if only one instance spikes per event and the culprit rotates, it is inside the process and the fleet just happens to be in phase.\n\n3. The thirty-second answer is \"it's GC, or it's a cron job, check the dashboards for correlated CPU.\" The 40-minute number makes both wrong on its face: a GC cycle that recurs on a 40-minute cadence would need a heap that takes 40 minutes of allocation to fill, which the asker would already know about, and cron cannot produce a constant 40-minute period. The competent answer also assumes the asker has a correlated signal to look at, and the problem says they do not.\n"
forecloses:
  - "Profiling the request handler or taking flame graphs under load; the spike is periodic, not load-shaped, so the hot path is not where the stall lives."
  - "Adding capacity or autoscaling; more instances in the same phase produce the same blip."
  - "Tuning GC flags before the gap histogram rules a timer in or out."
falsifier: "Restart one instance out of phase with the rest of the fleet; if that instance's spikes stay locked to the fleet's schedule instead of shifting by the restart offset, the cause is outside the process and the config grep is the wrong first step."
missing_actor: "The owner of the shared database or platform (DBA or platform team), who can list what runs against the same database or on the same nodes on a roughly 40-minute cadence (autovacuum on a hot table, snapshots, index maintenance, a log shipper or scanner agent) without the API team changing anything."
confidence: "medium"
```

### FRAME_BREAKER

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
frame: "FRAME_BREAKER"
position: "Stop inspecting the API and instead pull the exact timestamps of every p99 spike from the last 48 hours, compute the true period and its jitter, and match that number against every scheduled actor that shares the API's hosts, database, or network (cron, backup snapshots, autoscaler, cert and token refresh, log rotation, and your biggest client's batch job), then pause the matching one for two cycles to confirm."
reasoning: "1. The load bearing assumption is in \"where should I look\": it assumes the cause is a place, something inside the API that you find by inspection (a slow endpoint, a lock, a GC, a bad query). A clean 40 minute period with \"or so\" jitter is not the signature of a place. It is the signature of a clock. Something is running on a timer, and the API is the victim, not the culprit. Nothing in the request path knows what time it is; schedulers do.\n2. The team that owns the API benefits from leaving this unexamined. Looking inside your own code keeps the investigation in territory you control, needs no meeting with the DB team, platform team, or a customer, and lets you file it as \"we are profiling.\" It also flatters the tooling you already bought: APM vendors sell you the ability to look inside the service, not the ability to correlate with someone else's cron.\n3. If the assumption is false, the question is not \"what is slow\" but \"what else happens at 40 minute intervals in this environment, and which of those shares a resource with us.\" That is a correlation problem, not an inspection problem. The \"or so\" is the sharpest clue you have: a fixed cron fires at exact wall clock minutes; a job scheduled relative to its own completion, or a client retry/poll loop, drifts. Measure the drift and you can tell which kind of actor you are hunting before you open a single dashboard.\n4. First concrete action: export the p99 series, mark every spike start, and compute the inter spike intervals. If they are exactly 40:00 it is a wall clock cron somewhere; if they wander between 38 and 44 it is a duration timer or a job chained to its own finish. Take that fingerprint and grep every crontab, k8s CronJob, managed service maintenance window (RDS snapshots, Redis BGSAVE, Elasticsearch merges), autoscaler cooldown, certificate and OAuth token TTL, and your top five clients' integration schedules for the same number. Pause the match for two cycles. If the spikes vanish, you are done and never needed a profiler.\n"
forecloses:
  - "Starting with a profiler, flame graph, or distributed trace of the request path, since those only show where time is spent inside the API, which is the place the assumption says to look."
  - "Adding capacity, autoscaling faster, or tuning GC settings, because a periodic external actor will still land on the same resource regardless of how much of it you have."
falsifier: "If the interval between spikes shortens at peak traffic and lengthens overnight (period correlates with request rate), the cause is load driven and internal, and this position is wrong; likewise if the spikes appear in a staging copy with all scheduled jobs disabled and no external clients."
missing_actor: "The largest API client, whose batch job or polling loop can run on a 40 minute timer and who can share their schedule or shift it by ten minutes to confirm; also the platform or DBA team that owns the backup and snapshot schedule on the shared database."
confidence: "medium"
```

### SABOTEUR

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
frame: "SABOTEUR"
position: "Pull unaggregated per-request logs from one host for three hours, compute the true spike period from raw timestamps, and break each slow request down by upstream dependency before you open a single crontab or touch a single config."
reasoning: "1. The obvious answer is \"something runs every 40 minutes, find the scheduled thing\": grep crontabs, check GC logs, look at cache TTLs, log rotation, token refresh. It assumes four things about the world: the 40 minute period is real and not an artifact of how the chart is drawn; the periodic thing lives inside your service; the clocks producing your metrics and the clocks running your jobs agree; and there is one cause, not two overlapping ones.\n\n2. Three ways production violates that.\n   First, the metric lies. p99 computed over rolling windows, or percentiles averaged across hosts, or a scrape interval that aliases a shorter job into a longer apparent period. Ten replicas each with a 400 minute event, staggered by deploy time, produce a fleet-wide \"every 40 minutes\" that no single host exhibits. The chart says 40; nothing in the system is set to 40.\n   Second, the period belongs to someone else. A caller with a scheduled batch, a client library with a synchronized token refresh, a connection pool maxLifetime on the caller side that recycles every connection at once and produces a reconnect storm at your edge. Or a dependency: DNS TTL expiry, an upstream whose own cache was populated at its last deploy and expires in lockstep. You can grep your own crontabs forever and never find it.\n   Third, the environment lies. Config copied from staging to prod so two schedulers hit the same database; a deploy that populated every cache entry at the same second so they all expire together (a thundering herd that looks periodic because the TTL is periodic); a job pinned to wall time on hosts whose NTP drifted so the spike walks a few seconds each cycle and never lines up with the schedule you are checking against.\n\n3. Cheapest to cause and most expensive to recover from is the first one, the measurement artifact. It costs one dashboard setting or one aggregation choice, and it costs you weeks: you will tune GC, resize pools, and rewrite a hot path chasing a spike that does not exist at the host level, and every \"fix\" will appear to half-work because the chart keeps moving. The second one is nearly as expensive but at least it is real.\n\n4. What survives all three is refusing to reason from the aggregated chart. Take one host, take its raw request log for three hours, list every request over the p99 threshold with its timestamp and its per-upstream timing breakdown. Compute the interval between clusters yourself. If the raw intervals are 40 minutes, the period is real. If the slow requests all wait on the same upstream, the cause is external to your code even if the schedule is yours. If no host shows clusters at all, the chart was lying and you are done. Then, and only then, compare the confirmed period against every lifetime-shaped number you can find, in your service and in the callers and dependencies you can see: pool maxLifetime, token TTL, cache TTL, DNS TTL, cron, GC.\n   What it does not survive: a cause inside a caller or dependency whose telemetry you cannot read. You will see that every slow request waited on service X, or that every spike coincides with a burst from client Y, and you will be able to prove correlation and nothing more. If they will not show you their schedule, you are stuck with a hypothesis and a polite email. It also does not survive tail sampling that drops the slow traces before they are written, which is exactly the trace you need.\n"
forecloses:
  - "Starting with crontab, GC tuning, or heap sizing before the period is confirmed from raw per-host data."
  - "Adding capacity or autoscaling as a first move, since it hides a scheduled cause without finding it."
  - "Widening the p99 aggregation window until the spike disappears from the chart."
falsifier: "A scheduler listing on the service's own hosts shows a job with an exact 40 minute period whose start times match the spike timestamps to the second, meaning the obvious answer was right and the raw log pull was wasted effort."
missing_actor: "The API's callers, who can tell you whether they run a scheduled poll, batch, or token refresh on a 40 minute cycle and can add jitter to it; the problem names only \"our API\" and assumes the cause is inside it."
confidence: "medium"
```

### MECHANIC

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
frame: "MECHANIC"
position: "Pull the per-instance memory-occupancy curve and the runtime's stop-the-world pause log for the last several hours and line the pause timestamps up against the p99 spikes, because a period that is \"about\" 40 minutes is a bucket filling at request rate and emptying in one blocking step, not a clock."
reasoning: "1. Components and what each does while the system waits. A request enters through a load balancer that holds the client socket open and runs a health-check timer against each instance. The instance's kernel holds an accept backlog. Inside the process a worker thread (or task) is parked holding: the request's memory, one connection checked out of a pool to the datastore, and possibly a lock or a cache slot. The datastore holds its own buffers and a write log. Nothing in this chain does useful work during a wait; it only holds. If the process itself stops (a runtime pause, a lock held by a housekeeping task), every worker parks at once, the kernel keeps accepting into the backlog, and the load balancer's timer keeps counting.\n\n2. What is held, consumed, or leaked across the 40-minute interval. Every steady-state service has accumulators that only grow between housekeeping events: memory promoted past the fast young-generation collectors into the region that is collected rarely and with a full stop; entries in a cache aging toward one shared expiry; pooled connections aging toward a maximum lifetime that was set at the same instant for all of them at boot; a write log or memtable on the datastore filling toward its flush threshold. Each of these has a capacity and a fill rate. Interval between events = capacity / net fill rate. The problem says \"40 minutes or so\", not \"every 40 minutes on the dot\". A clock produces an exact period. A capacity-over-rate mechanism produces a period that drifts with traffic. That single word \"or so\" is the first fork in the derivation: the trigger is a threshold, not a schedule.\n\n3. What happens at each boundary when a component stops responding. When the process pauses to drain the accumulator, in-flight requests simply get older; that is the p99 spike, and it is p99 rather than p50 because the pause is short relative to the aggregation window, so only the slice of requests alive during the pause pays. The load balancer keeps sending until its health check fails; if the pause exceeds that, it pulls the instance and the survivors absorb its traffic, which raises their fill rate and shortens their own period, so the spikes on different instances would start to cluster. Upstream clients whose timeouts are shorter than the pause retry, so a single pause becomes a burst of duplicates landing just after the pause ends, which is a second, smaller spike immediately following the first. Pooled datastore connections sit idle through the pause and are all reused in the same instant afterward, so the datastore sees a burst too. Each boundary converts one stall into an echo on the neighbor.\n\n4. Where the conventional answer parts company with the mechanism. The usual reply is \"look for a scheduled job, then look at dashboards for anything that correlates\". That treats 40 minutes as a schedule. The mechanism says a schedule cannot drift, and the reporter says it drifts. So the split happens at the very first step: interpreting the period as a timestamp rather than as a ratio. The second common reply, \"add more instances\", follows from the same misreading: spreading load lowers each instance's fill rate, which lengthens the period but leaves the height of each pause unchanged, so the spike survives and merely becomes rarer. The mechanism says: find the bucket. The cheapest bucket to read is inside the process itself, because it writes its own sawtooth and its own pause log, and because a process-local bucket fills at a different rate on each instance so its pauses will not line up across instances, which is a discriminating test you can run from one graph.\n"
forecloses:
  - "Treating the spike as a scheduled job or cron and searching the job scheduler first."
  - "Adding instances or raising client timeouts as the fix; both change the period or hide the tail without touching the pause."
  - "Starting the investigation at the database or the network before reading the process's own pause log."
falsifier: "The spike interval stays exactly 40 minutes at 3 a.m. and at peak traffic, or every instance spikes at the same second; either one means a clock or a shared upstream, not a per-process bucket."
missing_actor: "The operator of the datastore or cache under the API, who can report that store's own flush, checkpoint, or compaction cadence and whether it lines up with the spikes."
confidence: "medium"
```

### END_USER

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
frame: "END_USER"
position: "Look at what the slowest 1% of users experience during a spike — whether their request eventually succeeds, how long they sit with nothing happening, and whether they retry — and make the system answer them within a few seconds either way (result, honest wait signal, or clean failure) before you touch a single cause."
reasoning: "1. What was I trying to do? Something ordinary. I pressed a button, submitted a form, loaded a page, or my app made a call on my behalf. I did not know a 40 minute cycle existed. From my seat there is no cycle; there is one moment where the thing I always do did not happen, and it looked like it was my fault or my connection's fault.\n\n2. What can I see and do at that moment? I see a spinner, a blank area, or a screen that looks frozen. I can wait, I can press the button again, I can refresh, or I can close the tab. That is the entire menu. I cannot see a latency graph. I cannot tell the difference between \"slow\" and \"broken.\" If a second press works instantly, I learn that pressing twice is the fix, and I will do it forever.\n\n3. What makes me give up, and what happens then? A few seconds of nothing, with no sign the system heard me. When I give up I do one of two things. I leave, and if I was in the middle of paying, ordering, or saving, that work is lost and I may not come back. Or I retry, and now the system is processing my request twice, at exactly the moment it is already struggling. Both outcomes are worse for the system than the original spike was, and it will not see the second one clearly because the retries look like traffic, not like damage.\n\n4. What would I ask for if I knew it was possible? That the slow moment be made honest and short. Tell me you got it. Tell me it is taking longer than usual. Fail fast and let me try again cleanly instead of leaving me hanging. Better still, if some of my requests are being held behind something else, put mine through first and hold the background work back, because I am the one who is watching.\n\nSo my position is not \"which subsystem,\" because I cannot see subsystems. It is: find out what I experience at the top of the spike, and fix that experience first. If the spike is a few seconds of delay that always resolves, I mostly never noticed, and the graph is your problem, not mine. If it is a stall that produces double submissions and abandonments, then a spike every 40 minutes is a leak of users and duplicated work every 40 minutes, and no root cause fix matters until the bleeding stops. I can observe the effect of this: I press once, something happens within a few seconds, every time, and I never learn to press twice.\n"
forecloses:
  - "Starting with a root cause hunt (GC, cron, cache expiry, connection churn) before anyone has measured what the affected users actually do during the spike."
  - "Accepting the spike as tolerable because p99 is \"only\" the slowest 1% and the average is fine."
  - "Silent retry or queueing logic that keeps the user staring at a spinner longer to protect the servers."
falsifier: "Sample the requests that land inside a spike window and check what the callers did next; if nearly all of those requests complete successfully with no duplicate submissions, no refreshes, and no session drop-off in the following minute, the users never noticed and this position is wrong."
missing_actor: "The client team (web or mobile app, or the integration partner calling the API), who can add request idempotency keys, a visible \"still working\" state, and a sane timeout with a clear failure message, so that the spike stops producing duplicate work and abandoned sessions even before the server side changes."
confidence: "medium"
```

## Pass A scores

- END_USER (was A): 0.58
- PARTICULARIST (was B): 0.88
- MECHANIC (was C): 0.81
- FRAME_BREAKER (was D): 0.92
- SABOTEUR (was E): 0.90

## Code lints

These were produced mechanically before you saw the artifacts. They are hints. Confirm or
overrule each with evidence. Disagreement is recorded, not resolved.

(no lint fired)

## Tasks

1. **Cluster.** Two branches are in the same cluster if doing exactly what each says would
   leave the asker having done the same thing. Frames that converge from different axes
   are one finding with corroboration. Name each cluster by its shared action.

2. **Trap sweep.** For every branch and every trap T1 through T8, run the detector as written
   and record `fired` with evidence. All eight records for every branch. Detectors:

   T1 Consensus trap. Detector: delete the three most specific details from the prompt. Would this answer change? If no, T1.
   T2 Frame trap. Detector: name the load bearing assumption in the question. Did any branch attack it? If zero branches attacked it, T2 across the whole run, not just one branch.
   T3 Citation trap. Detector: remove every citation. Does a chain of reasoning remain? If the paragraph collapses, T3.
   T4 Completeness trap. Detector: count the decisions the answer forces the reader to stop making. 
   T5 Symmetry trap. Detector: is there a sentence of the form "do X"? No such sentence, T5.
   T6 Actor omission trap. Detector: enumerate every actor who can change the outcome. Human user, operator, caller, upstream service, attacker, scheduler, finance. Which were named?
   T7 Reversibility blindness. Detector: for each recommendation, what is the cost of being wrong and how long until you find out? If the answer never distinguishes cheap reversible bets from expensive committed ones, T7.
   T8 Novelty trap. Detector: strip the framing. Restate the position in flat language. Is it still worth saying? If the appeal was in the angle rather than the claim, T8.

   Also record the two run level checks: did any branch attack the load bearing assumption
   (if none did, run level T2), and did every branch leave `missing_actor` null (if so, run
   level T6).

3. **Singletons.** Any cluster of size one is flagged `singleton: true`. It is not pruned for
   being alone.

4. **Strongest objection.** For each cluster that has no fired trap, write the single
   strongest objection to it, drawn from another branch's reasoning or from your own reading
   of the problem. One paragraph. This goes to the survivor in isolation, so do not name any
   frame, branch, or letter in it: the survivor must not learn that other branches exist.
   State the objection as an argument, not as "X said".

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806
pass: B
clusters:
  - id: <short_snake_case_name>
    action: <one sentence, what the asker would do>
    members: [<frame_id>, ...]
    singleton: <true|false>
    strongest_objection: <paragraph, or null if a member has a fired trap>
traps:
  <frame_id>:
    T1: { fired: <bool>, evidence: <text> }
    T2: { fired: <bool>, evidence: <text> }
    T3: { fired: <bool>, evidence: <text> }
    T4: { fired: <bool>, evidence: <text> }
    T5: { fired: <bool>, evidence: <text> }
    T6: { fired: <bool>, evidence: <text> }
    T7: { fired: <bool>, evidence: <text> }
    T8: { fired: <bool>, evidence: <text> }
run_level:
  T2_no_branch_attacked_assumption: { fired: <bool>, evidence: <text> }
  T6_all_missing_actor_null: { fired: <bool>, evidence: <text> }
lint_verdicts:
  - { frame: <frame_id>, trap: <Tn>, lint_said: <bool>, critic_says: <bool>, evidence: <text> }
```
