// An independent kernel host, run as its own process by the concurrency tests.
//
// It does what a real host does and nothing else: claim a task, produce the artifact that
// task's phase requires, return it, repeat. It exists because the kernel's mutual exclusion,
// its leases and its phase advancement are all claims about several processes sharing a root,
// and a test that calls the syscalls in one process cannot check any of them. The artifacts it
// writes come from the same helpers the single-process tests use, so what differs between the
// two is only how many processes are contending.
//
// It is not a test file. `npm test` runs `dist/test/*.test.js`, so this compiles beside them
// and is only ever started by a test that spawns it.
//
// Usage: node dist/test/worker.js --root <dir> --worker <id> [--run <id>] [--max <n>]
//                                [--die-after-claim] [--stall-ms <n>] [--lease <seconds>]
//
// Each completed action prints one JSON line to stdout, so the spawning test asserts against
// what the worker actually did rather than against a sleep.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Kernel, type ClaimedTask } from "../src/os.js";
import { artifact, cfg, passA, passB, yaml } from "./helpers.js";

interface Args {
  root: string;
  worker: string;
  run?: string;
  max: number;
  dieAfterClaim: boolean;
  stallMs: number;
  leaseSeconds?: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const root = get("--root");
  const worker = get("--worker");
  if (!root || !worker) throw new Error("worker needs --root and --worker");
  return {
    root,
    worker,
    run: get("--run"),
    max: Number.parseInt(get("--max") ?? "50", 10),
    dieAfterClaim: argv.includes("--die-after-claim"),
    stallMs: Number.parseInt(get("--stall-ms") ?? "0", 10),
    leaseSeconds: get("--lease") === undefined ? undefined : Number.parseInt(get("--lease")!, 10),
  };
}

/** Busy-wait. A worker that is merely slow must not yield the event loop to its own kernel. */
function stall(ms: number): void {
  if (ms <= 0) return;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* deliberately spinning: this stands in for a subagent taking its time */
  }
}

/**
 * The artifact a host would return for this task, built from the same helpers the
 * single-process tests use. Pass A needs the blind letters the run assigned, and pass B needs
 * the frames the plan dispatched; both are read off disk, which is where a real host reads
 * them too.
 */
function artifactFor(task: ClaimedTask, runDir: string, hash: string): string {
  switch (task.phase) {
    case "diverge":
      return yaml(artifact(task.label, hash));
    case "critique_a": {
      const blind = JSON.parse(readFileSync(join(runDir, "critic", "blind-map.json"), "utf8")) as Record<string, string>;
      return yaml(passA(hash, Object.keys(blind)));
    }
    case "critique_b": {
      const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as { branches: { frame: string }[] };
      const frames = plan.branches.map((b) => b.frame);
      // One pair and singletons for the rest: enough shape for the scorer to cluster, fixed so
      // two workers racing to this phase cannot produce two different runs.
      const clusters = [
        { id: "paired", members: frames.slice(0, 2), action: "Expose cancel first." },
        ...frames.slice(2).map((f) => ({ id: `lone_${f}`, members: [f] })),
      ];
      return yaml(passB(hash, clusters));
    }
    case "deepen":
      return yaml({
        problem_hash: hash,
        frame: task.label,
        verdict: "defend",
        response: "The objection assumes users wait rather than cancel.",
        revised_position: `Do the ${task.label} thing.`,
        revised_falsifier: null,
        confidence: "high",
      });
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const k = new Kernel(cfg, { root: args.root, ...(args.leaseSeconds === undefined ? {} : { leaseSeconds: args.leaseSeconds }) });
  const say = (o: Record<string, unknown>) => console.log(JSON.stringify({ worker: args.worker, ...o }));

  for (let i = 0; i < args.max; i++) {
    let task: ClaimedTask | null;
    try {
      task = k.claim(args.worker, { runId: args.run });
    } catch (e) {
      say({ event: "claim_failed", error: (e as Error).message });
      return;
    }
    if (!task) {
      say({ event: "idle" });
      return;
    }
    say({ event: "claimed", task: task.id, phase: task.phase, label: task.label });

    if (args.dieAfterClaim) {
      // A worker that holds a lease and never comes back. Exiting without returning is the
      // whole point: the lease has to expire for the kernel to notice, which is the behaviour
      // under test. A non-zero code so a passing exit cannot be mistaken for a finished run.
      say({ event: "dying", task: task.id });
      process.exit(9);
    }

    stall(args.stallMs);

    const runDir = join(k.root, task.run_id);
    if (!existsSync(runDir)) {
      say({ event: "run_dir_gone", task: task.id });
      return;
    }
    try {
      const summary = k.return_(task.id, artifactFor(task, runDir, task.problem_hash), args.worker, 1000);
      say({ event: "returned", task: task.id, state: summary.state });
      if (summary.state === "done" || summary.state === "done_run_level" || summary.state === "cancelled" || summary.state === "aborted") {
        say({ event: "finished", state: summary.state });
        return;
      }
    } catch (e) {
      // A lease lost to expiry, or a run that ended under us. Both are ordinary for a host and
      // both are worth printing: the test asserts on which one happened.
      say({ event: "return_rejected", task: task.id, error: (e as Error).message });
    }
  }
  say({ event: "max_iterations" });
}

main();
