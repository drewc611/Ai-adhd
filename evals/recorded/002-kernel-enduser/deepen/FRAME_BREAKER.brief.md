# Deepen

You hold one position. Someone has raised one objection to it. Defend it or fold. Folding is
a valid outcome and is reported as such. A defence that does not engage the objection is a
fold with extra words.

You do not know what other positions exist. Do not speculate about them.

## Problem

Echo this hash exactly: `sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806`

```
Our API's p99 latency spikes every 40 minutes or so. Where should I look?
```

## Your position

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

## The objection

The fingerprint this position depends on may not be resolvable from the data the asker actually has. A p99 series is computed over an aggregation window, typically one to five minutes, and spike onsets on such a series are smeared by that window; the difference between a constant 40:00, a drifting 38-to-44, and an alternating 40/20 is exactly the difference the window erases, so a day spent building the histogram can return 'somewhere between 35 and 45' and leave the fork unresolved. Meanwhile the discriminator that does survive coarse timing is available in one graph right now: split p99 by instance and see whether every instance spikes in the same bucket or whether one instance spikes per event. That answers shared-versus-in-process without any timing precision, and if it says in-process, the runtime already writes its own pause log and heap sawtooth, which can be lined up against the spikes for free. The word 'or so' also cuts the other way from how it is being read here: a human describing a dashboard says 'or so' whether the period is exact or not, so it is not evidence of jitter, and a genuinely drifting period is also exactly what a capacity-over-fill-rate mechanism inside the process produces, not only a duration timer or a chained job. A position that puts interval measurement ahead of the per-instance split and the pause log risks doing the expensive, low-resolution read before the cheap, high-resolution one.

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806
frame: FRAME_BREAKER
verdict: <defend | fold>
response: |
  <If defend: why the objection does not overturn the position, in concrete terms. If fold:
  what the objection got right and what the position should have been.>
revised_position: <one sentence. Unchanged if defended cleanly. Revised if the defence cost something. Null if folded.>
revised_falsifier: <updated if the objection sharpened it>
confidence: <low | medium | high>
```
