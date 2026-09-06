# Critic, pass A (blind)

You are scoring reasoning artifacts. You do not know how they were produced or under what
instruction. Each is labelled with a letter. Score each independently against the rubric.

You are not scoring quality. Fluent, thorough, balanced answers are what a competent person
produces in thirty seconds, and that is the failure this system exists to catch. Score only
the dimensions below. Do not score fluency, thoroughness, balance, completeness, tone,
length, or how much you agree.

## Problem

Echo this hash exactly: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`

```
What timeouts should I set on this HTTP client?
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
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
position: "Set connect timeout to 2s, per-request total deadline to 10s, and no infinite anything, then ship it behind a config value and tighten from observed p99 after one week of traffic."
reasoning: "1. Reversible vs irreversible. Almost every timeout number is a two way door: connect timeout,\nread/response timeout, total deadline, idle pool timeout. Change a constant, redeploy, done in an\nafternoon. What is not undoable in an afternoon is the shape of the decision, not the number:\n(a) whether the client exposes a per-request deadline at all versus one global value baked into\na shared singleton that dozens of call sites inherit; (b) whether callers are allowed to pass\n\"no timeout\" (infinite), because once a code path depends on a blocking-forever call, removing\nthat later breaks it; (c) whether the timeout is enforced on the total request or only on\nsocket reads, because a slow-trickle server defeats a read timeout and changing the semantics\nlater changes behavior for every caller at once; (d) whether retries are layered on top of the\ntimeout, because timeout times retries is the real worst case and callers upstream will have\nsized their own budgets to whatever you ship first. Those four are the one way doors: they get\ncopied into other services' expectations and into runbooks.\n\n2. Cost of being wrong and detection latency for each one way door. (a) Global-only timeout:\ncost is a slow endpoint forcing the global value up for everyone, or a fast endpoint tolerating\na far-too-long hang; detection latency is weeks, first seen as a thread pool exhaustion incident\nduring a dependency brownout. (b) Allowing infinite: cost is a hung process during a partial\nnetwork partition, no error, no log, just a stalled worker; detection latency is the length of\nthe partition, and you find out from a pager, not a dashboard. (c) Read-only rather than total:\ncost is the slowloris case, a server that sends one byte every few seconds never trips the\ntimeout; latency until detection is whenever a dependency degrades that way, could be months.\n(d) Retries multiplying the deadline: cost is a 10s timeout becoming a 30s or 40s hang under\nretry-with-backoff, plus retry storms amplifying load on an already sick dependency; detection\nis at the first real outage, which is exactly the wrong time.\n\n3. Cheap reversible experiments. Before committing to the shape: wrap the client in a config\ndriven setting, deploy with deliberately generous numbers (connect 2s, total 10s), and log\nevery request's elapsed time with the endpoint tag. One week of that tells you the p50, p99,\nand max per endpoint, which tells you whether one global number is even plausible (answers\ndoor a). Point the client at a local server that accepts TCP and never responds, and at one\nthat trickles bytes, and confirm the client actually gives up at the total deadline (answers\ndoor c, in an hour). Grep for any call site that would need infinite; if none exists today,\ndoor b closes cheaply now. Run a fault injection where the dependency returns 503 and watch the\nwall clock per logical operation with retries on (answers door d).\n\n4. Ordering. First, the free commitments that close doors at zero cost today: enforce a total\nper-request deadline, not just read; forbid infinite by construction; expose per-call override\nof the deadline; document that the retry budget is included inside the deadline, not on top.\nSecond, ship with connect 2s and total 10s as the defaults, because connect should fail fast\non an unreachable host (TCP handshake on a healthy network is tens of milliseconds, 2s is\nalready forgiving) and 10s is long enough to not cause false failures on unknown endpoints\nwhile short enough that a hung worker is noticed. Third, after a week of elapsed-time data,\ntighten the total deadline per endpoint to roughly 2x to 3x observed p99. The numbers are the\ntwo way door and get walked through first, generously. The semantics are the one way door and\nare taken now, with the detection experiments named above, because the experiments are cheap\nand the semantics are what actually hurt when wrong.\n"
forecloses:
  - "A single global timeout with no per-request override"
  - "Any code path that waits indefinitely on an HTTP call"
  - "Retries layered outside the deadline so the effective worst case exceeds the configured timeout"
  - "Setting tight production timeouts (sub-second) before having observed latency distribution data"
falsifier: "A week of elapsed-time logs showing a legitimate endpoint whose p99 exceeds 10s without a bug on the server side, which would mean the 10s starting default causes false failures and the generous-first ordering was not generous enough."
missing_actor: "The owners of the upstream service being called, who can publish their own latency SLO and set server-side request deadlines; without that, the client's timeout is a guess about someone else's system."
confidence: "medium"
```

### Artifact B

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
position: "Make every request carry a deadline handed in by the caller and propagated from whoever is waiting on it, and give the client itself only short fixed floors (connect 1-2s, per-read idle 5s, hard total cap 30s) that the caller's deadline can shorten but never lengthen."
reasoning: "1. Who can act on this system, and how fast and how cheaply:\n   - The developer at the keyboard: edits the timeout constants and redeploys. Minutes to hours, costs a build and a review.\n   - The operator on call: changes a config value or feature flag, restarts the process, scales replicas. Seconds if a runtime knob exists, minutes if it needs a rollout. Cheap but needs a pager to fire first.\n   - The immediate caller of the client (the code path or handler that invokes it): can retry, can fan out, can cancel, can pass or not pass a deadline. Milliseconds, essentially free, and it acts on every single request.\n   - The end user behind that caller (browser, mobile app, CLI user): hits refresh, navigates away, kills the command, gives up. Sub-second, zero cost, no permission needed, and it happens thousands of times a day without anyone logging it.\n   - The upstream service and its operator: can hang after accepting the TCP connection, trickle bytes, return a slow 200, deploy something that adds 800ms. Milliseconds to hours, and it is outside our control entirely.\n   - The scheduler and infrastructure (kubelet liveness probe, load balancer idle timeout, autoscaler, NAT gateway): can kill the pod, drop the idle connection at 60s, or reap the container mid-request. Seconds, automatic, and it does not care what our timeout says.\n   - The attacker: can run a slowloris-style upstream or poison DNS so connects hang, holding our thread pool open for the cost of a few idle sockets. Milliseconds, nearly free.\n   - The person who pays: sees the bill for retry storms and stuck threads and cuts the budget or adds a quota. Days, expensive, blunt.\n2. The problem statement names exactly one actor: \"I\", the developer choosing the numbers, plus a passive \"this HTTP client\". It leaves out the operator, the caller, the end user, the upstream, the scheduler, the attacker, and the payer. It also frames the client as if it will run unattended with the numbers frozen in, which is the autonomy assumption the frame forbids.\n3. Of the omitted, the fastest and cheapest controller is the end user (or the caller acting on their behalf) abandoning the request. Refresh is instant and free. The attacker is nearly as fast and cheap but only shows up sometimes; the abandoning user shows up on every slow request, all day, in production, and today their signal is thrown away because a fixed-timeout client keeps waiting on an upstream for a response nobody will ever read.\n4. Treating that actor as the primary control changes what \"the timeout\" even is. The number is not a property of the client; it is a property of who is waiting. So the client's API takes a deadline (a context, cancellation token, or absolute time) on every call, and the caller derives it from what is upstream of them: a browser request that has already burned 700ms of a 2s budget passes the remaining 1.3s; a background job passes a generous 30s; a health check passes 500ms. When the user cancels, the caller cancels, and the client aborts the socket immediately instead of finishing a doomed read. The client keeps a small set of fixed floors that exist to defend the process from the actors who cannot be trusted with the deadline: a connect timeout of 1-2s (a healthy peer on the same network answers in tens of milliseconds; anything longer is a dead host, a blackholed route, or an attacker), a per-read idle timeout of about 5s (guards against a peer that accepted the connection and then trickles), and a hard total cap of 30s that stays below the load balancer and liveness probe cutoffs so the scheduler never has to be the one to end the request. Those floors are also exposed as runtime config so the operator can tighten them in seconds during an incident without a redeploy. The developer's job shrinks from picking the right numbers to picking the floors and making it impossible to call the client without a deadline.\n"
forecloses:
  - "A single global timeout constant (or the library's default, which is often infinite) compiled into the client and shared by every call site regardless of who is waiting."
  - "Tuning the timeout purely to the upstream's observed p99 latency, which treats the upstream as the only actor and ignores that the person waiting may have already left."
  - "Letting the load balancer, liveness probe, or thread-pool exhaustion be the mechanism that eventually ends a stuck request."
falsifier: "Instrument the caller side and observe that over a week no request was ever cancelled or abandoned before completion (for example, the only caller is an unattended batch job with no human or upstream deadline); then the caller-deadline plumbing buys nothing and fixed floors tuned to the upstream's p99 are the correct and simpler answer."
missing_actor: "The end user (or the caller on their behalf) who abandons the request by hitting refresh, navigating away, or killing the process; the action is cancellation, and the client should honor it immediately rather than continue waiting on the upstream."
confidence: "medium"
```

### Artifact C

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
position: "Set a short connect timeout (about 1 to 2 seconds), a per-request total deadline sized to the slowest legitimate response you have actually measured plus a small margin (typically 2 to 5 seconds for an API call), and cap retries at one with jitter, so the bill for a slow dependency is paid by the caller failing fast rather than by the downstream service and its on-call engineer absorbing a pile-up."
reasoning: "1. The obvious answer is \"generous timeouts so nothing fails spuriously\": 30 seconds, or the library default, which is often no timeout at all. Its cost is paid in three currencies by three payers, none of them the asker at the moment of asking. First, threads, sockets, and memory in the asker's own process are held open for the full 30 seconds per stalled call; under a partial outage of the dependency the process exhausts its pool and the asker's service goes down for everyone, not just for the requests that touched the sick dependency. That bill lands on the asker's users, later, at the worst possible time. Second, every retry the client fires on top of a long timeout is a second full-weight request at the downstream service exactly when it is already struggling; the downstream team's on-call engineer pays in sleep and the downstream service pays in compute for work whose result nobody will read. Third, the end user or the calling service upstream waits the full 30 seconds staring at a spinner before learning anything, paying in trust and in their own held resources.\n2. From where the asker stands, only the first cost is even partially visible, and only under load, which is not when they are writing the config. The retry amplification is invisible because it is paid by a different team's pager. The upstream wait is invisible because the asker sees their own latency histogram, not the p99 of whoever is calling them. The socket and memory exhaustion is invisible because it costs nothing in the happy path; defaults look free right up until the incident. A default of \"no timeout\" is the most expensive option on the ledger precisely because its price shows up as zero in every test.\n3. The cheapest option that still resolves the pain (\"what number do I type\") is: connect timeout short and fixed (1 to 2 seconds; a TCP handshake that has not completed in that time is talking to a dead or partitioned host and waiting longer buys nothing), read or total deadline set from the measured slow tail of real responses plus a margin rather than from a round number, and a retry budget of at most one retry with jitter, only on idempotent requests, and only when the remaining deadline can afford it. This resolves the pain with no new infrastructure; the only spend is one afternoon looking at the dependency's actual latency distribution.\n4. What it costs instead: some legitimately slow requests will now fail that would have succeeded under a 30 second ceiling. That bill is paid by the small fraction of users on the slow tail, in the currency of a visible error instead of a slow success, and by the asker in the currency of having to handle that error path deliberately. That trade is explicit and it is the right one, because a fast, honest failure is cheaper for everyone downstream and upstream than a slow, silent resource hold, and it is the only option on this ledger where the payer is the party who chose the dependency. Anyone who objects that the tail is too fat is describing a dependency problem, and the timeout is the instrument that makes that problem visible enough to get fixed by the people who own it.\n"
forecloses:
  - "Leaving the library default timeout in place, including the common default of no timeout at all."
  - "Setting a single generous timeout (30 seconds or more) and relying on aggressive retries to smooth over failures."
  - "Choosing the number by intuition or convention rather than from the measured latency distribution of the actual dependency."
falsifier: "Pull the dependency's real response latency histogram for the last week; if the p99.9 of legitimate successful responses is well above the proposed total deadline and those slow responses are ones the business needs to succeed rather than fail, the deadline is too tight and this position is wrong for that endpoint."
missing_actor: "The team that owns the downstream service being called; they can publish an SLO and a documented per-request time budget, and they can enforce server-side deadlines and load shedding, which is what actually protects them from retry storms regardless of what any single client sets."
confidence: "medium"
```

### Artifact D

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
position: "Stop configuring a timeout on the client at all; pass a per-call deadline derived from each caller's remaining time budget, and make the client cancel the request when that deadline expires."
reasoning: "1. The load bearing assumption is in \"on this HTTP client\": that a timeout is a property of the\n   client object, a number you pick once and store in its config. That assumption makes the\n   timeout a fact about the transport when it is actually a fact about the caller. A 200ms wait\n   is fine inside a nightly batch job and fatal inside a request that has 150ms left before a\n   user-facing SLO is blown. One client, two correct answers, so the client cannot be the place\n   the answer lives.\n\n2. Two parties benefit from leaving that unexamined. The client library author, because a\n   single config field is easy to ship and document. And the owner of the upstream service,\n   because a generous static timeout hides their slowness inside your latency instead of\n   surfacing it as your failures. Both are served by you picking a number and moving on.\n\n3. If the assumption is false, the question is really: how much time does each caller of this\n   client have left when it makes the call, and what should happen when that runs out? That is a\n   question about deadline propagation and failure handling, not about the client. The client\n   just needs an interface that accepts a deadline (context, cancellation token, per-request\n   timeout argument) and honours it, plus a short connect timeout and one absurdly large total\n   cap as a backstop against bugs, not as policy.\n\n4. First concrete action: list every call site of this client. For each one, write down where\n   its time budget comes from (an inbound request deadline, a job SLA, a UI interaction) and\n   what the caller should do on expiry (fail fast, serve stale, skip). Then change the client's\n   call signature to require a deadline and delete the client-wide timeout field so nobody can\n   fall back to it. Retries live inside the same deadline, never on top of it.\n"
forecloses:
  - "A single global timeout number in the client's configuration that all callers inherit."
  - "Choosing timeouts by looking at the upstream server's p99 latency rather than the caller's budget."
  - "Retry policies that add their own time on top of the request instead of consuming the caller's remaining deadline."
falsifier: "Enumerate the call sites; if there is exactly one caller with one fixed latency budget (for example a single batch job hitting one endpoint), then per-call deadline propagation adds nothing and a single static timeout was the right answer."
missing_actor: "The owner of the upstream service being called, who can publish a latency SLO and return 503 with Retry-After when overloaded, so callers stop guessing how long to wait."
confidence: "medium"
```

### Artifact E

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
position: "Set a single overall request deadline of 10 seconds on the client and change nothing else."
reasoning: "1. The pain. Nobody asks about timeouts because they read the docs. They ask because a call\nhung, or they are afraid one will, and the client's default is either infinite or unknown.\nThe pain is \"a request can wait forever and take my process with it.\" Everything else in\nthe topic (connect vs read vs write, per-route tuning, retry budgets) is imagined pain.\n\n2. The smallest intervention. One number. A total per-request deadline, set at the client\nlevel so every call inherits it. 10 seconds is chosen not because it is optimal but because\nit is long enough that a healthy dependency essentially never trips it and short enough\nthat a hung one gets noticed the same day. Distinguishing connect from read timeouts buys\nnothing here: both failures look the same to the caller (the call did not come back) and\nthe overall deadline bounds both.\n\n3. What it leaves unfixed. Nothing is tuned. A slow-but-alive dependency will occasionally\nget cut off at 10s when 12s would have succeeded. Streaming or long-poll endpoints, if any\nexist, will break; the question did not mention them, so I assume none. No retry, no\nbackoff, no circuit breaker. That is acceptable because the failure mode changes from\n\"silent hang\" to \"loud error with a stack trace,\" and loud errors are how you learn the\nreal numbers.\n\n4. When the larger fix becomes necessary. When the timeout error appears in logs against a\ndependency that is genuinely healthy, you now have evidence for a per-endpoint value.\nWhen you see one endpoint that legitimately needs more than 10s, you split the client or\noverride that one call. Until a timeout error actually fires in production, any finer\nsetting is a guess, and the asker will know because the guess will be sitting in a config\nfile nobody can justify.\n"
forecloses:
  - "Separate connect, read, and write timeouts tuned per phase."
  - "Per-endpoint or per-route timeout values chosen up front."
  - "Adding retries or a circuit breaker alongside the timeout."
falsifier: "A single production timeout error fires against a dependency whose own metrics show it responded successfully in under 10 seconds, meaning the phase or route granularity actually matters and one number is wrong."
missing_actor: "The owner of the upstream service being called, who can publish an SLO or p99 latency figure that would replace the guessed 10 seconds with a derived one."
confidence: "medium"
```

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394
pass: A
scores:
  <letter>:
    <dimension_id>: { score: <0-3>, evidence: <one sentence> }
    ...
```

Every letter must have every dimension. A missing cell rejects the whole pass.
