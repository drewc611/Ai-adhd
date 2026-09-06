```yaml
problem_hash: sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102
pass: A
scores:
  A:
    committal: { score: 1, evidence: "The position forks into two named options conditional on a fact the reader must supply, handing the decision back." }
    foreclosure: { score: 3, evidence: "It rules out the single most tempting move (copying the word 'new' into the key, with three concrete spellings) and the comfortable dodge of a name that works for both lifespans, with a reason each is unavailable." }
    falsifiability: { score: 3, evidence: "Asking the cleanup-ticket owner for a delete date is a one-question observation that kills one of the two named branches outright." }
    specificity: { score: 2, evidence: "The reasoning bends around this statement's own words — 'new' as a calendar fact and 'whether users see' implying per-user evaluation — but the same argument would survive for any flag named after a recent thing." }
    assumption_attack: { score: 3, evidence: "It identifies the flag's lifespan as the unstated variable the question hides and makes the recommended name follow directly from its value." }
    reasoning_carries: { score: 3, evidence: "No authorities, conventions, or citations appear anywhere; the argument runs on its own chain about identifier decay." }
    actor_coverage: { score: 2, evidence: "The support or on-call engineer reading the flag beside a user id is named with a real reading task, but 'misdiagnose' is a failure rather than an action they take, and the position only partly rests on them." }
    reversibility: { score: 1, evidence: "Deletion pressure and the name's spread into analytics and tickets are mentioned, but nothing is ordered by what is cheap to undo versus committed." }
    substance: { score: 2, evidence: "Flattened to 'decide if the flag is temporary or permanent and name it accordingly, never 'new'', it is still worth saying, though the conditional framing carries some of the appeal." }
  B:
    committal: { score: 3, evidence: "One sentence with an actionable verb — write the rollout plan first and let the name fall out — and no escape hatch." }
    foreclosure: { score: 3, evidence: "It rules out the plain global boolean including the exact phrasing people use for it, the house-style-guide answer, and the split analytics/engineering ownership pattern." }
    falsifiability: { score: 3, evidence: "One grep of existing flag definitions plus checking whether the three most recent flags were actually deleted settles it in under an hour and would concede the whole position." }
    specificity: { score: 2, evidence: "The core 'design the ramp before naming' argument transfers to any flag, but in-flight carts, mid-session flips, and checkout completion rate as the halt metric are genuinely bent to this problem." }
    assumption_attack: { score: 3, evidence: "It names the smuggled assumption — one boolean, one population, one atomic thing — and the entire recommendation follows from rejecting it." }
    reasoning_carries: { score: 3, evidence: "Nothing is borrowed from authority; the case is built from what a boolean cannot express." }
    actor_coverage: { score: 3, evidence: "Support and payments ops get a named channel to trigger the halt, and the position's halt-authority requirement depends on that party having the earliest signal." }
    reversibility: { score: 3, evidence: "The position is an ordered sequence built on reversibility — smallest reversible increment, exposure ladder, sticky bucketing, tested rollback — rather than a single move." }
    substance: { score: 2, evidence: "Flattened to 'plan the rollout before naming the flag, a boolean is too weak', it holds, but the 'you asked the wrong question' angle does noticeable work." }
  C:
    committal: { score: 3, evidence: "One sentence naming a literal key, `checkout_v2_visible`, with no conditional and no hedge." }
    foreclosure: { score: 3, evidence: "Three concrete families are ruled out with example strings — project/experiment ids, recency names, and rollout-mechanism names — each with the specific failure it causes." }
    falsifiability: { score: 2, evidence: "The ten-ticket agent test is observable and would kill the position, but staging it costs real agent time, though the cheaper half — checking whether agents already resolve state by session replay — softens that." }
    specificity: { score: 3, evidence: "The reasoning runs on the card form moving, the failed payment attempt, the abandoned cart, and the mid-purchase reversion request, and is unusable for a flag over anything but a user-facing purchase flow." }
    assumption_attack: { score: 1, evidence: "It implies the question wrongly assumes the name has only an engineering audience but never states that as an assumption or tests it." }
    reasoning_carries: { score: 3, evidence: "No citations or authorities are used; the chain runs from what one person can see and say." }
    actor_coverage: { score: 3, evidence: "The frontline support agent is named with a specific action — read the flag aloud and request a reversion — and the entire naming criterion is derived from that seat." }
    reversibility: { score: 1, evidence: "Reversion for the user is mentioned as the thing to ask for, but no distinction is drawn between cheap and committed moves for the naming decision itself." }
    substance: { score: 2, evidence: "Flattened to 'name it so support can tell which checkout a customer saw', it is still worth saying, but the first-person monologue supplies much of the force." }
  D:
    committal: { score: 3, evidence: "One sentence, a literal key contrasted against the tempting alternative, plus the registry entry, with no hedge." }
    foreclosure: { score: 3, evidence: "It rules out reusing the key for the next iteration, short conversational names as team convention, and encoding rollout state in the key, naming what each costs." }
    falsifiability: { score: 3, evidence: "Reading the flag provider's list for median flag lifetime and long-lived permanently-on flags is cheap and the artifact concedes `new_checkout` wins if the numbers come back short." }
    specificity: { score: 1, evidence: "Only the expiry of the word 'new' is load bearing, and the artifact says outright that the general failure is all the prediction it needs, so the argument transfers to any relatively named flag." }
    assumption_attack: { score: 3, evidence: "It attacks the assumption that a flag key is a cheap string, showing the name is pinned by warehouse tables and dashboards, and the recommendation follows from that being true." }
    reasoning_carries: { score: 3, evidence: "No authorities are invoked; the argument rests on where the string ends up and who cannot move it." }
    actor_coverage: { score: 3, evidence: "The analytics team is named with the power to enforce or veto the key schema at ingestion, and the position's claim that the name is unrenameable depends on their consumption of it." }
    reversibility: { score: 3, evidence: "The position is structured on what is unrenameable later versus cheap to change, and separates decide-now items from deliberately deferred ones on exactly that axis." }
    substance: { score: 3, evidence: "Flattened to 'flag keys become permanent identifiers in analytics, so pick a descriptive dated key with an owner and expiry date', it is the same claim and still worth saying." }
  E:
    committal: { score: 3, evidence: "Eight words, one imperative, a literal name and a deadline, with nothing returned to the reader." }
    foreclosure: { score: 3, evidence: "It forecloses adopting any naming convention as a precondition, encoding rollout semantics for tooling, and keeping the flag as a durable switch, accepting each cost by name." }
    falsifiability: { score: 3, evidence: "One minute of grepping the flag call sites for an existing prefix or ticket-id convention would make the recommended name the odd one out and kill the position." }
    specificity: { score: 1, evidence: "Only the literal phrase 'the new checkout' is load bearing as the source of the name; the argument about cheap-to-reverse decisions would run identically for any flag question." }
    assumption_attack: { score: 2, evidence: "It reframes the question as a request for permission to stop deliberating and tests it against rename cost, but that cost is asserted as a coffee rather than examined." }
    reasoning_carries: { score: 3, evidence: "No conventions, sources, or authorities are leaned on; the case is made from the cost of deliberation versus the cost of being wrong." }
    actor_coverage: { score: 2, evidence: "The person who deletes the flag is named with a concrete action — open the cleanup ticket in the same PR — but the position stands even if nobody does it." }
    reversibility: { score: 3, evidence: "The position is a sequence built on reversibility — ship the cheap-to-rename string now, adopt a convention only when collision appears — with the aging name used as the timer." }
    substance: { score: 3, evidence: "Flattened to 'use the obvious literal name, ship, and delete it later, because renaming is trivial', it is the same claim and a real, contested position." }
```