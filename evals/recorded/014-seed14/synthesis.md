# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Install in this order in one afternoon - a hard wall-clock timeout that kills the process group, an alarm on the age of the last successful completion, a unique or upsert key at the datastore so overlap cannot double-write, and only then `flock -n` on the crontab line with per-run pid, start, end, duration and exit code - then commit to staying on cron unless two weeks of that log show p95 runtime climbing past half the interval with no hang present.**

**Decision this forces:** Edit the crontab line to wrap the existing command in flock -n today, and in the same change start recording per-run duration and every skipped-because-locked event so the bigger scheduler decision is made later from that record.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Wrap the cron line in flock -n today and log every run's pid, start, end, duration and exit code, then commit to staying on cron with a hard timeout and a watchdog kill unless two weeks of that log show p95 runtime climbing past half the interval with no hang present.

**Falsifier:** The position assumes the two-week measurement is free, so it fails if waiting has a running cost - if the script's writes cannot be made idempotent and no unique key can be added, every overlapping interval corrupts data while you measure, and the cheap experiment is no longer cheap, which means you serialize or stop the job now and argue about platforms afterwards. It also fails at step one if there is no success signal to age-alarm on, because a script with no exit-code discipline and no observable completion marker makes the whole telemetry-first order unbuildable and observability becomes the first change instead. And as before - if the crontab entry exists on more than one host, or the lock path sits on a network filesystem, the lock is theatre while the duration graph reports health.

Held by: LEDGER, DOOR_KEEPER, PARTICULARIST. Under the strongest objection it **defended**: The objection is right about the order and right about the blind spot, and it costs me the first step of the position.

## Corroborated findings

- **Edit the crontab line to wrap the existing command in flock -n today, and in the same change start recording per-run duration and every skipped-because-locked event so the bigger scheduler decision is made later from that record.** (frames: LEDGER, DOOR_KEEPER, PARTICULARIST). Deepen: defend. The objection is right about the order and right about the blind spot, and it costs me the first step of the position.
- **Rebuild the job's entrypoint so a single run is guarded by a lock whose file names its holder, skipping is loud rather than silent, and a human at a shell can read the state, kill the run, and rerun it by hand without a deploy.** (frames: ACTOR_CENSUS (pruned after corroborating: NIGHT_OPERATOR)). Deepen: defend. The objection lands one real hit and I am paying for it.

## Live singletons (unverified)

(none)

## Folded under objection

(none)

## Pruned, with reason

- **NIGHT_OPERATOR**: Make the script guard itself at runtime: take a named lock that writes its holder's host, PID and start time somewhere the on-call can read and clear, emit start/finish/skipped heartbeats to a dead-man's-switch monitor, and re-read a disable flag on every start.
  - traps: T7
  - detector output: T7: Everything is sorted by whether a control works without a deploy or root, which is about access at 3am; no recommendation carries a cost of being wrong or a time to find out, and nothing is ordered by what can be backed out.
- **SABOTEUR**: Make each unit of work idempotent and claimed under an expiring lease, wrap every invocation in a hard wall-clock timeout that kills the whole process group, and page on the age of the last successful completion rather than on a non-zero exit code, treating any lock as an optimization and never as the correctness mechanism.
  - traps: T7
  - detector output: T7: It proposes the most invasive change in the run - per-unit identity, a claim table, restructured work - with no cost of being wrong, no detection latency and no statement of what could be backed out, while its own limits section covers failure modes rather than reversibility.
- **FRAME_BREAKER**: Ship a one-line instrumentation change tomorrow that makes every run emit a run id, start and end timestamp, and the count of items it processed, and treat the overlap as the alarm you now measure rather than the fault you pick a mechanism for.
  - traps: T7
  - detector output: T7: It recommends redefining a run behind a stored watermark with no cost of being wrong and no detection latency, which is the one move here that changes run semantics irreversibly, and it treats a week of continued overlap while measuring as free.

## Run level

- clean: no monoculture, no scatter, no run level trap

## What this forecloses

- Migrating to a distributed scheduler or job queue now - Airflow, Celery, Temporal, a managed workflow service - as the first move. This position says that decision has to be bought with runtime data, not with the overlap incident.
- Any queueing form of the lock (`flock -w`, or a scheduler's Replace/Allow concurrency policy), which trades overlap for an unbounded backlog and hands the bill to the host and the recovery window.
- Making the script idempotent and letting the copies run concurrently. That is real engineering work spent to make the symptom survivable while leaving the growing runtime entirely unmeasured.
- Shortening or lengthening the cron interval as the fix. Retuning the interval without measuring duration is guessing at a number that is already observable.
- Migrating to a job queue or workflow orchestrator now, which is the answer most teams reach for first and the one this position refuses until there is duration data to justify it.
- Accepting concurrency and making the script parallel-safe and idempotent instead of serializing it. That is a legitimate direction and flock rules it out for now.
- Widening the cron interval as the fix, which makes the symptom disappear while the runtime drift that caused it keeps growing unmeasured.
- Lengthening the cron interval as the first move. Without the duration history, any new interval is a guess, and stretching it hides the growth that produced the overlap.
- Moving the job onto a queue, a worker system, or a timer unit with its own concurrency control before the skip count exists. That is a rewrite justified by a number nobody has yet.
- Taking the lock inside the Python script. The script's own runtime is the thing under suspicion, so the skip decision and its logging must not depend on that process starting, importing, and reaching its locking code.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 7 | 549437 | not measured |

problem_hash: `sha256:bad9dcb705701f121abe594852d98e034d4dfafb48439d844790bfa72068519e`
seed: 14
