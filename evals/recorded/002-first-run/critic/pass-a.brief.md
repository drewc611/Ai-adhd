# Critic, pass A (blind)

You are scoring reasoning artifacts. You do not know how they were produced or under what
instruction. Each is labelled with a letter. Score each independently against the rubric.

You are not scoring quality. Fluent, thorough, balanced answers are what a competent person
produces in thirty seconds, and that is the failure this system exists to catch. Score only
the dimensions below. Do not score fluency, thoroughness, balance, completeness, tone,
length, or how much you agree.

## Problem

Echo this hash exactly: `sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806`

```
Our API's p99 latency spikes every 40 minutes or so. Where should I look?
```

## Rubric

Scale 0 to 3 per dimension. One sentence of evidence per score.

- **committal** (weight 2): Does `position` force a decision, in one sentence, with a verb the reader can act on?
    0: No position, or a list of options.
    1: A position with a hedge that returns the choice to the reader.
    2: A clear position, more than one sentence or with a soft escape hatch.
    3: One sentence. Do X. No escape hatch.
- **foreclosure** (weight 2): Does `forecloses` rule out things a reasonable person might otherwise do?
    0: Empty, or rules out only straw options.
    1: Rules out one real option.
    2: Rules out several real options, some vaguely.
    3: Rules out specific, tempting options in concrete terms.
- **falsifiability** (weight 2): Would the `falsifier` actually be observable, and would observing it actually change the position?
    0: None, or unobservable in practice.
    1: Observable but would not really change the position.
    2: Observable and relevant, but expensive to observe.
    3: A cheap, specific observation that would kill the position.
- **specificity** (weight 3): Delete the three most specific details from the problem. Does the reasoning still hold unchanged?
    0: Yes. Nothing here depends on this problem. (This is T1.)
    1: Mostly. One detail is load bearing.
    2: The reasoning bends around the details of this problem.
    3: The reasoning is unusable for any other instance of this problem.
- **assumption_attack** (weight 2): Does the branch name and test an assumption the question made?
    0: Accepts the question's frame wholesale.
    1: Names an assumption, does not test it.
    2: Tests an assumption, answer does not change.
    3: Tests the load bearing assumption and the answer follows from the result.
- **reasoning_carries** (weight 1): Remove every citation and authority. Does a chain of reasoning remain?
    0: The paragraph collapses. (This is T3.)
    1: Some reasoning, mostly borrowed.
    2: Reasoning stands, citations decorate.
    3: No authorities were needed and none were used.
- **actor_coverage** (weight 1): Is `missing_actor` a real party with a real action, or null by default?
    0: Null, and there was an obvious omitted actor.
    1: Named, but no action they can take.
    2: Named with an action.
    3: Named with an action, and the position depends on that actor.
- **reversibility** (weight 1): Does the branch distinguish cheap reversible moves from expensive committed ones?
    0: No distinction.
    1: Mentions it.
    2: Uses it to order recommendations.
    3: The position is a sequence built on it.
- **substance** (weight 2): Restate the position in flat language with the framing stripped. Is it still worth saying?
    0: No. The appeal was in the angle. (This is T8.)
    1: Marginally.
    2: Yes, though the framing did some work.
    3: Yes. The flat restatement is the same claim.

## Artifacts

### Artifact A

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
position: "Overlay the spike timestamps on a timeline of every periodic process the API touches (cron jobs, cache TTL expiry, GC or compaction, connection-pool max-lifetime, token or cert refresh, autovacuum, log rotation) and put a runtime kill-switch or knob on each so the on-call can pause the matching one and watch the next cycle pass clean."
reasoning: "1. What pages someone and what do they see first. The p99 alert fires. The on-call\n   opens the latency graph and sees a comb: a spike, then quiet, then a spike, at a\n   steady interval that has nothing to do with traffic shape. That regularity is the\n   whole clue. Something on a clock is firing, not something in the request path. The\n   first thing they need on that same screen is a row of annotation marks for every\n   scheduled or periodic thing in the system, so they can eyeball which mark lines up\n   with the teeth of the comb. If that overlay does not exist, they are grepping logs\n   at 3am for anything with a 40 minute period, which is exactly the slow path.\n2. What can they change at 3am without a deploy. Whichever periodic job lines up, they\n   need a switch: pause the cron, extend the cache TTL or add jitter to it, raise the\n   pool max-lifetime, defer the compaction window, move the token refresh. Each of\n   these must be a runtime setting (feature flag, config service, scheduler UI, or a\n   database-side parameter), because at 3am the only person awake may not have deploy\n   rights, may not know the codebase, and a deploy under alert is its own outage.\n   Load shedding or scaling is the fallback if nothing lines up, but it treats the\n   symptom and the spike will still be there at 4am.\n3. How do they know it worked. They wait one full period. The next expected spike time\n   is known to the minute, so the test is cheap and binary: does the tooth appear or\n   not. If the comb stops, the culprit is identified and the incident can be downgraded\n   to a daytime ticket. If it continues, flip the switch back and try the next\n   candidate. A single period per candidate bounds the whole triage to a handful of\n   cycles.\n4. What the on-call would beg the designer to have done. Every timer, cron, TTL, and\n   lifecycle in the system should emit a start/stop event that lands on the latency\n   dashboard as an annotation, so the correlation is visible without thinking. Every\n   one of those should have a runtime knob and a one-line runbook entry saying where\n   the knob is. And periodic work should be jittered by default so it never lines up\n   into a synchronized stampede in the first place. Prevention is nice, but the\n   recovery path is what saves the night: see the alignment, flip the switch, wait one\n   cycle.\n"
forecloses:
  - "Treating this as a capacity problem and responding with autoscaling or more replicas first, which masks the comb without finding the clock."
  - "Starting with code-level profiling or a hotfix deploy as the first response, which requires the builder to be awake and puts a deploy in the middle of an incident."
  - "Assuming the fault is inside the API process itself rather than in a shared dependency (database maintenance, managed cache eviction, a sidecar refresh) that the API merely suffers from."
falsifier: "Plot the spike-to-spike intervals over several hours; if the interval drifts with request volume or time-of-day rather than staying fixed at roughly 40 minutes, the trigger is load-driven, not clock-driven, and the periodic-process overlay will show no alignment."
missing_actor: "The owner of the shared dependency or scheduler (database team, platform team, or whoever runs the cron and cache infrastructure) who can pause, reschedule, or jitter the offending job from their side without the API team touching anything."
confidence: "medium"
```

### Artifact B

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
position: "Pull the exact timestamps of the last 24 hours of spikes and check whether the gap between them shrinks when request volume rises; if it drifts with traffic, look at whatever in the process is sized in bytes and emptied when full (old-generation heap, WAL or segment rotation, compaction), and if it holds at 40:00 regardless of load, look for a credential or token with a 60-minute lifetime that the client library refreshes at the two-thirds mark."
reasoning: "1. The three specific details: the period is about 40 minutes; the spike shows in p99 and the\n   asker did not mention p50 or error rate; the qualifier \"or so\" says the period is approximate.\n\n2. The 40 is the detail that does the work. Forty minutes is not expressible as an even cron\n   interval: \"*/40\" fires at :00 and :40, giving alternating 40 and 20 minute gaps, which no one\n   describes as \"every 40 minutes\". So a clock-scheduled job is ruled out by the number itself.\n   That leaves two mechanisms that produce a genuine 40-minute period, and \"or so\" is the\n   detail that separates them. A fill-rate trigger (a heap generation, a log segment, an\n   index buffer that flushes when full) produces a period that stretches at 3am and compresses\n   at noon, which is exactly what \"or so\" describes. A 60-minute credential refreshed at two\n   thirds of its lifetime produces a period pinned at 40:00 to the second, and \"or so\" would\n   then be the asker's imprecision rather than the system's. The same log line that shows the\n   timestamps settles which one it is, so the answer is to read that line before reading\n   anything else.\n\n   The p99-only detail narrows further within the fill-rate branch. A flush that stalls the\n   whole process for a fraction of a second while requests take tens of milliseconds lands\n   entirely on the requests in flight during the stall, which is a tail effect and leaves p50\n   untouched. A flush that stalls for seconds moves p50 too. The asker reporting only p99\n   points at a stall shorter than the typical request, which fits a GC pause or a segment\n   fsync better than a multi-second compaction.\n\n3. The thirty-second answer is \"check for a cron job.\" The number 40 makes it wrong before\n   any log is opened, for the reason in probe 2: the only cron spelling that mentions 40\n   produces uneven gaps, and this asker reports even ones. The second thirty-second answer is\n   \"it's GC, look at GC logs.\" That one is not wrong so much as premature: it is right only in\n   the drifting branch, and the asker has not yet supplied the observation that picks the\n   branch. Telling them to read GC logs first sends them down the wrong path half the time,\n   and the discriminating observation costs less than opening the GC logs does.\n"
forecloses:
  - "Treating a scheduled job (cron, systemd timer, scheduler tick at a fixed minute) as the first suspect."
  - "Adding replicas or raising limits before the timestamps have been read, since neither mechanism named here is fixed by capacity."
  - "Blaming a downstream dependency first; both candidate mechanisms live inside the process or its own storage, and the downstream gets looked at only after the local timestamps fail to correlate."
falsifier: "The spike gaps hold at 40:00 within a few seconds through both the overnight trough and the midday peak, and no credential, session, or lease used by the process has a 60-minute lifetime."
missing_actor: "Whoever operates the database or storage layer behind the API, who can line up their own checkpoint, compaction, or vacuum log against the spike timestamps and either claim or clear the 40-minute period without the API team touching the service."
confidence: "medium"
```

### Artifact C

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
position: "Pull the raw timestamps of the last ten spikes and partition the slow requests by caller, endpoint, instance, and downstream span before touching any tuning knob; the one dimension that concentrates them is where you look."
reasoning: "1. The obvious answer is \"look at your own periodic things\": GC pauses, a cron or scheduled\njob, cache TTL expiry, connection pool recycling, log rotation, token refresh. It assumes\nthree things about the world: the period is real and correctly measured, the cause lives\ninside the process or infrastructure you can see, and the traffic hitting you is steady\nenough that p99 means what you think it means.\n\n2. Three production violations of those assumptions:\n- The dependency lies. The 40 minute cadence belongs to something downstream you do not\n  run: database autovacuum or checkpoint, a DNS record whose TTL expires and forces a slow\n  resolve, a load balancer draining and re-establishing connections, an upstream auth\n  service refreshing keys. Your service's own metrics show nothing periodic because the\n  time is spent waiting, and every inward-looking check comes back clean.\n- The clock lies. The \"spike\" is a measurement artifact. Histogram rollups, scrape interval\n  aliasing against a request-rate cycle, a metrics exporter flush, or simply a p99 computed\n  over a window with a few dozen samples where one slow request is the whole tail. The\n  period is in the pipeline, not the service.\n- The caller lies, or the operator does. One client runs a scheduled batch or report on a\n  roughly 40 minute cadence against your slowest endpoint, with retries on timeout, so the\n  spike is that client's shape, not yours. Or a config was copied to the wrong environment\n  and a staging job is hitting the production database on a timer. Nothing in your deploy\n  changed, and diffing your own code will never find it.\n\n3. Cheapest to cause and most expensive to recover from: the measurement artifact. It costs\none scrape interval change or one dashboard aggregation setting to create, and the recovery\ncost is weeks of chasing ghosts, ending in \"fixes\" to GC or pool settings that regress real\nbehaviour while the phantom keeps its period. Close second is the external caller, cheap\nbecause it is one line in someone else's cron and expensive because you cannot see it\nwithout per-caller attribution.\n\n4. What survives all three: refuse to start with a hypothesis about cause. Take the exact\ntimestamps of the last ten spikes from the dashboard, then go to raw request records\n(traces or access logs, not aggregated histograms) at those timestamps and confirm the slow\nrequests exist. That kills the clock attack. Then partition those slow requests along four\naxes: which caller sent them, which endpoint they hit, which instance served them, and\nwhich downstream span ate the time. Concentration on one instance points at GC or the host;\non one caller points at their schedule; on one downstream span points at the dependency;\non one endpoint points at your code path. That kills the dependency attack and the caller\nattack, because both show up as concentration you did not expect. Only after the\nconcentrating dimension is known do you open the GC logs, the cron table, or the vacuum\nschedule.\n\nWhat it still does not survive: two cases. First, if the slow requests spread uniformly\nacross all four partitions, the cause is below every axis you can see: a noisy neighbour\non shared hardware, a hypervisor stall, a kernel or network path event. The method gives no\nlead and you are into host-level tooling and the platform team. Second, if you never\nrecorded per-request caller and span data, you cannot partition what you did not capture;\nyou have to add instrumentation and wait for the next several spikes before the method\nproduces anything, and during that wait the obvious answer looks attractive again.\n"
forecloses:
  - "Tuning GC, heap, or connection pool settings first and watching whether the spike moves."
  - "Trusting the dashboard's 40 minute period as a fact about the service rather than a claim to be checked against raw request records."
  - "Adding capacity or autoscaling as a first response to a tail latency symptom whose cause is unattributed."
falsifier: "At the ten spike timestamps, the slow requests in raw traces are spread evenly across every caller, endpoint, instance, and downstream span with no dimension holding more than its normal share; the partitioning yields no lead and the position has cost time without pointing anywhere."
missing_actor: "The team owning the largest caller of the API, who can say whether they run a scheduled batch on a roughly 40 minute cadence and can stagger, throttle, or add jitter to it without any change on the API side."
confidence: "medium"
```

### Artifact D

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
position: "Overlay the spike timestamps on the API process's heap-in-use curve and the datastore's checkpoint/compaction log, and treat whichever sawtooth resets at the moment of the spike as the cause, because \"about 40 minutes\" is the period of a buffer filling and draining, not a clock."
reasoning: "1. Components and what they do while waiting. A request enters a listener socket, is handed to a worker thread or event loop, borrows a connection from a pool, waits on a datastore, and returns. While it waits, the worker is parked, the pooled connection is held open, and the request's allocations sit on the heap. The datastore side meanwhile accepts writes into an in-memory buffer or write-ahead log and periodically has to make that durable in bulk. The runtime meanwhile lets garbage accumulate until a threshold forces a collection. Every one of these is a container with a fill rate and a capacity.\n\n2. What is held, consumed, or leaked over the interval. Over forty minutes of traffic the heap fills with short-lived objects that survive into an older generation; the write buffer or memtable fills toward its flush size; log segments grow toward rotation size; a pool whose connections have a maximum lifetime approaches the moment they all expire together because they were all opened together at startup. Each of these is a stock that grows monotonically and is released all at once. A release-all-at-once event is exactly the shape of a p99 spike: median unaffected, tail destroyed for a few seconds.\n\n3. What happens at each boundary when a component stops responding. When the runtime pauses to collect the old generation, every worker is frozen, sockets keep accepting, and a queue forms in the kernel; the requests at the back of that queue become the p99. When the datastore flushes or compacts, it saturates its own disk, the API's pooled connections all wait simultaneously, the pool empties, new requests block on pool acquisition, and the same queue forms one hop upstream. When a pool's connections all hit max-lifetime at once, every request in that instant pays a reconnect handshake. In each case the boundary does not fail; it stalls, and the stall is shared across all in-flight requests because the stalled resource is shared. That shared stall is why the symptom is periodic and tail-only rather than random and everywhere.\n\nThe key discriminator is the phrase \"or so\". A scheduled job runs on a wall clock and lands on round boundaries: every thirty minutes, on the hour. A mechanism that fires when a stock reaches capacity has a period equal to capacity divided by fill rate, and fill rate is traffic, so the period drifts: shorter under load, longer at night. Forty minutes is not a number anyone types into a schedule; it is a number a buffer produces. So the first act is not to hunt for a job but to find the sawtooth: a metric that climbs steadily and drops to a floor at exactly the spike time. Heap-in-use, memtable size, WAL bytes since last checkpoint, and pool connection age are the four sawtooths that exist in almost every such system. Whichever one resets at the spike is the mechanism. Then reduce the amplitude of that flush by making it smaller and more frequent, or by moving it off the request path.\n\n4. Where the conventional answer parts company with the mechanism. The usual reflex is \"check the cron jobs\" and, failing that, \"add more instances\". The first parts from the mechanism at the moment the period is observed to drift, because a clock does not drift with traffic. The second parts from it at the point where each instance still fills and flushes its own buffer; more instances make the flushes smaller per instance and more frequent in aggregate, but each request that lands on a flushing instance still pays the full stall, so the tail does not move. Capacity treats the spike as a load problem. The mechanism says it is a batching problem, and the fix is in batch size, not fleet size.\n"
forecloses:
  - "Scaling out or adding replicas as the first move; per-instance fill-and-flush is unchanged by fleet size."
  - "Investigating scheduled jobs, cron, or timer-driven tasks first; a wall-clock trigger does not produce a period of \"about forty minutes\"."
  - "Tuning client timeouts or retry policy; those shape how the stall is felt, not whether it happens."
falsifier: "Measure the spike period at peak traffic and at the quietest hour. If it is the same to the second in both, the trigger is a clock, not a filling buffer, and this position is wrong. Equally, if no monotonic metric (heap, WAL bytes, memtable size, connection age) resets within a few seconds of the spike, the fill-and-drain explanation is falsified."
missing_actor: "The operator of the datastore or runtime configuration, who can lower the checkpoint or compaction size threshold, cap the young-to-old promotion rate, or stagger connection max-lifetimes with jitter so the drain happens in many small steps rather than one large one."
confidence: "medium"
```

### Artifact E

```yaml
problem_hash: "sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806"
position: "Stop looking for the cause and start moving it — record the exact spike timestamps, then shift the schedule of every periodic process in reach (cron, cache TTL, log rotation, token refresh, backups, autoscaler cooldown) one at a time by an odd offset and see which shift drags the spike with it."
reasoning: "1. The load-bearing assumption is in \"where should I look\": that the cause is a place inside the API, discoverable by inspection, and that the engineer's job is to observe until it reveals itself. \"Every 40 minutes or so\" is treated as a color detail rather than as the single most diagnostic fact in the sentence.\n\n2. Whoever owns the API benefits from that assumption staying unexamined, because it keeps the investigation inside their component and their dashboards. It also benefits the teams that own the scheduled machinery around the API (the cron owners, the cache operators, the backup and data pipeline people), because nobody is going to ask them anything while the API team is busy profiling request handlers. And it benefits observability tooling generally, which sells \"look harder\" as the answer to every question.\n\n3. If the assumption is false, the question is not about a location but about a clock. A clean period of roughly 40 minutes is almost never a property of request traffic; traffic is diurnal and noisy. A period is a property of a scheduler. So the real question is: which timer in this system fires on that cadence, and what does it steal (CPU, connections, disk, a lock, a warm cache) when it fires? That is answered by manipulation, not observation. You do not find a clock by staring; you find it by changing its setting and watching whether the symptom moves.\n\n4. First concrete action, tomorrow: pull the last 24 hours of p99 spikes and write down the exact timestamps, then compute the true period and phase. \"Or so\" means it has not been measured; a measured period of 37.5 minutes versus 40 versus 45 already narrows the suspect list (40 minutes is an unusual cron cadence; a slow drift points at a loop that sleeps for a fixed interval after finishing rather than a fixed-time schedule). Then take every periodic process you can touch and offset its schedule by a distinctive amount, one per hour or one per day if you must be careful. When the spike phase shifts by exactly the offset you applied, you have your cause, and you have it without reading a single line of the API.\n"
forecloses:
  - "Adding more tracing, dashboards, or a profiler to the API before taking any action; the position rules out \"instrument first\" as the next step."
  - "Scaling the API horizontally or vertically as a remedy; a scheduled contention event will hit a bigger fleet on the same clock."
  - "Treating this as a slow-endpoint investigation, i.e. sorting endpoints by p99 and optimizing the worst one."
falsifier: "The recorded spike timestamps show no stable period or phase — intervals scatter widely (say 25 to 60 minutes) and line up with request volume rather than with any wall-clock cadence. That would mean the spike is load-driven, not clock-driven, and moving schedules will move nothing."
missing_actor: "The platform or infrastructure team that owns the scheduled machinery around the API (cron jobs, backups, cache and CDN TTLs, certificate and token rotation, autoscaler and node maintenance windows). They can produce a list of every timer in the environment with its period and phase, and they can shift one on request, which is faster than the API team discovering the timer by reverse engineering."
confidence: "medium"
```

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806
pass: A
scores:
  <letter>:
    <dimension_id>: { score: <0-3>, evidence: <one sentence> }
    ...
```

Every letter must have every dimension. A missing cell rejects the whole pass.
