# ADHD as an agent operating system

The library was built as four phases a host drives by hand. The kernel in `src/os.ts` makes
that loop autonomous without breaking the one constraint that defines the repo: nothing here
calls a model. The kernel is a scheduler, not an executor. It owns state, leases, phase
advancement, the D5 gate, and cancellation. Hosts supply inference by claiming tasks and
returning artifacts.

```
   submit(problem, decision) ──> awaiting_confirm ──confirm──> diverge
                                                                 │  branch tasks
        any MCP host, any Claude Code session:                   ▼
        claim(worker) ──> {brief, agent} ──> spawn subagent ──> return(task, output)
                                                                 │
                     kernel validates, writes artifact, and when the phase is complete
                     runs the next phase function and mints its tasks:
                                                                 ▼
                              critique_a ──> critique_b ──> deepen ──> done
                                     (critique_b `continues` critique_a: same subagent)
   cancel(run) at any point ──> cancelled, partial synthesis rendered (D5)
   lease expiry ──> task back to pending; three expiries ──> aborted
   hash mismatch or contract failure in any phase ──> aborted, reason recorded
```

## Process model

| OS concept | ADHD |
|---|---|
| process | a run directory with `os.json` |
| process state | `awaiting_confirm`, `diverge`, `critique_a`, `critique_b`, `deepen`, `done`, `done_run_level`, `cancelled`, `aborted` |
| task status | `pending`, `leased`, `done`, `dropped` (the run no longer needs it), `dead` (tried `maxAttempts` times and never came back) |
| thread | a task: one brief, one agent type, one artifact path |
| mutex | `.lock`, a directory in the kernel root, stamped with the owning pid and host |
| scheduler | `claim` hands out the oldest pending task under a lease |
| preemption | lease expiry returns the task to the queue; the third expiry aborts the run |
| syscall | an MCP tool or `adhd os <verb>` |
| journal | `<root>/journal.jsonl`, append only |
| init | `submit`; nothing is spent until `confirm` |
| kill | `cancel`; returned branches render unscored |
| SIGTERM to the scheduler | `drain`; nothing new is handed out and live leases finish |
| ulimit | `--budget <tokens>` on submit; the run halts and renders partial once reported tokens pass it |

The kernel never reads a brief's content into a decision and never composes a prompt beyond
what the compiler already wrote. It moves files and flips states. Every invariant the phases
enforce (verbatim problem, hash echo, blind pass A, sibling isolation, detector completeness,
the pruned block) is enforced by the same code the CLI runs, because the kernel calls the same
phase functions.

## Syscalls

| tool / command | what it does |
|---|---|
| `adhd_submit` / `adhd os submit` | compile; return the D5 preview and `run_id`; state `awaiting_confirm`. `confirmed: true` skips the gate for scripted use. |
| `adhd_confirm` / `adhd os confirm` | mint the branch tasks; state `diverge` |
| `adhd_claim` / `adhd os claim` | lease the oldest pending task to `worker`; returns the brief inline, the agent type, and `continues` when the task must go to an existing subagent |
| `adhd_return` / `adhd os return` | write the subagent's final message as the artifact (the first fenced YAML block; if the message carried anything outside it, the whole message is kept beside the artifact as `<artifact>.raw.md`); advance the run if the phase is complete |
| `adhd_status` / `adhd os status` | state, task counts, last phase text, reason |
| `adhd_result` / `adhd os result` | the synthesis when there is one |
| `adhd_cancel` / `adhd os cancel` | drop pending and leased tasks; render partial |
| `adhd_list` / `adhd os list` | every run under the root |
| `adhd_log` / `adhd os log` | the journal lines for one run |
| `adhd_record` / `adhd os record` | promote a finished run into `evals/recorded/` with provenance generated from the journal and an `expected.json` recording the eval outcome as observed |
| `adhd os reap` | expire leases (also runs on every claim, status, and list) |
| `adhd os stats` | throughput, per-phase timing and lease expiry rate from the journal |
| `adhd os heartbeat` | a worker says it is still alive; pushes its lease out by the phase's lease length. Only the holder, and only while the lease still stands: extending an expired one would take the task back from whoever legitimately re-claimed it |
| `adhd os drain` | stop handing out tasks; outstanding leases run to completion. Cancelling would drop work already paid for and still in flight, so this is what a host uses to stop without killing live subagents. A marker file, so it survives the process that called it |
| `adhd os resume` | accept claims again |
| `adhd os gc` | delete finished run directories older than `--days`. Dry unless `--yes`: a run directory is the only copy of its artifacts, `adhd os record` promotes rather than copies, and an old run still in a working state is stuck rather than rubbish, so it is kept and named |
| `adhd os compact` | move journal lines belonging to finished runs into a dated archive beside the journal. Archived, not deleted — `adhd os record` generates provenance from these, and kernel-level lines with no run id stay because they are what explain a corrupted run an hour later |

### Two roots, and why they are named apart

Every kernel tool takes both. `root` is the repository root holding `config/` and `prompts/`;
`os_root` is the kernel's runs directory (default `$ADHD_OS_ROOT`, else `./runs`).

They were both called `root` and meant different things depending on which tool you called: the
repository root in `adhd_run`, `adhd_traps`, `adhd_eval` and `adhd_frames`, the runs directory in
the ten kernel tools. A host that passed its repository root to `adhd_submit`, reasonably, got
that directory treated as the runs root and never learned it had. The kernel tools now take
`os_root` for the runs directory and `root` means the same thing everywhere. A host that was
passing `root` to a kernel tool must rename it.

`return` accepts `tokens`, the usage the subagent reported. When a run finishes the kernel sums
reported tokens by phase into `cost.json`, so the synthesis shows real spend when workers
report it and the compile estimate when they do not.

## Workers

A worker is anything that can spawn an isolated subagent: a Claude Code session running the
`adhd-worker` skill, a script driving another agent runtime, a person. The contract is three
calls: claim, spawn the named agent with the brief as its entire prompt, return the final
message. A worker that dies mid-task loses its lease and someone else picks the task up.

`continues` matters for exactly one task per run: pass B should reach the subagent that did
pass A. The kernel enforces the preference: for one lease window after pass A returns, only
the worker that returned it can claim pass B, and the claim carries `continues` so that
worker resumes its critic. After the window any worker may claim it, and the claim carries
`continues: null`: run it as a fresh critic. The pass B brief contains the pass A scores, so
a fresh critic can do the job; the preference saves a re-read, it is not a correctness
requirement. The kernel does not track agent ids; that is host state.

## What this is not

- Not a daemon. The kernel is a library with a stdio MCP front and a CLI. Run it wherever
  the run directories live. Several hosts can share a root; writes are serialised by a lock.
- Not a scheduler of models. It never decides which model runs a branch. The host does.
- Not a memory. Runs are the record. `evals/recorded/` is where a run becomes evidence.

## D5 under the kernel

The gate is `confirm`. A run submitted without `confirmed: true` sits at `awaiting_confirm`
with its preview and estimate in `status` until someone confirms or cancels it, and cancel
before confirm spends nothing. After confirm, `cancel` at any state renders the returned
branches unscored with the `UNSCORED, divergence only` label. Lease expiry cannot spend more
than three attempts per task.

## Two invariants the kernel enforces mechanically

**One task, one worker.** `claim` and `return` both run inside a whole-root mutex built on
`mkdir`, which is atomic, so two workers can never be handed the same task. Six processes
racing for one run is a test, not a hope (`test/os.test.ts`).

Breaking a held lock is the dangerous half. Breaking on age alone is a race: a holder that is
merely slow, on a loaded box or a paused container, gets its lock stolen and two processes then
run inside the mutex at once. So the lock records the owning pid and hostname, and is broken
only when that process is known dead, or when it is older than two minutes, which no critical
section here can reach because none of them do network or model work. Every break is journalled
as `lock_broken`, since a stolen lock is the kind of event that explains a corrupted run an
hour later.

**An artifact answers the task it was returned for.** A worker holds several subagents at once
and maps task ids to them; the worker skill says so explicitly. One wrong entry in that map
returns the right YAML under the wrong task, and the artifact lands in another frame's file.
Nothing downstream can catch that: the run continues and attributes a position to a frame that
never held it, which is precisely what the isolation contract exists to guarantee. So `return`
compares what the artifact declares about itself, its `frame` for a branch or deepen task and
its `pass` for a critic task, against what the task asked for, and rejects a mismatch before
writing anything.

**A lease is ownership.** Returning a task requires naming the worker that holds it. Omitting
the worker id used to skip the check, so any process could return work it did not do; a lease
means one subagent owns one brief, and a return from anyone else silently breaks that.
