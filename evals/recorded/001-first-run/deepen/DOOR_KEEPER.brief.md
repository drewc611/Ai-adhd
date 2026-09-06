# Deepen

You hold one position. Someone has raised one objection to it. Defend it or fold. Folding is
a valid outcome and is reported as such. A defence that does not engage the objection is a
fold with extra words.

You do not know what other positions exist. Do not speculate about them.

## Problem

Echo this hash exactly: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`

```
What timeouts should I set on this HTTP client?
```

## Your position

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
frame: "DOOR_KEEPER"
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

## The objection

By its own argument the 10s default is not a two-way door. The branch states that whatever number ships first gets copied into other services' budgets and runbooks, and then ships 10s to every call site as the inherited default, so a week later the tightening it promises is fighting callers who have already sized to 10s. The tuning step also treats the upstream's p99 as the authority on how long to wait, which another line of reasoning forecloses directly: the party whose time is actually being spent is whoever is waiting on the caller, and a browser request with 1.3s left gains nothing from a deadline that is 2.5x some server's p99. The 2x-3x multiplier is an unjustified constant dressed as a derivation, and a week of logging is the slowest of the experiments proposed while being the only one that produces the number. another line of reasoning's point also lands: the four semantic commitments are sound but the asker cannot tell from this branch which of them is needed today versus which is design hygiene, so the answer to 'what number' arrives wrapped in an API review.

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394
frame: DOOR_KEEPER
verdict: <defend | fold>
response: |
  <If defend: why the objection does not overturn the position, in concrete terms. If fold:
  what the objection got right and what the position should have been.>
revised_position: <one sentence. Unchanged if defended cleanly. Revised if the defence cost something. Null if folded.>
revised_falsifier: <updated if the objection sharpened it>
confidence: <low | medium | high>
```
