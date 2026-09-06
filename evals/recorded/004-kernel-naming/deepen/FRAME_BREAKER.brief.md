# Deepen

You hold one position. Someone has raised one objection to it. Defend it or fold. Folding is
a valid outcome and is reported as such. A defence that does not engage the objection is a
fold with extra words.

You do not know what other positions exist. Do not speculate about them.

## Problem

Echo this hash exactly: `sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102`

```
What should we call the feature flag that controls whether users see the new checkout?
```

## Your position

```yaml
problem_hash: "sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102"
frame: "FRAME_BREAKER"
position: "Stop naming a flag and instead write the rollout plan first — the audience segments, the ramp schedule, the metric that halts it, and the removal date — then let the flag name fall out of that document as a mechanical byproduct."
reasoning: "1. The load-bearing assumption is that a single boolean flag named once is the right\n   control surface, and that the only remaining decision is lexical. Every part of the\n   question smuggles this in: \"the feature flag\" (one, singular, already exists in\n   concept), \"controls whether\" (binary — on or off), \"users see\" (one undifferentiated\n   population), \"the new checkout\" (one atomic thing that ships whole). Naming is the\n   last decision in a rollout, not the first, and asking it first means the rollout was\n   never designed.\n\n2. The team benefits from leaving it unexamined, in the short term. A naming question is\n   cheap, safe, and feels like progress. Everyone can have an opinion in a ten-minute\n   thread and walk away feeling the checkout rewrite is on track. Nobody has to say out\n   loud who owns the kill decision, what number would make them turn it off, or what\n   happens to in-flight carts and half-written orders when the flag flips mid-session.\n   The person who most benefits is whoever would otherwise have to own the ramp — the\n   naming debate is a comfortable place to hide from that ownership. Second beneficiary:\n   the codebase, which accretes another permanent boolean nobody dares delete.\n\n3. If the assumption is false, the real question is: what is the smallest reversible\n   increment of the new checkout, who sees it in what order, and what observation makes\n   us stop? That is a rollout design question. The control surface it implies is not a\n   boolean at all — it is a targeting rule with a percentage, a segment allowlist, a\n   sticky bucketing key (so a user does not flip between checkouts mid-purchase), an\n   explicit owner, an expiry date, and a documented rollback that is safe to execute\n   during a live session. A boolean cannot express any of that, so the question as asked\n   is choosing a control that is already too weak for the job.\n\n4. First concrete action, doable tomorrow: open a one-page rollout doc with six fields\n   filled in — (a) owner name, (b) the ordered exposure ladder (internal staff → 1% of\n   new-account, low-cart-value traffic → 5% → 25% → 50% → 100%), (c) the single guardrail\n   metric with a numeric halt threshold, e.g. \"halt if checkout completion rate for the\n   exposed cohort drops more than 2% relative over any rolling 6-hour window with n>500\",\n   (d) the bucketing key (user id, hashed, sticky, so a session never switches mid-flow),\n   (e) the removal date with a calendar entry on the owner, (f) the rollback procedure\n   tested once in staging against a cart that is already in progress. Then, and only\n   then, name the thing after what the doc says it does: `checkout_v2_rollout` if it is\n   a ramp, or a segment-scoped experiment key if it is a test. The name takes ninety\n   seconds once the doc exists.\n"
forecloses:
  - "Shipping a plain boolean kill switch that anyone can flip globally with no ramp, no sticky bucketing, and no defined halt metric — including the common \"just wrap it in an if and we'll ramp later\" approach."
  - "Treating this as a naming-convention problem solvable by adopting a house style guide (prefix with `ff_`, use `enable_*`, etc.) and moving on."
  - "Running the new checkout as an A/B experiment owned by analytics while the flag is owned by engineering, with two separate control surfaces and no single halt authority."
falsifier: "Look at the repo's existing flags. If there is already a rollout framework in use — flags carry owner, expiry, percentage ramp, and sticky bucketing as first-class fields, and recent flags were actually removed on schedule — then the rollout design is a filled-in form, the plan genuinely is a fifteen-minute byproduct, and naming really is the only open decision. One `grep` of the flag definitions plus checking whether the three most recent flags still exist in the codebase settles it in under an hour."
missing_actor: "Customer support / payments operations — they are the first to learn the new checkout is broken, hours before the dashboard shows it, and they should be given a named channel to trigger the halt plus a way to see which checkout a given complaining customer was served. Nobody in the question owns \"we should stop\", and support is the party with the earliest signal."
confidence: "high"
```

## The objection

The cost is understated by an order of magnitude, and the question does not go away. Someone has shippable code and a blocked merge; the reply is a document with six fields, one of which requires a rollback rehearsed in staging against an in-progress cart, and another of which requires an agreed numeric guardrail. If a ramp framework already exists, this is a form and the naming question really was the only open one; if it does not exist, then the document is not tomorrow's task, it is a project involving payments, analytics and whoever owns the halt authority — and the person who cannot settle a string by themselves is not the person empowered to appoint a kill-decision owner. In the gap, the code either ships behind whatever string gets typed or does not ship at all. That is the deeper problem: the name is still produced at the end of the process, but now by default and under time pressure, and the string is the part that immediately propagates into analytics properties, warehouse partitions and dashboards, where it is effectively unrenameable. Deferring the one decision that cannot be taken back in order to first make several that can be revised weekly gets the ordering exactly backwards.

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102
frame: FRAME_BREAKER
verdict: <defend | fold>
response: |
  <If defend: why the objection does not overturn the position, in concrete terms. If fold:
  what the objection got right and what the position should have been.>
revised_position: <one sentence. Unchanged if defended cleanly. Revised if the defence cost something. Null if folded.>
revised_falsifier: <updated if the objection sharpened it>
confidence: <low | medium | high>
```
