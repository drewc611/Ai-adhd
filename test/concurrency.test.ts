// Kernel behaviour that only exists when more than one process is involved.
//
// Backlog 30, 31 and 32. Everything else about the kernel is tested in `os.test.ts` by calling
// the syscalls in order from one process against a fake clock, which is the right way to test
// phase advancement and the wrong way to test a mutex. The claims these cover — that a lock
// serialises writes, that a lease survives the death of the worker holding it, that state lives
// on disk rather than in the object — are all claims about processes, and a single-process test
// asserts them by construction rather than checking them.
//
// The worker is `test/worker.ts`, spawned as its own process. It uses the same artifact helpers
// the single-process tests use, so the only difference between the two is how many processes
// are contending for the root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { Kernel } from "../src/os.js";

const PROBLEM = "What timeouts should I set on this HTTP client?";
const WORKER = join(process.cwd(), "dist", "test", "worker.js");

interface Line {
  worker: string;
  event: string;
  task?: string;
  phase?: string;
  state?: string;
  error?: string;
}

/** Run one worker process to completion and return the JSON lines it printed. */
function spawnWorker(args: string[]): Promise<{ lines: Line[]; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [WORKER, ...args], { cwd: process.cwd() }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code as number) : 0;
      // A worker told to die exits non-zero on purpose, so a non-zero code is not a failure
      // here. Empty output with an error is: that means it never started.
      if (!stdout.trim()) return err ? reject(new Error(`worker produced nothing: ${stderr || (err as Error).message}`)) : resolve({ lines: [], code });
      const lines = stdout
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as Line);
      resolve({ lines, code });
    });
  });
}

/** A kernel on a real clock, offset by however much a test needs to push a lease past expiry. */
function hostKernel(root: string, opts: { leaseSeconds?: number; maxAttempts?: number } = {}) {
  const skew = { ms: 0 };
  const k = new Kernel(cfg, { root, now: () => new Date(Date.now() + skew.ms), ...opts });
  return { k, skew };
}

test("two worker processes drive one run to done, and no task is returned twice", async () => {
  // Backlog 30. The existing race test proves two processes never receive the same task from
  // one claim round. This is the rest of the claim: that they can share the whole run — every
  // phase, including the two that hand off through a continuation — without corrupting it.
  const root = join(tmp(), "root");
  const { k } = hostKernel(root);
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "shared", confirmed: true });

  const all: Line[] = [];
  // Waves rather than one long-lived pair, because a worker that finds nothing claimable exits,
  // and pass B is reserved for the worker that did pass A until `others_after`. A real host
  // polls; this is that, bounded.
  //
  // `--max 2` caps each worker at two tasks per wave. Without it whichever process wins the
  // first lock race can burn through all five branch tasks before the other is scheduled, and
  // then a test asserting both did work is asserting the operating system's scheduler. Two
  // apiece against five pending tasks makes the split structural instead.
  for (let wave = 0; wave < 10 && !["done", "done_run_level", "aborted", "cancelled"].includes(k.status("shared").state); wave++) {
    const results = await Promise.all([
      spawnWorker(["--root", root, "--worker", "w1", "--run", "shared", "--max", "2"]),
      spawnWorker(["--root", root, "--worker", "w2", "--run", "shared", "--max", "2"]),
    ]);
    for (const r of results) all.push(...r.lines);
  }

  const st = k.status("shared");
  assert.equal(st.state, "done", `run did not finish: ${st.state} ${st.reason ?? ""}`);

  const returned = all.filter((l) => l.event === "returned").map((l) => l.task!);
  assert.equal(new Set(returned).size, returned.length, `a task was returned twice: ${returned.join(", ")}`);
  assert.equal(all.filter((l) => l.event === "return_rejected").length, 0, "a worker had a return rejected on a run with no expiry");

  // Both processes did real work. If one did all of it the test still passes above, and would
  // be asserting nothing about sharing.
  const byWorker = new Set(all.filter((l) => l.event === "returned").map((l) => l.worker));
  assert.equal(byWorker.size, 2, `only ${[...byWorker].join(", ")} returned anything; the run was not shared`);

  // Every phase ran, and the synthesis is the one the single-process test produces.
  const phases = new Set(all.filter((l) => l.event === "claimed").map((l) => l.phase!));
  assert.deepEqual([...phases].sort(), ["critique_a", "critique_b", "deepen", "diverge"]);
  assert.match(k.result("shared").synthesis!, /## Pruned, with reason/);

  // The lock left nothing behind, and every break of it would have been journalled.
  const journal = readFileSync(join(k.root, "journal.jsonl"), "utf8");
  assert.ok(!journal.includes("lock_broken"), "a lock was broken during an ordinary two-worker run");
  assert.ok(!journal.includes("lock_lost"), "a worker lost the lock it held");
});

test("a worker that dies holding a lease loses the task to the next worker, and the run still finishes", async () => {
  // Backlog 31. The lease is the kernel's only defence against a host that stops existing, and
  // it had only ever been advanced by a fake clock inside the same process that set it.
  const root = join(tmp(), "root");
  const { k, skew } = hostKernel(root, { leaseSeconds: 30 });
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "dies", confirmed: true });

  const dead = await spawnWorker(["--root", root, "--worker", "doomed", "--run", "dies", "--lease", "30", "--die-after-claim"]);
  assert.equal(dead.code, 9, "the worker was supposed to exit without returning its task");
  const claimed = dead.lines.find((l) => l.event === "claimed")!;
  assert.ok(claimed, "the worker died before claiming anything");

  const held = k.status("dies");
  assert.equal(held.tasks.leased, 1);
  assert.equal(held.tasks.pending, 4);

  // Nobody else can have it while the lease stands. This is the half that makes the lease worth
  // having: without it, a slow worker's task is handed out again and two subagents do it.
  const early = await spawnWorker(["--root", root, "--worker", "w2", "--run", "dies", "--max", "1"]);
  assert.ok(!early.lines.some((l) => l.task === claimed.task), "a live lease was handed to a second worker");
  // That probe is a real worker, so it took one of the four tasks nobody was holding and did
  // it. The queue below is counted against what it actually returned rather than a constant.
  const earlyDone = early.lines.filter((l) => l.event === "returned").length;

  skew.ms = 31_000;
  const reaped = k.reap();
  assert.deepEqual(reaped.expired, [claimed.task]);
  const after = k.status("dies");
  assert.equal(after.tasks.leased, 0, "the dead worker's lease was not released");
  assert.equal(after.tasks.pending, 5 - earlyDone, "the dead worker's task did not come back to the queue");

  const all: Line[] = [];
  for (let wave = 0; wave < 6 && !["done", "done_run_level", "aborted", "cancelled"].includes(k.status("dies").state); wave++) {
    const r = await spawnWorker(["--root", root, "--worker", "w2", "--run", "dies", "--lease", "600"]);
    all.push(...r.lines);
  }
  assert.equal(k.status("dies").state, "done", "the run never recovered from one dead worker");
  assert.ok(
    all.some((l) => l.event === "returned" && l.task === claimed.task),
    "the reclaimed task was never actually redone",
  );

  const events = readFileSync(join(k.root, "journal.jsonl"), "utf8");
  assert.match(events, /lease_expired/);
});

test("a kernel restarted mid-run picks the run up from disk with nothing in memory", async () => {
  // Backlog 32. The kernel holds no run state between syscalls by design, and the whole design
  // is worth exactly as much as a restart proves. The first process is stopped after two
  // branches, so the run is resumed by an object that never saw it start — in a process that
  // never saw it either.
  const root = join(tmp(), "root");
  const { k } = hostKernel(root);
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "restart", confirmed: true });

  const first = await spawnWorker(["--root", root, "--worker", "before", "--run", "restart", "--max", "2"]);
  const doneFirst = first.lines.filter((l) => l.event === "returned").map((l) => l.task!);
  assert.equal(doneFirst.length, 2, "the first process was supposed to return exactly two tasks");

  // A brand new object on the same root, standing in for the process that restarted. Nothing
  // is carried over: not the record, not the task list, not the lock.
  const resumed = new Kernel(cfg, { root });
  const st = resumed.status("restart");
  assert.equal(st.state, "diverge");
  assert.equal(st.tasks.done, 2);
  assert.equal(st.tasks.pending, 3);

  const all: Line[] = [];
  for (let wave = 0; wave < 6 && !["done", "done_run_level", "aborted", "cancelled"].includes(resumed.status("restart").state); wave++) {
    const r = await spawnWorker(["--root", root, "--worker", "after", "--run", "restart"]);
    all.push(...r.lines);
  }
  assert.equal(resumed.status("restart").state, "done");

  // The two branches the first process returned were not redone.
  const redone = all.filter((l) => l.event === "returned" && doneFirst.includes(l.task!));
  assert.deepEqual(redone, [], "work completed before the restart was done a second time");

  // The journal spans the restart as one record, which is what makes it usable for a post
  // mortem: submitted and confirmed by the first process, done by the third.
  const entries = readFileSync(join(resumed.root, "journal.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { event: string; state?: string });
  const events = entries.map((e) => e.event);
  assert.equal(events[0], "submitted");
  // Every phase advance journals `advanced` last, the terminal one included, so `done` is the
  // second to last line rather than the final one.
  assert.deepEqual(entries.slice(-2).map((e) => [e.event, e.state ?? null]), [
    ["done", null],
    ["advanced", "done"],
  ]);
  assert.ok(events.filter((e) => e === "returned").length >= 5);
});
