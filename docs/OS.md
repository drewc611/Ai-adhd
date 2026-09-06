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
| thread | a task: one brief, one agent type, one artifact path |
| scheduler | `claim` hands out the oldest pending task under a lease |
| preemption | lease expiry returns the task to the queue; the third expiry aborts the run |
| syscall | an MCP tool or `adhd os <verb>` |
| journal | `<root>/journal.jsonl`, append only |
| init | `submit`; nothing is spent until `confirm` |
| kill | `cancel`; returned branches render unscored |

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
