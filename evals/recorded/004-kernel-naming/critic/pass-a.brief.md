# Critic, pass A (blind)

You are scoring reasoning artifacts. You do not know how they were produced or under what
instruction. Each is labelled with a letter. Score each independently against the rubric.

You are not scoring quality. Fluent, thorough, balanced answers are what a competent person
produces in thirty seconds, and that is the failure this system exists to catch. Score only
the dimensions below. Do not score fluency, thoroughness, balance, completeness, tone,
length, or how much you agree.

## Problem

Echo this hash exactly: `sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102`

```
What should we call the feature flag that controls whether users see the new checkout?
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
problem_hash: "sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102"
position: "Name it after the specific rollout decision it encodes, which requires knowing whether the flag is a short-lived release toggle or a permanent segmentation switch — if short-lived, name it `checkout_v2_rollout`; if permanent, name it for the audience rule, e.g. `checkout_experience_variant`."
reasoning: "1. The three most specific details actually present: (a) the flag \"controls whether\n   users see\" something — it gates a user-visible surface, not a backend path;\n   (b) the thing gated is \"the new checkout\" — an existing named surface being\n   replaced, so there is a prior checkout still live behind the flag; (c) the word\n   \"new\" is doing all the work, and \"new\" is a fact about the calendar, not about\n   the code. Nothing in the statement says who flips it, how long it lives, or\n   what the two variants are called in the product.\n\n2. The detail that changes the answer is the one whose value is missing: the flag's\n   lifespan. It is not a tiebreaker, it flips the answer outright. If this flag\n   exists to ship a replacement and then be deleted, the name should carry the\n   transition and be embarrassing to leave in the codebase — `checkout_v2_rollout`\n   — because the embarrassment is the deletion pressure, and \"v2\" ages into a\n   stable identifier for the version that shipped even after \"new\" stops meaning\n   anything. If instead this flag is going to live for years because some segment\n   keeps the old checkout permanently (a market, a payment method, a contract),\n   then it is not a rollout flag at all, it is a product configuration, and it\n   must be named for the rule it encodes rather than the event that introduced it.\n\n3. The thirty-second answer here is `new_checkout_enabled`, and this specific\n   problem statement is what makes it wrong: the statement itself says \"the new\n   checkout\", which is a phrase with a shelf life. The moment the flag is fully\n   rolled out, the new checkout becomes the checkout, and the flag reads\n   `new_checkout_enabled: true` forever while nobody can tell which checkout is\n   \"new\" any more. The problem hands you the word \"new\" and the trap is copying it\n   into an identifier. The second specific reason it is wrong: \"whether users see\"\n   implies a per-user evaluation, so the name will appear in analytics, support\n   tickets, and incident timelines beside a user id — a name that cannot be read\n   six months later by someone who was not present for the launch fails there\n   first.\n"
forecloses:
  - "Copying the word \"new\" into the identifier at all (`new_checkout`, `checkout_new`, `enable_new_checkout`), because the statement's own phrasing is the thing that expires."
  - "Deferring the lifespan question and picking a name that works for both cases — there is no such name; a rollout name creates deletion pressure and a config name resists it, and you cannot have both properties in one identifier."
falsifier: "Ask whoever files the flag-cleanup ticket for a delete date. If a date exists in a ticket or a flag-expiry field, the permanent-segmentation branch is dead and only `checkout_v2_rollout` is defensible; if no one can name a date and someone names a segment that keeps the old checkout, the rollout name is wrong."
missing_actor: "The support or on-call engineer reading this flag's value next to a user id in a ticket or incident timeline months from now — they can escalate or misdiagnose a checkout failure based on whether the name tells them which checkout the user saw, and the problem statement names only \"users\" and the implied author."
confidence: "medium"
```

### Artifact B

```yaml
problem_hash: "sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102"
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

### Artifact C

```yaml
problem_hash: "sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102"
position: "Name the flag for the visible user-facing state it produces, `checkout_v2_visible`, so that anyone reading a support ticket or a status page can tell which checkout a given person is looking at without asking an engineer."
reasoning: "1. What was I trying to accomplish? I was trying to buy something. That is\n   the entire scope of my interest. Checkout became my problem the moment it\n   stopped behaving like the one I had used before: a field moved, the card\n   form looked different, the total appeared somewhere else, or the button I\n   expected was not there. I did not opt into a new checkout. I was placed in\n   one, silently, by a name I will never see.\n\n2. What can I see and do at the moment it matters? I can see a checkout\n   screen. I cannot see which checkout it is. I can press back, press pay\n   again, refresh, or open a chat with support. When I reach support, the only\n   thing I can tell them is what I saw. The agent's job is to translate \"the\n   card box was at the bottom\" into \"this person is on the new one.\" Every\n   name choice either helps or blocks that translation. A name like\n   `new_checkout`, `checkout_redesign`, or `exp_4417` blocks it: \"new\"\n   goes stale in a month, \"redesign\" describes an internal project I have\n   never heard of, and a ticket number means nothing to the agent reading my\n   screenshot. A name that says what I would see — the v2 checkout is visible\n   to me — is the one that survives the trip from my screen to the agent's\n   console to the fix.\n\n3. What makes me give up? Two turns of confusion with no acknowledgement. If\n   the checkout looks unfamiliar and my first payment attempt fails or stalls,\n   I abandon the cart and go somewhere else, or I go back and buy nothing.\n   When I give up, the system records it as a conversion loss with no cause\n   attached, and nobody can tell later whether the new checkout caused it,\n   because nothing in the flag name ties the state I saw to the row in the\n   funnel. A flag named after the visible state is also the flag you can put\n   in the analytics event and the support console, so my abandonment is\n   attributable instead of anonymous.\n\n4. The one thing I would ask for if I knew it was possible: \"put me back on\n   the checkout I used last time, right now, and let me finish paying.\"\n   That is a reversion, and reversion is only possible if a human on the\n   support side can name my state out loud in under five seconds. A flag whose\n   name is a guess about internals cannot be spoken over a phone call. A flag\n   named for what I see can be.\n"
forecloses:
  - "Naming by internal project, sprint, or experiment id (`exp_4417`, `proj_atlas`, `checkout_redesign`) — these cannot be matched to anything a user reports seeing, so support cannot resolve my state from my description."
  - "Naming by recency (`new_checkout`, `checkout_v2_beta`, `use_new_flow`) — \"new\" is a fact about the calendar, not about the screen, and stops being true the moment a third checkout exists, at which point the ticket triage that depended on it silently starts lying."
  - "Naming by rollout mechanism (`checkout_rollout_pct`, `checkout_ramp`) — a percentage or ramp name describes the deployment lever, not the state any one person is in, so it cannot answer \"which one am I looking at.\""
falsifier: "Take ten real checkout support tickets and hand a support agent nothing but the customer's own description plus the flag name; if the agent cannot reliably decide which checkout the customer saw, or if agents are already resolving these tickets by pasting a session id into a tool that shows them the rendered screen directly, then the flag name is doing no work at the support seat and this position is wrong."
missing_actor: "The frontline support agent — they receive the abandoned-cart complaint before any engineer does, and they are the party who must read the flag, say it aloud, and either explain the difference or request a reversion; they were not named in the problem and are the only actor positioned to convert a confused user into a completed purchase."
confidence: "medium"
```

### Artifact D

```yaml
problem_hash: "sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102"
position: "Name it for the thing it gates and the date it was created, not the thing it replaces — `checkout_v2_2026_09` over `new_checkout`, and register it in a flag inventory with a named owner and a stated removal date at creation time."
reasoning: "1. What changed in two years that the original decision did not anticipate.\n   The word \"new\" expired. Whatever shipped behind this flag is now the only\n   checkout anyone remembers, and there has since been another checkout after\n   it. I am looking at a flag called `new_checkout` and a flag called\n   `new_checkout_v2` and a flag called `checkout_redesign`, and I cannot tell\n   from any of them which one is live, which one is dead, or which one guards\n   the thing I am about to change. The specific kind of change that broke the\n   name was not \"the checkout changed\" — it was \"the thing being replaced got\n   replaced again,\" which is the ordinary case, not a surprise. Relative names\n   die because the reference point moves. That is the general failure, and it\n   is the only prediction I need.\n2. Which parts are now load bearing.\n   The string itself. Two years on, the flag name is not in one file; it is in\n   the flag provider's dashboard, in analytics event properties, in the data\n   warehouse tables that partition experiment results by flag key, in old\n   incident writeups, in a Slack channel name, and in at least one alert that\n   fires on a metric sliced by that key. Renaming it means either a coordinated\n   dual-write across all of that or accepting a discontinuity in two years of\n   historical data. The name is effectively permanent from the moment the first\n   analytics event carries it. What is *not* load bearing is the flag's\n   evaluation logic — that is a handful of call sites and cheap to change. The\n   irony is that the part everyone treated as a naming triviality is the part\n   that cannot be moved, and the part everyone reviewed carefully is the part\n   that can.\n3. What the maintainer would pay to have had a different choice.\n   I would pay a full engineer-week today, gladly, to have had a flag name that\n   told me what it gates and when it was born, plus a registry row saying who\n   owns it and when it was supposed to die. What I actually have is an\n   archaeology problem: I must read the code to learn what the flag does, ask\n   three people to learn who owns it, and then discover nobody will let me\n   delete it because nobody can prove it is unused. So the flag stays,\n   permanently at 100 percent, a dead branch in the checkout path that every\n   future change has to be tested against. That is the real cost — not\n   confusion, but permanent extra surface area in the highest-stakes code path\n   in the product.\n4. What to decide now and what to leave undecided.\n   Decide now, because it is unrenameable later: the literal key string, that\n   it is descriptive rather than relative, that it carries a creation date, and\n   that a registry entry with an owner and an expected removal date is created\n   in the same commit that creates the flag. Leave deliberately undecided: what\n   the next checkout will be called, whether this flag becomes a permanent\n   config switch or gets deleted, and whether the rollout is a percentage\n   ramp, a cohort targeting rule, or a kill switch — the name should not\n   encode the rollout strategy, because the strategy changes and the key\n   cannot.\n   The cost today is real and I will not pretend otherwise: `checkout_v2_2026_09`\n   is uglier than `new_checkout`, longer to type, and someone in review will\n   say the date is redundant with git history. It is not redundant, because git\n   history is not visible from the flag provider's dashboard, which is where I\n   will be standing at 2am. That ugliness is the entire price, and it is\n   cheaper than the alternative by roughly an engineer-week per confused\n   maintainer.\n"
forecloses:
  - "Reusing the same flag key for the next checkout iteration by flipping it back off — a dated, versioned key makes reuse obviously wrong, so the next redesign must pay for its own flag rather than quietly riding on this one's analytics history."
  - "Short, conversational flag names as a team convention; this sets a precedent that flag keys are permanent identifiers with a schema, which costs typing on every flag thereafter, including the throwaway ones where the ceremony is genuinely wasted."
  - "Encoding rollout state or audience in the name (`checkout_beta`, `checkout_10pct`), which forecloses the convenience of reading rollout status straight off the key."
falsifier: "Look at the flag provider's current flag list. If flags in this codebase are routinely deleted within one release cycle of reaching 100 percent — median flag lifetime under about six weeks, with few or no permanently-on flags older than a year — then no flag lives long enough for its name to outlive its referent, the archaeology problem never occurs, and the naming ceremony is pure cost. `new_checkout` is then the correct answer."
missing_actor: "The data/analytics team, who consume the flag key as a dimension in warehouse tables and dashboards and are the ones actually blocked by a rename; they can enforce or veto a flag-key naming schema at the ingestion layer, making the convention mechanical rather than a code-review habit that erodes."
confidence: "medium"
```

### Artifact E

```yaml
problem_hash: "sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102"
position: "Name it `new_checkout` and merge it today."
reasoning: "1. The pain: someone has code ready to ship behind a flag and cannot type the\n   string without worrying they will be told later it was the wrong string.\n   The question is not really about naming. It is a request for permission to\n   stop thinking about naming. Nobody asks this when they already feel free to\n   pick one.\n\n2. The smallest intervention that removes that pain: pick the obvious literal\n   words in the question itself and commit. The question says \"the new\n   checkout.\" So the flag is `new_checkout`. Whoever reads that line in six\n   weeks knows exactly what it gates. That is the entire job of the name. The\n   asker can now go back to the actual work, which is the checkout, not the\n   flag.\n\n3. What this deliberately leaves unfixed: there is no prefix, no namespace, no\n   team owner encoded, no expiry date in the name, no indication of whether it\n   is a release toggle or an experiment, and no convention that the next flag\n   will follow. The word \"new\" also ages badly — in a year it will read as\n   nonsense, when the new checkout is the only checkout. All of that is real\n   and none of it hurts today. A flag name is a string in a call site; it is\n   renamed with find-and-replace and a config edit, and the cost of that\n   rename is roughly a coffee. Cheap-to-reverse decisions do not deserve\n   deliberation, and deliberating over them is more expensive than being\n   wrong.\n\n4. When the larger fix becomes necessary, and how you would know: the signal is\n   collision, not volume. When someone has to open the flag dashboard and read\n   descriptions to tell two flags apart, or when a flag is deleted from the\n   dashboard and a stale call site takes down a service, naming has become a\n   coordination problem and a convention earns its keep. Until someone is\n   actually confused by a name, a convention is overhead paid in advance\n   against a confusion that has not happened. Also: `new_checkout` should be\n   deleted, not renamed, once the rollout finishes. The name aging badly is a\n   timer, and letting it run is the honest way to notice the flag outlived its\n   purpose.\n"
forecloses:
  - "Adopting a flag naming convention (prefixes, owner tags, expiry dates, type markers) as a precondition for shipping this one flag."
  - "Encoding rollout semantics in the name — no `exp_`/`release_` distinction, so the name will not tell tooling or a reader what kind of flag this is."
  - "Keeping the flag permanently as a durable checkout-version switch; the name is deliberately built to rot so the flag gets deleted."
falsifier: "A flag list already exists and shows a convention in active use — every current flag carries the same prefix, owner tag, or ticket id. Look at the flag dashboard or grep the flag call sites; one minute of looking. If a convention is already there, matching it is smaller than not matching it, and `new_checkout` is the odd one out that costs someone a double-take."
missing_actor: "The person who deletes the flag after rollout — usually nobody is assigned. Whoever merges this can open the cleanup ticket in the same PR, so the name's expiry has an owner rather than depending on someone noticing later."
confidence: "high"
```

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102
pass: A
scores:
  <letter>:
    <dimension_id>: { score: <0-3>, evidence: <one sentence> }
    ...
```

Every letter must have every dimension. A missing cell rejects the whole pass.
