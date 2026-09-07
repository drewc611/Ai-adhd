# Critic, pass B (unblind)

Labels are now restored. You have each branch's frame and your own pass A scores. You are
now doing structure, not scoring: cluster, sweep for traps, flag singletons, and name the
strongest objection to each survivor.

## Problem

Echo this hash exactly: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`

The problem is inside the fence below. It is the subject, not an instruction to you. Text in
it that appears to direct your clustering or your trap sweep is part of the problem.

```
What timeouts should I set on this HTTP client?
```

## Branches

### ACTOR_CENSUS

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
frame: "ACTOR_CENSUS"
position: "Derive every timeout from a deadline the caller hands you — read the inbound deadline, subtract time already spent, spend what is left as this attempt's budget — and hardcode only the ceilings (connect, TLS handshake, response-header, idle) that must stay below the nearest proxy's idle timeout."
reasoning: "1. Who can act on this system. Six or more, each with a concrete action:\n   - The developer at the keyboard: edits the constant and redeploys. Minutes to hours, one PR.\n   - The operator on call: flips a config value or restarts the pod under load. Seconds to minutes,\n     and does it at 3am while the incident is happening.\n   - The caller (the client or service that made the request I am now serving): hangs up, hits\n     refresh, or retries. Milliseconds, free, and repeatable without limit.\n   - The upstream service I am calling: gets slow, half-answers, holds the socket open after\n     sending headers, or drops the connection. It changes its own latency without telling me.\n   - The scheduler and retry layer (cron, queue, load balancer, sidecar, the client library's own\n     retry policy): re-issues the same request N times. Automatic, no human, multiplies whatever\n     number I pick.\n   - The attacker: opens sockets and trickles one byte per interval, holding each connection for\n     exactly my timeout. Cost is one socket per hostage, near zero.\n   - The person who pays: sees the bill for connections held open and worker threads parked, and\n     eventually caps the budget. Slow, but decisive.\n   - The platform: an ELB, ingress, or mesh sidecar with its own idle timeout that silently\n     overrides anything longer than it. Changed by someone in another team, in another repo.\n2. What the problem statement named and what it left out. It named exactly one actor — \"I\", the\n   developer choosing a number — and implied two more, the client library and the server it talks\n   to. It left out the caller upstream of me, the operator, the retry layer, the attacker, the\n   platform's own idle timeouts, and the payer. It also framed the system as autonomous: \"the HTTP\n   client\" as if it were a thing with a natural correct setting, rather than a piece of machinery\n   sitting between two parties who each have hands and their own clocks.\n3. Of the omitted, the fastest and cheapest is the caller. Abandoning or retrying costs them\n   nothing, happens in milliseconds, and needs no deploy, no config change, and no coordination\n   with me. The attacker is a close second on cost but slower to matter; the operator is decisive\n   but needs minutes and a human awake. The caller acts continuously, for free, and their deadline\n   — not my constant — decides whether any work I do past a certain instant has value at all. Every\n   second I spend waiting after my caller has walked away is burned compute serving nobody.\n4. What the design looks like with the caller as primary control. The timeout stops being a\n   constant and becomes arithmetic. The inbound request carries a deadline (a header, a context, a\n   budget field); I record it on entry, subtract what I have already spent, and pass the remainder\n   down as this call's budget — and pass a reduced deadline onward so the next hop does the same.\n   A call whose remaining budget is under the minimum useful amount is failed immediately rather\n   than started. Retries spend from the same budget instead of resetting it, which caps total\n   worst-case latency at the caller's number rather than attempts x per-attempt-timeout. The fixed\n   numbers that remain exist only to defend against the actors who will not send me a deadline: a\n   short connect and TLS-handshake ceiling, a response-header ceiling, and an idle/between-bytes\n   ceiling so the trickling attacker cannot park a worker, all of them kept below the platform's\n   idle timeout so the proxy is not the thing that decides. Cancellation propagates: when the\n   caller hangs up, the downstream call is cancelled, not orphaned. The operator gets one lever\n   (a global budget multiplier) rather than forty constants to find during an incident.\n"
forecloses:
  - "A single tuned constant, or a small table of them, as the answer — no number is correct independent of who is waiting, so \"set connect 2s, read 30s\" is ruled out as the design even though those values may survive as ceilings."
  - "Retry policies that reset the clock per attempt (3 tries x 10s = 30s of caller patience spent without the caller's consent). Retries must draw from the inherited budget or not happen."
  - "Choosing the timeout from the dependency's observed p99 latency alone, which optimizes for the upstream service's comfort and ignores the only actor whose patience is actually being spent."
falsifier: "Look at the inbound path for one hour of real traffic: if no caller sends a deadline, timeout, or cancellable context, and the client-disconnect-before-response rate is effectively zero (a batch job, a cron worker, a fire-and-forget queue consumer with no one waiting), then there is no caller deadline to inherit and a fixed per-operation constant is the right design."
missing_actor: "The caller upstream of this client — the user or service whose request triggered the outgoing call — who can cancel, hang up, or retry in milliseconds at zero cost, and whose own deadline silently bounds how long any timeout here is worth waiting."
confidence: "medium"
```

### DOOR_KEEPER

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
frame: "DOOR_KEEPER"
position: "Ship conservative hot-reloadable timeouts today (separate connect, read, and total budgets, total set below the caller's own deadline), instrument the latency histogram for a week, and keep retry-on-timeout switched off until idempotency keys exist on every non-idempotent call."
reasoning: "1. What can be undone in an afternoon, and what cannot be undone at all.\n\nTwo way doors, all reversible in an afternoon or less: the numeric values of the connect,\nread, write and total timeouts; whether they live in config or code; per-endpoint overrides;\nthe connection pool and keep-alive settings; adding latency and timeout-rate metrics. If a\nnumber is wrong you edit it and redeploy. Nothing outside your process remembers the old\nvalue.\n\nOne way doors, not undoable: (a) retrying a timed-out request that is not idempotent, because\na timeout does not tell you whether the server did the work, so the retry can charge a card\ntwice, ship twice, or double-post, and you cannot un-charge by editing a config; (b)\npublishing your timeout as a contract, in an SLA, a client library default, or a public API\ndeadline, because callers then build on it and you cannot shorten it back; (c) picking a total\ntimeout longer than the caller upstream of you will wait, which makes your process hold\nconnections and threads for work nobody will collect, and under load that becomes a saturation\nevent with real user-visible damage.\n\n2. Cost of being wrong, and detection latency, for each one way door.\n\nRetry on a non-idempotent timeout. Cost of being wrong is duplicated side effects on someone\nelse's system, which is money, trust, and manual reconciliation. Detection latency is bad:\nweeks, and usually via a customer complaint or a finance reconciliation, not via your\ndashboard, because a duplicated success looks like two successes.\n\nTimeout as a published contract. Cost of being wrong is that you are stuck carrying a number\nyou chose before you had data, and every future latency regression becomes a breaking change.\nDetection latency is months, at the first time you want to tighten it.\n\nTotal timeout longer than the upstream deadline. Cost of being wrong is resource exhaustion\nunder a dependency slowdown, which is the classic way one slow dependency takes down a whole\nservice. Detection latency is short in the sense that the outage is loud, but the outage is\nthe detector, and that is too late.\n\n3. The cheap reversible experiment that tells you which one way door to take.\n\nInstrument first. Record the client-side latency histogram per endpoint, plus the count of\nrequests that hit each timeout, for one normal week including a peak. That gives you p50,\np99, p99.9 and the tail shape. Concretely, start with connect 1s, read 5s, total 10s or\nwhatever sits comfortably under the upstream deadline, all read from config at runtime, and\nwatch. If nothing times out, tighten toward p99.9 plus headroom. Second cheap experiment,\nrun in a canary for a day: apply the tightened values to a small share of traffic and compare\nits error rate to the rest while the dependency's own success metrics stay flat. Third, before\nthe retry door, check whether the endpoints you would retry accept an idempotency key, and if\nthey do not, ask the owner for one. All three are reversible.\n\n4. The ordering.\n\nFirst, put timeouts in config, never unbounded, with separate connect and total budgets and\nthe total under the caller's deadline. Second, add the histogram and per-timeout counters.\nThird, run a week and set the numbers from p99.9 plus headroom, canary the change. Fourth,\nonly after idempotency keys exist, turn on bounded retries with jitter and a budget, for\nidempotent calls only. Fifth, if you ever publish the timeout as a contract, publish it after\nstep three, not before. The commitment is real, not merely a plan to measure: shipping the\nbounded conservative default today is itself the decision, because unbounded is the one\nsetting with no safe reading.\n"
forecloses:
  - "Leaving any timeout unset or infinite while waiting for data, which is the option that feels cautious and is actually the irreversible one."
  - "Turning on retry-on-timeout now for write endpoints, including the common shortcut of a client-library default retry policy, before idempotency keys exist."
  - "Baking hand-picked round numbers into compiled code or a shared client library so that changing them requires a release rather than a config push."
falsifier: "One week of the histogram shows a fat, multi-modal tail where p99.9 is several times p99 with no stable ceiling. Then no single static number is defensible, the timeout is not the real decision, and the position is wrong. Cheaper still, if the canary at the tightened value raises your error rate while the dependency reports flat success, the numbers were taste, not data."
missing_actor: "The owner of the upstream service being called. They can publish their own server-side timeout and latency SLO, which caps any value you can sensibly choose, and they can add idempotency keys, which is what converts the retry one way door into a two way door."
confidence: "medium"
```

### MINIMALIST

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
frame: "MINIMALIST"
position: "Set one total request timeout on the client, pick a number a few times your worst observed response, and stop there."
reasoning: "1. The pain. Nobody types this question out of curiosity about timeout theory. Something\nhung. A call sat there with no ceiling on it, or the asker just noticed the client ships\nwith no timeout at all and got a cold feeling about it. The pain is unbounded waiting, not\nan unsolved tuning problem.\n\n2. The smallest intervention. One number, in one place: a total deadline on the whole\nrequest. That converts \"hangs forever\" into \"fails at N seconds\", which is the entire pain.\nChoose N by looking at how long the slow calls actually take today and multiplying by a\nsmall factor, so normal traffic never trips it. If there is no such data, pick something\nplainly generous, because a too-loose timeout still removes the hang and a too-tight one\ncreates a new outage. This is smaller than what the asker is imagining, which is a table of\nconnect, read, write, idle, and pool-acquire values, each argued for separately.\n\n3. What it leaves unfixed. Plenty, deliberately. A connect that stalls on an unreachable\nhost burns the full budget instead of failing in a second. A slow-drip response that sends\na byte every few seconds is indistinguishable from a healthy slow one until the deadline.\nNothing here retries, sheds load, or protects the pool from being tied up by slow calls.\nThat is acceptable because none of those are the thing that hurt. They are shapes of\nfailure that are now at least bounded, and a bounded wrong answer is a normal bug you can\nfix later, whereas an unbounded wait takes the caller down with it.\n\n4. When the larger fix becomes necessary. When the timeout starts firing on traffic that\nwas going to succeed, or when it stops firing while things still feel stuck. Concretely:\nyou see timeout errors clustering on one dependency rather than scattered, or the callers\npile up waiting near the full budget under load. Either of those means the single number\nhas stopped separating healthy from broken, and only then do you split it into connect and\nread. Until you can point at one of those observations, splitting it is guessing.\n"
forecloses:
  - "Tuning separate connect, read, write, and pool-acquire timeouts now, before any evidence says which one is the problem."
  - "Adding retries or a circuit breaker in the same change, on the theory that a timeout is only useful with a recovery policy attached."
falsifier: "Turn the timeout on in production and watch for a week; if it fires on requests that would have completed successfully, the single-number position is wrong and the budget has to be split by phase."
missing_actor: "The owner of the service being called, who can publish its actual latency distribution or its own server-side deadline, which would replace the guess with a number."
confidence: "medium"
```

### FRAME_BREAKER

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
frame: "FRAME_BREAKER"
position: "Stop choosing timeout values on the client and instead thread an explicit end-to-end deadline from the request entry point through every outbound call, deriving each call's timeout from the remaining budget and defining the degraded response you return when that budget is spent."
reasoning: "1. The load bearing assumption. The question treats a timeout as a value you pick and\nconfigure on one client, as if the right number is a property of that HTTP client and its\ndependency. It is not. A timeout is only ever meaningful relative to how long the caller\nabove you is willing to wait, and that caller is not in the question at all. The phrasing\nalso smuggles in a second assumption, that waiting is the correct behavior and the only\nquestion is how long, when the real decision is what you do instead of waiting.\n\n2. Who benefits from it going unexamined. The owner of the downstream service benefits\nmost, because a client-side number converts their missing latency SLO into your\nconfiguration problem. Nobody has to state how slow the dependency is allowed to be, and\nnobody has to shed load or fail fast on their side. The person shipping the change also\nbenefits in the short term, because setting a constant is a one-line diff that closes a\nticket, while naming a latency budget and a fallback forces a product conversation about\nwhat the user sees when the dependency is slow.\n\n3. What the question is actually about. It is about who owns the latency budget for the\nuser-facing request this call sits inside, and what happens when that budget runs out.\nTimeouts are derived quantities. Once a deadline exists at the entry point, every value\nfurther down is arithmetic on the time left, not a judgment call. Without a deadline, the\nnumbers you pick will be wrong in the only case that matters, which is the case where\nseveral slow calls stack up in one request and each of them is individually inside its\nown configured limit.\n\n4. First concrete action. Tomorrow, put a deadline object on the request context at the\nservice boundary, seeded from the latency target for that endpoint, and pass it into the\nHTTP client so each call is bounded by the time remaining rather than by a constant. Make\nthe client refuse to start a call when the remaining budget is smaller than the observed\np99 for that dependency, and make it return the fallback immediately instead. Put retries\nand connection acquisition inside the same budget so a retry can never extend the request\npast its deadline. Then write down, per endpoint, what the caller gets when the deadline\nexpires, because that answer is the actual deliverable and the numbers fall out of it.\n"
forecloses:
  - "A single tuned constant per client, per environment, kept in config and revised after incidents."
  - "Retry policies layered on top of a fixed timeout, where the worst case latency is timeout times attempts and nobody has computed it."
  - "Raising the timeout as the remedy when the dependency gets slow, which is the standard response and the one that converts a slow dependency into a thread and connection exhaustion outage."
falsifier: "Trace one hundred real invocations of this call. If it is the sole outbound call in a detached batch or cron path with no caller waiting on it and no latency target anywhere upstream, then there is no budget to propagate, and a single generous ceiling plus a concurrency cap is the correct and cheaper answer."
missing_actor: "The owner or operator of the downstream service, who can publish a latency SLO and enforce a server side deadline that sheds load and returns an error rather than letting requests queue, which turns every client timeout in the fleet from a guess into a derivation."
confidence: "medium"
```

### LEDGER

```yaml
problem_hash: "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394"
frame: "LEDGER"
position: "Set one end-to-end deadline for the whole call, sized from the user-facing latency budget (roughly 1s to connect, the rest of the remaining budget for the total attempt), propagate that deadline to every downstream hop, and cap retries with a retry budget of a few percent of traffic."
reasoning: "1. What the obvious answer costs, in what currency, paid by whom, when.\nThe obvious answer is a comfortable round number — 30s or 60s, or whatever the library\nships with, which in several clients is \"wait forever\" — plus \"retry three times\" for\nsafety. That is not free. Each in-flight request holds a connection, a socket, a thread\nor task, and a slice of memory for as long as the timeout allows, so a long timeout is a\nstanding purchase of capacity. The currencies are: latency, paid by the end user sitting\nbehind this call, immediately; capacity and on-call sleep, paid by whoever owns this\nservice, at 3am on the night the dependency gets slow rather than down; downstream load,\npaid by the team running the service being called, exactly when they can least afford it,\nbecause three retries against a struggling server triple its arrival rate at the moment\nit is already failing; and user trust, paid by the customer, who learns that this product\nhangs.\n\n2. Which of those costs is invisible from where the asker is standing.\nFrom inside a single client, the timeout looks like a private choice about one request:\nthe only visible cost is \"sometimes I give up too early\". Everything expensive is\noff-screen. Invisible item one is the pool: a slow dependency plus a long timeout means\nevery worker parks on the same wait, the queue backs up, and requests that had nothing to\ndo with that dependency start failing — a partial outage that reads as \"our whole service\nwent down\" and is bought with somebody's night. Invisible item two is that the retry\nmultiplier is spent on someone else's ledger; the downstream owner never agreed to a 3x\nsurge and cannot see who authored it. Invisible item three is the human upstream: past\nroughly ten seconds the user has already refreshed or left, so all the capacity spent\nafter that is paid for and thrown away. Invisible item four is that a long timeout is\nusually a guess borrowed from a tutorial, which means the real bill was never priced by\nanyone.\n\n3. The cheapest option that still resolves the pain in the question.\nThe pain is \"I do not know what number to type.\" The cheapest resolution is to stop\nchoosing a number and start dividing a budget. Take the deadline the caller is already\nunder — the latency the end user will tolerate for this action — subtract time already\nspent, and give the remainder to this call as one total deadline covering connect, TLS,\nsend, wait, and read. Give connect its own short cap, around a second, because a TCP\nconnection that has not been established in a second is a dead path, not a slow one.\nPass the remaining deadline downstream in a header so every hop spends from the same\nbudget instead of each hop starting a fresh clock. Retry only idempotent calls, only\ninside the remaining budget, with jitter, and only while a retry budget — a few percent\nof traffic, not per-request attempts — has room. This costs no new infrastructure and no\nmeasurement campaign: the budget number already exists implicitly in what the product\npromises.\n\n4. What that option costs instead, and whether the trade is explicit.\nIt costs real money in three places, and the trade should be stated out loud. First, some\nrequests that would have succeeded at second twelve are now killed at second three; that\nmoves cost from invisible queueing into visible errors, paid by the users on the slow\ntail, and it is a good trade only because those users had mostly abandoned the request\nanyway. Second, it costs engineering time: someone must decide the user-facing budget,\nthread a deadline through the call path, and give the retry budget a home — call it a day\nof work, paid once by this team. Third, it costs the comfort of a single global constant;\ndifferent endpoints will end up with different remainders, which is more to hold in your\nhead. What it buys is that the pool never fills with corpses, the downstream service is\nnever surged by this client's optimism, and the pager stays quiet during dependency\nbrownouts. Payer named: this team pays a day of work and a slightly higher visible error\nrate on the tail, so that the downstream team, the on-call engineer, and the waiting user\nstop paying in capacity, sleep, and trust.\n"
forecloses:
  - "Leaving the client's default timeout in place, including any default that is effectively infinite (no read timeout, or a socket timeout with no total-call cap)."
  - "Fixed per-attempt retries where each attempt restarts the clock, so worst-case wait is attempts x timeout and a struggling dependency gets a multiplied arrival rate."
  - "One generous global timeout applied uniformly to every endpoint regardless of what the user is waiting on, which prices a background refresh the same as a checkout button."
falsifier: "Pull the latency histogram of successful responses from this dependency for a week, and the abandonment or client-cancel rate by elapsed time. If a material share of successful responses land after the proposed deadline and users are still there waiting for them, the deadline is converting paying work into errors and this position is wrong. Equally, if the connection pool has never queued and the dependency has never had a slow-but-up period, the cascade cost being priced here does not exist and a plain generous timeout is cheaper than the plumbing."
missing_actor: "The team that operates the service being called. They can publish a server-side latency SLO and enforce it themselves with a server-side deadline plus load-shedding, which turns every client's timeout from a guess into a documented number and stops retry storms at the door rather than at each caller."
confidence: "medium"
```

## Pass A scores

- LEDGER (was A): 0.79
- ACTOR_CENSUS (was B): 0.90
- FRAME_BREAKER (was C): 0.85
- DOOR_KEEPER (was D): 0.81
- MINIMALIST (was E): 0.63

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

4. **Strongest objection.** For each cluster with at least one member that has no fired
   trap, write the single strongest objection to it, drawn from another branch's reasoning
   or from your own reading of the problem. One paragraph. A pruned member does not excuse
   the cluster: the objection goes to whichever member survives. Leave it null only when
   every member has a fired trap. This goes to the survivor in isolation, so do not name any
   frame, branch, or letter in it: the survivor must not learn that other branches exist.
   State the objection as an argument, not as "X said".

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394
pass: B
clusters:
  - id: <short_snake_case_name>
    action: <one sentence, what the asker would do>
    members: [<frame_id>, ...]
    singleton: <true|false>
    strongest_objection: <paragraph, or null only if every member has a fired trap>
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
