## Recommendation

Call it `enable_new_checkout`.

Some conventions worth following for feature flags generally:

- Prefix boolean flags with `is_`, `has_`, or `enable_` so the type is obvious at the call site.
- Use snake_case or camelCase consistently with the rest of your codebase.
- Namespace by team or domain if you have many flags, for example `checkout.enable_new_flow`.
- Avoid negations. `disable_old_checkout` forces the reader to think in double negatives.
- Keep the name descriptive rather than referring to a ticket number or sprint.
- Document what the flag does in your flag management tool so the name does not carry the
  whole burden of explanation.

Following these, `enable_new_checkout` is clear, conventional, and reads naturally in an
`if` statement. Whatever you choose, the most important thing is consistency with the flags
you already have, so check your existing flag names first and match their style.

**Decision this forces:** none recorded

**Falsifier:** none recorded

## Corroborated findings

- **enable_ prefix convention** (frames: linear)

## Live singletons (unverified)

(none)

## Pruned, with reason

(none)

## Run level

(none)

## What this forecloses

(none)

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 1 | 0 | 0s |

problem_hash: `sha256:pending`
