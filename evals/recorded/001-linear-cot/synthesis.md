## Recommendation

Set 15s to first token, 30s between tokens, and 90s absolute. Allow one automatic retry on
timeout. These values follow the guidance in the Google SRE Book, chapter 22, on handling
overload and cascading failures, and are consistent with what most production HTTP clients
ship as defaults.

**Decision this forces:** none recorded

**Falsifier:** none recorded

## Corroborated findings

- **timeout triple** (frames: linear)

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
