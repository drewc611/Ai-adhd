# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Before naming it, find out whether this flag is a temporary rollout switch or a permanent toggle: if temporary, name it for deletion by tying it to the rollout ticket and require an automated or periodic check that flags the name once that ticket has been closed for more than a set period so drift to de facto permanence gets caught rather than assumed away; if permanent, name it after the actual checkout capability being shipped, never using "new" at all.**

**Decision this forces:** Withhold the actual name until the flag's temporary-vs-permanent or owner/rollback/removal status is established, and let that status determine or accompany the name.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Before naming it, find out whether this flag is a temporary rollout switch or a permanent toggle: if temporary, name it for deletion (tie it to the rollout ticket, never the word "new"); if permanent, name it after the actual checkout capability being shipped, never using "new" at all.

**Falsifier:** Search this codebase's flag store for flags named after rollout tickets that closed more than a year ago -- if none of them were ever flagged, audited, or renamed despite the ticket being closed and discoverable, the ticket-based name gave no practical advantage over "new_checkout" and the enforcement mechanism this revision adds is the thing actually needed, not the ticket-naming convention itself.

Held by: PARTICULARIST (pruned after corroborating: FRAME_BREAKER). Under the strongest objection it **defended**: The objection is right that a one-time classification is fragile under inertia, but it attacks a version of the position that relies on someone remembering to act -- that was never the load-bearing part.

## Corroborated findings

- **Withhold the actual name until the flag's temporary-vs-permanent or owner/rollback/removal status is established, and let that status determine or accompany the name.** (frames: PARTICULARIST (pruned after corroborating: FRAME_BREAKER)). Deepen: defend. The objection is right that a one-time classification is fragile under inertia, but it attacks a version of the position that relies on someone remembering to act -- that was never the load-bearing part.

## Live singletons (unverified)

(none)

## Folded under objection

- **SUCCESSOR** gave up: Rename the flag now from a temporal label like `new_checkout` to a versioned, capability-based key such as `checkout_flow_v2`, and pay the migration cost across every downstream consumer today rather than later.
  - The objection is correct and it lands on the load-bearing part of the position, not a peripheral detail. Full concession in `deepen/SUCCESSOR.yaml`.

## Pruned, with reason

- **MINIMALIST**: Name it literally what it does, right now, with no scheme: something like checkout_new, and stop there.
  - traps: T1, T2, T6, T7
  - detector output: T1: The 'don't over-design, just pick a plain string' argument is a generic YAGNI point that would survive deleting 'feature flag', 'new checkout', and 'controls whether users see' entirely unchanged. | T2: It never questions whether the flag's name will still mean 'new' after rollout or whether naming is even the right decision; it accepts the question's frame and only minimizes the effort inside it. | T6: The named actor (whoever eventually deletes the flag) is given no concrete action now beyond a hope that the chosen name will 'make it obvious' later, which is not an action they can take. | T7: Nothing weighs the cost of a bad literal name against how long it would take to notice, despite the whole argument resting on this being a low-stakes, reversible choice.
- **SUPPLICANT**: Do not spend this decision on an internal name; instead make whatever the flag controls show up as a visible, reportable checkout-version marker on the error screen or receipt the user actually sees.
  - traps: T7
  - detector output: T7: Nothing addresses the cost of building and maintaining a user/support-facing version marker if it turns out unnecessary, nor how long it would take to learn that.
- **FRAME_BREAKER**: Before anyone names the flag, write and attach a one-page lifecycle record to it — owner, rollout stages, rollback trigger metric, and a hard removal date — because naming is not the decision that matters here.
  - traps: T1, T7
  - detector output: T1: The 'naming is not the decision, governance is' argument is generic enough to be made about almost any flag-naming question and does not depend on this being checkout or 'new' specifically. | T7: It never weighs the cost of being wrong about skipping governance against the cost of the real sprint-time commitment it proposes, nor how long either failure would take to surface.

## Run level

- singleton SUCCESSOR escalated to deepen, flagged unverified

## What this forecloses

- Naming the flag "new_checkout" (or any variant using "new") as its permanent, lasting name without first confirming it will be deleted on a known schedule.
- Picking a name before checking whether this flag is meant to be short-lived or long-lived.
- Answering with a generic team-wide naming convention without checking what naming scheme this codebase's flag system already enforces.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 5 | 133007 | ~266s of reported subagent runtime (sum of phase durations; driven by hand via `adhd run --phase`, so there is no kernel-tracked calendar time) |

problem_hash: `sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102`
seed: 4
