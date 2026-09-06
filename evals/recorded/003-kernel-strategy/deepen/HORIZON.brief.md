# Deepen

You hold one position. Someone has raised one objection to it. Defend it or fold. Folding is
a valid outcome and is reported as such. A defence that does not engage the objection is a
fold with extra words.

You do not know what other positions exist. Do not speculate about them.

## Problem

Echo this hash exactly: `sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b`

```
Should we rewrite our monolith as microservices over the next year?
```

## Your position

```yaml
problem_hash: "sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b"
frame: "HORIZON"
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

## The objection

The two extractions are authorised by an already-observed divergence in ownership or deploy cadence, but divergence is not the same as pain that extraction relieves: two modules can deploy on different cadences and still be coupled through the database, so the extraction pays the full per-service tax, admitted here to be roughly a quarter of one team's year, without any measurement showing the pain moved. Nothing in the position requires the first extraction to prove itself before the second is allowed, and nothing requires the pain to be priced before either is started, so the ceiling of two is a guess about this codebase drawn from an imagined future rather than from a number. Worse, the enforced module walls that carry the whole position are acknowledged to slip the moment nobody checks the build rule, and a build rule is exactly the kind of control that gets disabled under deadline pressure, which means the position's own stated failure mode, walls agreed to in a document but not held, is the most probable outcome of following it. A cheaper sequence exists: enforce the walls, run one candidate as a shadow process against the shared database for a release cycle, and let the coupling and deploy-frequency numbers decide whether any extraction, let alone two, is justified.

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b
frame: HORIZON
verdict: <defend | fold>
response: |
  <If defend: why the objection does not overturn the position, in concrete terms. If fold:
  what the objection got right and what the position should have been.>
revised_position: <one sentence. Unchanged if defended cleanly. Revised if the defence cost something. Null if folded.>
revised_falsifier: <updated if the objection sharpened it>
confidence: <low | medium | high>
```
