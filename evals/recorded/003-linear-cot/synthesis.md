## Recommendation

It depends on your team size, your scaling needs, and how mature your operational tooling is.

**Arguments for the rewrite:** independent deployability means teams stop blocking each other
on releases. Services can be scaled independently, so the one hot path does not force you to
scale everything. Teams gain autonomy over their own stack and release cadence. Failure can be
isolated to a service rather than taking down the whole application.

**Arguments against:** distributed systems are substantially harder to operate. You will need
distributed tracing, service discovery, and a mature deployment pipeline before the first
service ships. Network calls replace function calls, so latency and partial failure become
everyday concerns. Data consistency across service boundaries is genuinely difficult.

The consensus in the industry, following Martin Fowler's MonolithFirst and Sam Newman's work
on migration patterns, is to use the strangler fig pattern: keep the monolith running, extract
services incrementally at natural seams, and let the architecture emerge rather than planning
it up front. Amazon, Netflix and Uber all followed roughly this path.

If your team is under about twenty engineers, the operational overhead probably outweighs the
benefits today, and you would be better served by improving your build and deploy times inside
the monolith. If you are larger than that and teams are regularly blocked on each other's
releases, incremental extraction is worth starting.

**Decision this forces:** none recorded

**Falsifier:** none recorded

## Corroborated findings

- **it depends, use the strangler fig** (frames: linear)

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
