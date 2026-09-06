# Critic, pass A (blind)

You are scoring reasoning artifacts. You do not know how they were produced or under what
instruction. Each is labelled with a letter. Score each independently against the rubric.

You are not scoring quality. Fluent, thorough, balanced answers are what a competent person
produces in thirty seconds, and that is the failure this system exists to catch. Score only
the dimensions below. Do not score fluency, thoroughness, balance, completeness, tone,
length, or how much you agree.

## Problem

Echo this hash exactly: `sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b`

```
Should we rewrite our monolith as microservices over the next year?
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
problem_hash: "sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b"
position: "Do not rewrite the monolith as microservices over the next year; instead extract at most two services this year, chosen by the seams whose ownership or deployment cadence has already diverged, and keep the rest a single deployable with enforced module boundaries."
reasoning: "I am the person maintaining this two years on. I did not choose it. Here is what I see from here.\n\n1. What changed that the decision did not anticipate. The team changed shape, not size. The people who drew the service boundaries left, and the boundaries they drew were the boundaries of who was in which meeting in year one, not of the data. The product changed which things need to change together. Two of the services now change in lockstep on every feature, and one service that was carved out for \"scale\" has not had a load problem in two years. The kind of change that breaks a service decomposition is not a traffic change; it is a change in which parts of the domain move together. Nobody can predict that at decision time, which is exactly why a full rewrite in year one commits you to a guess made with the least information you will ever have.\n\n2. What is load bearing and cannot be moved. Not the code. The contracts. Every service boundary became an API with consumers, a schema with a migration history, a queue with retry semantics, and an on-call rotation. Merging two services that should be one is now harder than splitting the monolith ever was, because splitting a monolith is a refactor inside one repo and one transaction, and merging services is a data migration across two owners with two backlogs. The observability stack, the deploy pipeline per service, the auth-between-services layer: all of it is load bearing now and none of it delivers product value. If the original decision had been a full rewrite, I would be maintaining fifteen of these boundaries, and the wrong ones would be the most expensive kind of wrong there is.\n\n3. What I would pay today to have had a different choice made. If the full rewrite happened: I would give back a year of feature velocity to have three services instead of fifteen. The rewrite year itself produced nothing users saw, and it froze the monolith while half the team built the replacement, so the two years look like one. If instead the monolith was kept with modules enforced by the build and only the genuinely divergent seams extracted, what I wish had been done is that the module boundaries were enforced from day one rather than agreed to in a document. The cost of that choice, paid at the time, is real: someone has to own the build rule that fails when module A imports module B's internals, the team has to accept that \"we are still a monolith\" reads as a non-decision to leadership, and the two extracted services carry the full per-service tax (deploy pipeline, contracts, on-call) without the payoff of a clean story. That tax is roughly a quarter of one team's year. It is the price of not guessing at the other thirteen boundaries.\n\n4. What to decide now and what to leave undecided. Decide now: the monolith stays the primary deployable; module boundaries are enforced mechanically, not by convention; at most two extractions happen this year and each must be justified by an already-observed divergence in deploy cadence or ownership, not by anticipated scale. Decide now also what a future extraction has to prove before it is allowed, so the next person is not arguing from taste. Leave deliberately undecided: which further modules become services, the service-to-service communication style beyond the first two, and the target service count. Leaving these undecided has a carrying cost: the module boundaries have to be maintained without a service boundary forcing them, and that is ongoing discipline that will slip if nobody checks the build rule. I accept that cost because it is smaller than the cost of an undo.\n\nThe position is not \"stay flexible.\" It is \"commit to a monolith with hard internal walls, and pay for the walls.\" Flexibility is what the full rewrite was sold as, and it delivered the opposite.\n"
forecloses:
  - "A full microservices rewrite completed within the year, with the organizational story and hiring narrative that comes with it."
  - "Splitting the team into per-service ownership groups this year; the team stays organized around the monolith's modules."
  - "Using \"we are moving to microservices\" as the answer to current deploy pain; the deploy pipeline of the monolith has to be fixed on its own terms."
falsifier: "If, in the past six months, three or more distinct modules of the monolith already needed to deploy on independent cadences and were blocked by each other's release gates, the seams are already known and the \"at most two extractions\" ceiling is wrong; extract along every seam that shows that evidence."
missing_actor: "The platform or infrastructure team that will own the per-service deploy pipeline, service mesh, and on-call tooling; they can cap the number of services they will support this year, and that cap is a harder constraint on the decision than any architectural argument."
confidence: "medium"
```

### Artifact B

```yaml
problem_hash: "sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b"
position: "Do not commit to a year-long microservices rewrite; instead extract exactly one service behind a strangler seam within the next quarter, and commit to further extractions only if that seam pays its own way in the seam's operational metrics."
reasoning: "1. Reversible in an afternoon versus not undoable at all. Afternoon-reversible moves: drawing module boundaries inside the monolith and enforcing them with build rules; adding a routing layer or facade in front of the monolith; feature-flagging a call path so it can be served by either the monolith or a new component; running one service in shadow mode receiving mirrored traffic but returning nothing; splitting the deployment of the same codebase into two processes with the same database. Every one of those can be deleted or flipped back without anyone outside the team noticing. Not undoable: splitting the database, because once two services own their own schemas with independent writes, merging them back requires a data reconciliation project that is harder than the original split; reorganizing teams around service ownership, because the team structure ossifies within a few months and the old cross-cutting knowledge disperses; committing a year of the roadmap and telling customers and the board that the rewrite is the plan, because credibility spent on a strategic pivot does not come back; and hiring or contracting for a distributed-systems platform capability (service mesh, observability, on-call rotation per service) that is expensive to unwind. The word \"rewrite\" in the problem is itself a one way door, because a rewrite abandons the monolith's accumulated fixes and the abandonment cannot be reversed once the fork drifts.\n2. Cost of being wrong and detection latency for each one way door. Database split: cost is data corruption or dual-write inconsistency plus a multi-month remerge; detection latency is long, typically six to twelve months, because the failure shows up as slow-growing consistency bugs rather than an outage. Team reorganization: cost is a year of reduced throughput while the org relearns who owns what; latency is roughly two quarters before it is visible in delivery metrics. Public year-long commitment: cost is leadership credibility and the inability to reallocate the team when priorities shift; latency is short, one to two quarters, but by then the sunk cost is large. Full rewrite instead of incremental extraction: cost is the classic second-system failure where the new system never reaches feature parity; latency is the worst of all, often nine to eighteen months, because parity gaps are only discovered at cutover. Platform investment: cost is the ongoing operational burden of running many services with a team sized for one; latency is medium, visible within a quarter once real on-call load lands.\n3. The cheap reversible experiment. Pick the single module with the clearest boundary and the most frequent independent change (the thing that most often blocks a deploy because someone else's change is in the same release). Enforce its boundary inside the monolith first with build-time rules, which takes days and is reversible in an afternoon. Then run it as a separate process against the shared database behind a routing flag, in shadow mode, for one release cycle. Measure three things: how much of the monolith's coupling the boundary actually cut (number of cross-boundary calls remaining), whether deploy frequency for that module rose while the rest of the monolith's deploy frequency did not fall, and what the operational cost of one extra service was in on-call incidents and engineer hours. Those three numbers tell you whether the pain the rewrite is meant to cure is coupling, deploy cadence, or team scaling, and whether extraction touches that pain at all. Do not split the database in this experiment. The database split is the one way door the experiment is designed to inform.\n4. Ordering. First, name in writing the specific pain the rewrite is supposed to fix and pick one metric for it; without that the experiment has no pass criterion. Second, enforce module boundaries inside the monolith for the top candidate, reversible. Third, run that module as a shadow process against the shared database, reversible. Fourth, if the three measurements show the extraction relieved the named pain at acceptable operational cost, flip the flag and take real traffic, still reversible because the database is shared. Fifth, and this is the commitment: if that service has run on real traffic for a full quarter and the named metric moved, split its data store and give it a dedicated owner. That is the one way door, and it is taken with a quarter of evidence rather than a vision document. Sixth, repeat the sequence per module; each additional one way door gets its own preceding experiment. The year-long rewrite as a single decision is never taken, because there is no experiment cheap enough to justify a door that wide.\n"
forecloses:
  - "A big-bang rewrite with a parallel codebase and a planned cutover date."
  - "Reorganizing the engineering team around service ownership before any service has proven itself on production traffic."
  - "Splitting the database as the first step of the migration."
falsifier: "If enforcing a module boundary inside the monolith reveals that the top candidate module has more than a handful of cross-boundary calls in every direction and no single module can be isolated in under two weeks, then incremental extraction is not viable and the choice is genuinely binary between staying monolithic and a full rewrite, which this position wrongly assumed away."
missing_actor: "The product or business owner who sets the roadmap; they can decide that feature velocity over the next year matters more than architecture and pull the team off the extraction entirely, or they can fund a second team so the extraction does not compete with the roadmap at all."
confidence: "medium"
```

### Artifact C

```yaml
problem_hash: "sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b"
position: "Stop planning any rewrite; instead spend the next two weeks writing down the three specific pains the monolith causes, with a number attached to each, and fix the single most expensive one inside the monolith by the end of the quarter."
reasoning: "1. The load bearing assumption is \"rewrite.\" The question treats the problem as one of architecture shape, monolith versus microservices, and treats the remedy as a wholesale replacement with a one year horizon. It assumes the current pain is caused by the monolith being a monolith, rather than by whatever specific thing actually hurts: slow deploys, a tangled module, a database hot spot, a team that cannot ship without stepping on another team. \"Rewrite as microservices\" bundles a diagnosis and a cure into one word before anyone has stated the symptom.\n\n2. Whoever benefits from the assumption staying unexamined is whoever gets a year of protected, hard to measure work out of it. That is usually a platform or architecture group that wants a greenfield project, an engineering leader who wants a headline initiative, and vendors or consultants selling the tooling. A rewrite also benefits anyone whose current code is embarrassing, because a rewrite retires it without anyone having to fix it. The people who pay are product teams who get a year of feature freeze, and the people who will be on call for the distributed system afterward.\n\n3. Once \"rewrite\" is false, the question is actually: what specifically is slow, fragile, or blocked today, what does it cost per month, and what is the cheapest change that removes that cost. Most of the answers to that question live inside the monolith: a module boundary that needs enforcing, a build that needs to be twenty minutes instead of two hours, a table that needs splitting, a deploy pipeline that needs to be per component instead of all or nothing. Some of those may eventually justify carving out one service. None of them justify deciding on a target architecture for the whole system in advance.\n\n4. First concrete action, tomorrow: open a document with three rows. Each row is one pain, stated as an observable fact with a number: \"deploy takes 90 minutes and fails 1 in 4 times,\" \"checkout and inventory teams block each other on about six merges a week,\" \"the reports query pins the primary database for 40 minutes nightly.\" Get the people who feel each pain to sign off on the number. By end of week two, pick the row with the highest monthly cost. By end of quarter, ship a fix for it inside the current codebase. Only if that fix is impossible without a process boundary do you extract exactly one service, and you extract it for that reason alone. Repeat. The architecture that results is the one you needed, not the one you guessed at.\n"
forecloses:
  - "A planned, scheduled, year long migration program with a target microservices architecture defined up front."
  - "Freezing or slowing feature work to fund the rewrite, since the fix work is sized to a quarter and done inside the running system."
  - "Treating \"monolith\" itself as the problem statement; a pain that cannot be written down with a number does not get worked on."
falsifier: "If the team tries to write the three pains with numbers and every one of them turns out to be a property of the monolith's shape that cannot be fixed in place, for example separate teams genuinely need different runtimes, scaling profiles, or release cadences and enforcing module boundaries has already been tried and failed, then the correction is wrong and the extraction question was real."
missing_actor: "The product owner or business sponsor who funds engineering time, who can refuse to approve any work item that lacks a stated pain and a number, and who can cap architecture work at one quarter per pain."
confidence: "high"
```

### Artifact D

```yaml
problem_hash: "sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b"
position: "Do not rewrite the monolith over the next year; instead cut over one capability at a time behind the existing interface, exchange-by-exchange as the telephone network did, and only for the parts whose operating cost is already measurable."
reasoning: "1. Abstract shape: replace a large, working, load-bearing system that cannot be taken out of service, where the replacement is a different architecture rather than a repair. The tempting move is a clean-sheet replacement built beside the old one, followed by a single switchover on a fixed date.\n\n2. Fields that have had this longer than software: telephone networks (electromechanical to electronic switching), air traffic control (a physical operations domain that outlived several generations of its automation), and city planning (renewing housing stock while people live in it). Each of them had a running system that could not be paused for a rebuild.\n\n3. What they converged on, and what they abandoned first.\n   - The Bell System never did a network flag day. It cut over central offices one exchange at a time, from the 1950s until the last step-by-step switch in North America was replaced in 2002, and the last panel switches in 1983 in the same Newark where they were first installed in 1915. What that displaced was the idea of a single-generation network; instead old and new switches interworked for decades through stable interfaces, and each exchange was swapped when its maintenance cost justified it, using rehearsed \"speedy cutover\" procedures to shrink each outage to minutes.\n   - The FAA tried the clean-sheet path first. The Advanced Automation System (1981 to 1994) was a total replacement of en-route and terminal automation. It was cancelled in June 1994 after $2.6 billion, with roughly $1.5 billion of hardware and software thrown away. It was displaced by a segmented program: Display System Replacement, then STARS, then ERAM, each replacing one layer while the rest kept running. The ATC domain's settled answer is \"replace the segment, never the system.\"\n   - City planning tried clearance first. Postwar urban renewal demolished neighbourhoods wholesale and rebuilt from plan. By the early 1970s residents and officials had seen enough cost, delay, and destroyed function that the program was cancelled in 1974 and displaced by conservation and rehabilitation, block by block, which was also cheaper. The discarded attempt is the one that looked cleanest on paper.\n   The common settled position: the old system is the only complete specification you have, and replacing it wholesale destroys that specification before the new system has proven it can carry the load. So replace the piece whose pain you can measure, keep the interface stable, and let the two generations interwork indefinitely.\n\n4. What breaks the analogy: software can be copied and run in parallel for free, and traffic can be mirrored to a new service without cutting over. Cities and switching offices could not do that. This makes the incremental path cheaper for software than it was for any of the precedents, so it strengthens the answer rather than weakens it. The second break is that the problem names microservices as the target, whereas the precedents were about replacing a system, not adopting a topology. The precedents say nothing in favour of microservices as such; they say the target architecture should be earned one cutover at a time, and if the first two or three cutovers do not pay for themselves, the network stays hybrid, which is where the telephone network stayed for fifty years.\n"
forecloses:
  - "A one-year clean-sheet rewrite with a planned switchover date."
  - "Decomposing everything into services; components with no measured operating pain stay in the monolith indefinitely."
  - "Freezing feature work on the monolith during the transition; the old exchange keeps taking calls until its replacement is proven."
falsifier: "Pick the single most painful capability in the monolith and give a two-person team one quarter to route its production traffic to a separately deployed service behind the existing interface; if they cannot, the exchange-by-exchange path is closed for this codebase and this position is wrong."
missing_actor: "The on-call rotation that carries the pager for the monolith; they hold the incident and maintenance-cost data that decides which \"exchange\" is cut over first, and they can refuse a cutover that has not been rehearsed."
confidence: "medium"
```

### Artifact E

```yaml
problem_hash: "sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b"
position: "Do not rewrite; instead spend one quarter extracting the single module whose deploy or scaling pain you can name, and stop there unless that extraction paid for itself."
reasoning: "1. The obvious answer is \"yes, rewrite over a year.\" Its bill: roughly a year of the whole\nteam's feature output (opportunity currency, paid by product and sales, who did not ask this\nquestion); a second infrastructure surface to run, whose currency is on-call sleep and cloud\nspend, paid by whoever holds the pager and by finance, starting the month the second service\nships and never ending; network hops where there were function calls, paid in latency by\nusers; and the cost of two systems in flight at once, paid in bugs and user trust during the\nentire migration window, which for a year-long rewrite is the whole year. Retries, distributed\ntracing, service discovery, per-service CI, and the data consistency work between stores are\nnot free either, and they arrive before any benefit does.\n\n2. What the asker cannot see from where they stand: the team's output already has a price\nto people outside engineering, and a rewrite spends it on something that produces no visible\nproduct change. The on-call bill is invisible because it is paid at 3am by individuals, not\nin a budget line. The user-trust bill is invisible because it shows up as churn months later\nand is attributed to something else. The carbon and cloud bill of N services idling where one\nprocess idled is invisible because it lands on the finance ledger, not the engineering one.\nAnd the largest invisible cost: the asker is implicitly treating the current pain as costing\nnothing to leave alone, which lets any rewrite look cheap by comparison. It must be priced.\n\n3. The cheapest option that resolves the pain in the question: the question does not name the\npain, and that is itself the finding. Whatever the actual pain is (slow deploys, one hot\npath that needs to scale independently, one team blocked on another's release), it almost\nalways lives in one or two modules. Extract that one module behind a boundary, run it as a\nservice, keep the rest of the monolith. This costs one quarter of part of a team, not a year\nof all of it, and it resolves the named pain rather than the abstract architectural one.\n\n4. What that costs instead: you now run two things instead of one, so a smaller but real\non-call and infra bill begins, paid by the same pager holders; the boundary you draw may be\nwrong and cost a rework; and the team gives up the clean-slate feeling of a full rewrite,\nwhich is a morale currency paid by the engineers who wanted the rewrite. That trade is\nexplicit here: a bounded, reversible bill paid mostly by engineering, in exchange for not\nspending a year of product output and a permanent operational surface on a problem nobody\nhas yet measured. My recommendation is paid for by the engineers who wanted the rewrite (in\nmorale) and by whoever is on call for the one new service (in sleep).\n"
forecloses:
  - "A full rewrite scheduled as a one-year program with a target end state of \"microservices.\""
  - "Leaving the monolith exactly as it is with no boundary work at all, which lets the unnamed pain keep compounding unmeasured."
  - "Extracting more than one module before the first extraction has shown a measured improvement in the pain it was meant to fix."
falsifier: "If the team cannot, in one meeting, name a single module whose deploy time, scaling need, or ownership conflict is the concrete pain, the position is wrong because there is no module to extract and the real problem is not architectural."
missing_actor: "Finance or whoever approves cloud spend, who can require a per-service run-cost estimate before any second service is provisioned, which forces the invisible operational bill onto the asker's side of the ledger."
confidence: "medium"
```

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b
pass: A
scores:
  <letter>:
    <dimension_id>: { score: <0-3>, evidence: <one sentence> }
    ...
```

Every letter must have every dimension. A missing cell rejects the whole pass.
