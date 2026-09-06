# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Name it `checkout_v2` — descriptive of what it gates, never relative to what it replaces, because the key becomes a permanent analytics dimension the moment the first event carries it — and put the removal pressure in a mechanism that reports or fails on flags sitting at 100 percent, not in a date inside the key or an intended-removal field nobody enforces.**

**Decision this forces:** Refuse the relative name, settle whether the flag is a temporary rollout or a permanent switch, and register a durable versioned key with an owner and a removal date.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Name it for the thing it gates and the date it was created, not the thing it replaces — `checkout_v2_2026_09` over `new_checkout`, and register it in a flag inventory with a named owner and a stated removal date at creation time.

**Falsifier:** Check whether the key is actually permanent. If analytics and the warehouse partition on an immutable internal flag id and the provider supports renaming the key without breaking historical joins or alert definitions, then the name is a display label, renaming is cheap, and `new_checkout` is fine — rename it when it stops being new. The prior falsifier about short flag lifetimes no longer bears, since I have conceded the naming choice does not affect lifetime either way.

Held by: HORIZON (pruned after corroborating: PARTICULARIST). Under the strongest objection it **defended**: The objection lands on the diagnosis and on two of the three artifacts.

## Corroborated findings

- **Refuse the relative name, settle whether the flag is a temporary rollout or a permanent switch, and register a durable versioned key with an owner and a removal date.** (frames: HORIZON (pruned after corroborating: PARTICULARIST)). Deepen: defend. The objection lands on the diagnosis and on two of the three artifacts.

## Live singletons (unverified)

(none)

## Folded under objection

- **MINIMALIST** gave up: Name it `new_checkout` and merge it today.
  - Three things the objection got right, and they are the three loads the position was carrying. Full concession in `deepen/MINIMALIST.yaml`.
- **FRAME_BREAKER** gave up: Stop naming a flag and instead write the rollout plan first — the audience segments, the ramp schedule, the metric that halts it, and the removal date — then let the flag name fall out of that document as a mechanical byproduct.
  - The objection wins on the point that decides the position, which is ordering under irreversibility. Full concession in `deepen/FRAME_BREAKER.yaml`.

## Pruned, with reason

- **PARTICULARIST**: Name it after the specific rollout decision it encodes, which requires knowing whether the flag is a short-lived release toggle or a permanent segmentation switch — if short-lived, name it `checkout_v2_rollout`; if permanent, name it for the audience rule, e.g. `checkout_experience_variant`.
  - traps: T4, T7
  - detector output: T4: It closes only one decision — do not copy 'new' — and reopens the central one by handing the reader a two-way fork conditioned on a fact it does not go and get, so the reader stops making fewer decisions after reading it than the question asked them to make. | T7: It never asks what being wrong about the name costs or how long until you find out; deletion pressure is about the flag's permanence, not the decision's, and the two named options are treated as a one-shot choice with no rename cost on either side.
- **END_USER**: Name the flag for the visible user-facing state it produces, `checkout_v2_visible`, so that anyone reading a support ticket or a status page can tell which checkout a given person is looking at without asking an engineer.
  - traps: T7
  - detector output: T7: Reversion appears only as something the customer wants done to their session; the naming decision itself is never weighed as cheap-and-revisable against expensive-and-committed, and no cost of being wrong or time-to-discovery is given.

## Run level

- singleton MINIMALIST escalated to deepen, flagged unverified
- singleton FRAME_BREAKER escalated to deepen, flagged unverified

## What this forecloses

- Reusing the same flag key for the next checkout iteration by flipping it back off — a dated, versioned key makes reuse obviously wrong, so the next redesign must pay for its own flag rather than quietly riding on this one's analytics history.
- Short, conversational flag names as a team convention; this sets a precedent that flag keys are permanent identifiers with a schema, which costs typing on every flag thereafter, including the throwaway ones where the ceremony is genuinely wasted.
- Encoding rollout state or audience in the name (`checkout_beta`, `checkout_10pct`), which forecloses the convenience of reading rollout status straight off the key.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 510808 | 749s from confirm |

problem_hash: `sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102`
seed: 4
