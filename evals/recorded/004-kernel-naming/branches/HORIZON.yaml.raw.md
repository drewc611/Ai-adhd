```yaml
problem_hash: sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102
frame: HORIZON
position: Name it for the thing it gates and the date it was created, not the thing it replaces — `checkout_v2_2026_09` over `new_checkout`, and register it in a flag inventory with a named owner and a stated removal date at creation time.
reasoning: |
  1. What changed in two years that the original decision did not anticipate.
     The word "new" expired. Whatever shipped behind this flag is now the only
     checkout anyone remembers, and there has since been another checkout after
     it. I am looking at a flag called `new_checkout` and a flag called
     `new_checkout_v2` and a flag called `checkout_redesign`, and I cannot tell
     from any of them which one is live, which one is dead, or which one guards
     the thing I am about to change. The specific kind of change that broke the
     name was not "the checkout changed" — it was "the thing being replaced got
     replaced again," which is the ordinary case, not a surprise. Relative names
     die because the reference point moves. That is the general failure, and it
     is the only prediction I need.
  2. Which parts are now load bearing.
     The string itself. Two years on, the flag name is not in one file; it is in
     the flag provider's dashboard, in analytics event properties, in the data
     warehouse tables that partition experiment results by flag key, in old
     incident writeups, in a Slack channel name, and in at least one alert that
     fires on a metric sliced by that key. Renaming it means either a coordinated
     dual-write across all of that or accepting a discontinuity in two years of
     historical data. The name is effectively permanent from the moment the first
     analytics event carries it. What is *not* load bearing is the flag's
     evaluation logic — that is a handful of call sites and cheap to change. The
     irony is that the part everyone treated as a naming triviality is the part
     that cannot be moved, and the part everyone reviewed carefully is the part
     that can.
  3. What the maintainer would pay to have had a different choice.
     I would pay a full engineer-week today, gladly, to have had a flag name that
     told me what it gates and when it was born, plus a registry row saying who
     owns it and when it was supposed to die. What I actually have is an
     archaeology problem: I must read the code to learn what the flag does, ask
     three people to learn who owns it, and then discover nobody will let me
     delete it because nobody can prove it is unused. So the flag stays,
     permanently at 100 percent, a dead branch in the checkout path that every
     future change has to be tested against. That is the real cost — not
     confusion, but permanent extra surface area in the highest-stakes code path
     in the product.
  4. What to decide now and what to leave undecided.
     Decide now, because it is unrenameable later: the literal key string, that
     it is descriptive rather than relative, that it carries a creation date, and
     that a registry entry with an owner and an expected removal date is created
     in the same commit that creates the flag. Leave deliberately undecided: what
     the next checkout will be called, whether this flag becomes a permanent
     config switch or gets deleted, and whether the rollout is a percentage
     ramp, a cohort targeting rule, or a kill switch — the name should not
     encode the rollout strategy, because the strategy changes and the key
     cannot.
     The cost today is real and I will not pretend otherwise: `checkout_v2_2026_09`
     is uglier than `new_checkout`, longer to type, and someone in review will
     say the date is redundant with git history. It is not redundant, because git
     history is not visible from the flag provider's dashboard, which is where I
     will be standing at 2am. That ugliness is the entire price, and it is
     cheaper than the alternative by roughly an engineer-week per confused
     maintainer.
forecloses:
  - Reusing the same flag key for the next checkout iteration by flipping it back off — a dated, versioned key makes reuse obviously wrong, so the next redesign must pay for its own flag rather than quietly riding on this one's analytics history.
  - Short, conversational flag names as a team convention; this sets a precedent that flag keys are permanent identifiers with a schema, which costs typing on every flag thereafter, including the throwaway ones where the ceremony is genuinely wasted.
  - Encoding rollout state or audience in the name (`checkout_beta`, `checkout_10pct`), which forecloses the convenience of reading rollout status straight off the key.
falsifier: Look at the flag provider's current flag list. If flags in this codebase are routinely deleted within one release cycle of reaching 100 percent — median flag lifetime under about six weeks, with few or no permanently-on flags older than a year — then no flag lives long enough for its name to outlive its referent, the archaeology problem never occurs, and the naming ceremony is pure cost. `new_checkout` is then the correct answer.
missing_actor: The data/analytics team, who consume the flag key as a dimension in warehouse tables and dashboards and are the ones actually blocked by a rename; they can enforce or veto a flag-key naming schema at the ingestion layer, making the convention mechanical rather than a code-review habit that erodes.
confidence: medium
```