# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

**Wrap the cron line in `flock -n` that exits non-zero into somewhere a human reads, and pair the skipped-run count with an alarm on the age of the last successful completion, because refusals and completions are different signals and only the two together distinguish a runtime that is crossing the interval from a holder that has wedged - and record that this mechanism is valid only while one host owns the crontab, so the day it is baked into an image, containerised, or staged against production, the lock is void and the question reopens as a lease keyed to the work.**

**Decision this forces:** Edit the crontab line so the command runs behind a non-blocking file lock on that host, and make every refused run visible to a human rather than silent.

**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: Do wrap the cron line in `flock -n` that exits non-zero and sends that failure somewhere a human reads, and treat the count of skipped runs as your measurement of how far the script's runtime has crossed the cron interval.

**Falsifier:** Pull the completion record - the output file's mtime, the target table's max updated_at, the log's append timestamps - back a month or two, and read it twice. Read backwards - if the gap between consecutive completions has sat above the cron interval since the first day in the record rather than widening over recent weeks, nothing started, somebody only recently started looking, and this position is wrong; you want an interval change or a queue, not an instrument. Read forwards - that same record is the completion-age alarm, and if it ever shows a rising skip count while completions have stopped entirely, the refusal counter was reading a wedge and the skip count alone was never the measurement I claimed it was. And if any interval in that record contains two completions stamped by different hosts, the single-host premise is already false and the flock mechanism is void today rather than later.

Held by: PARTICULARIST, LEDGER, MINIMALIST, ACTOR_CENSUS. Under the strongest objection it **defended**: The objection lands three hits of very different weight, and only one of them touches the load-bearing claim.

## Corroborated findings

- **Edit the crontab line so the command runs behind a non-blocking file lock on that host, and make every refused run visible to a human rather than silent.** (frames: PARTICULARIST, LEDGER, MINIMALIST, ACTOR_CENSUS). Deepen: defend. The objection lands three hits of very different weight, and only one of them touches the load-bearing claim.
- **Move the exclusion out of the filesystem into a row or key in the datastore the job already writes to, with owner, host, run id and expiry, and alarm on the lease or the last successful completion rather than on overlap.** (frames: NIGHT_OPERATOR (pruned after corroborating: SABOTEUR)). Deepen: defend. The objection is right about the mechanism and wrong about what the position was buying with it.

## Live singletons (unverified)

(none)

## Folded under objection

(none)

## Pruned, with reason

- **SABOTEUR**: Replace file locking with a TTL lease held in the datastore the job already writes to, make every run idempotent and resumable on a work-item key, and alarm on staleness of the last successful completion rather than on overlap.
  - traps: T7
  - detector output: T7: Its cheapest-to-cause ranking is applied to failure modes, never to its own recommendations: a conditional-write lease, a heartbeat, per-call timeouts, and a rewritten keyed write path are proposed with no statement of what being wrong costs, how long until you find out, or which parts could be undone, and the one-line alternative is priced only as free and wrong.
- **MECHANIC**: Delete the cron entry and run the script under a supervisor that starts the next execution only after the previous process has exited, with a hard kill timeout on each execution.
  - traps: T7
  - detector output: T7: Deleting the cron entry and installing a supervised service is the most structurally committed recommendation in the run, and it is argued purely on mechanism, with no account of what being wrong costs or how long until you know, and the only recovery point raised concerns leftover lock state rather than the reversibility of its own move.

## Run level

- clean: no monoculture, no scatter, no run level trap

## What this forecloses

- Migrating this to Celery, RQ, or a systemd timer with a job queue as the first move - nothing in the problem says the workload needs a queue, only that one Python script got slower than its interval, and a migration would destroy the before-and-after duration record that is the most useful thing currently available.
- Lengthening the cron interval to whatever is comfortably longer than current runtime, which is the other thirty-second answer and which resets the clock on the growth curve without telling anyone what is growing.
- A lock the Python script takes on itself at import time and exits quietly on contention, which keeps the fix inside the codebase where it looks tidy and removes the one thing worth watching.
- Adopting a workflow orchestrator as the first move - no scheduler gets evaluated now, and if the real requirement turns out to be a dependency DAG with retries and backfill, this has to be reopened later at higher cost.
- Redesigning the script as a queue consumer or event-driven worker, which is the right answer if the work is genuinely parallelisable and is the answer this position rules out.
- Letting runs overlap deliberately and buying safety with idempotent writes instead of a lock - cheaper in throughput, more expensive in the care every future edit to the script has to take.
- Moving the job to a scheduler or worker system such as systemd timers, Celery, Airflow, or a hosted cron service. That migration cannot be justified by an overlap that one line prevents, and it trades a known failure for a new set of unknown ones.
- Putting the concurrency guard inside the Python script itself, via a PID file, a database advisory lock, or a lock table. That is more code to own, it can strand a stale lock when the process is killed with SIGKILL, and it only takes effect after the interpreter has already started.
- Queueing the overlapping run to execute immediately after the current one finishes, using flock without -n. That looks kinder but lets work pile up invisibly and hides exactly the runtime creep you need to be able to see.
- Making the script reentrant and idempotent so overlapping runs are harmless - it is the most elegant answer and it leaves the operator with nothing to look at, nothing to turn off, and no signal that anything is wrong while the pile-up eats the host.
- Moving the job to a hosted scheduler or job queue (Airflow, Celery beat, a Kubernetes CronJob with concurrencyPolicy) as the first move - it relocates the kill switch into a UI or API the person holding the pager may not have credentials for at 3am.
- A timeout that silently kills or supersedes the previous run - auto-recovery converts a visible incident into an invisible one and removes the operator from the loop entirely.

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| 7 | 558877 | not measured |

problem_hash: `sha256:bad9dcb705701f121abe594852d98e034d4dfafb48439d844790bfa72068519e`
seed: 1
