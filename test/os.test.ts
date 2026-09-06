import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { artifact, cfg, passA, passB, tmp, yaml } from "./helpers.js";
import { Kernel } from "../src/os.js";

const PROBLEM = "What timeouts should I set on this HTTP client?";

function kernel(opts: { leaseSeconds?: number; maxAttempts?: number; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: Date.parse("2026-09-06T00:00:00Z") };
  const k = new Kernel(cfg, { root: join(tmp(), "root"), leaseSeconds: opts.leaseSeconds ?? 60, maxAttempts: opts.maxAttempts ?? 3, now: () => new Date(clock.t) });
  return { k, clock };
}

test("submit stops at the D5 gate; confirm mints one task per branch", () => {
  const { k } = kernel();
  const s = k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1" });
  assert.equal(s.kind, "plan");
  if (s.kind !== "plan") return;
  assert.equal(s.state, "awaiting_confirm");
  assert.match(s.preview, /Nothing has been spent/);
  assert.equal(k.claim("w1"), null, "nothing claimable before confirm");
  const c = k.confirm("r1");
  assert.equal(c.state, "diverge");
  assert.equal(c.tasks.pending, 5);
  assert.throws(() => k.confirm("r1"), /not awaiting_confirm/);
});

test("declined classes never create a run", () => {
  const { k } = kernel();
  const s = k.submit("what is 2+2", { problem_class: "factual_lookup" });
  assert.equal(s.kind, "declined");
  assert.deepEqual(k.list(), []);
});

test("full run through the kernel: claim, return, advance through every phase to done", () => {
  const { k } = kernel();
  const s = k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  if (s.kind !== "plan") throw new Error("expected plan");
  const H = s.problem_hash ?? undefined; // not on the plan summary
  const status0 = k.status("r1");
  assert.equal(status0.state, "diverge");
  const hash = status0.problem_hash;

  // diverge: five branch tasks
  const frames: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w1")!;
    assert.ok(t, `claim ${i}`);
    assert.equal(t.phase, "diverge");
    assert.equal(t.continues, null);
    assert.match(t.brief, /## Output contract/);
    assert.ok(!t.brief.includes("so far"));
    frames.push(t.label);
    const over = i === 0 ? { position: "Set 15s first token, 30s inter token, 90s absolute, one retry." } : {};
    const r = k.return_(t.id, yaml(artifact(t.label, hash, over)), "w1");
    if (i < 4) assert.equal(r.state, "diverge");
  }
  assert.equal(k.claim("w1")?.phase, "critique_a");
  void H;
  // critique_a: one task, blind brief
  let st = k.status("r1");
  assert.equal(st.state, "critique_a");
  const ta = k.claim("w2", { runId: "r1" }); // already leased to w1 above; nothing else pending
  assert.equal(ta, null);
  const leasedA = k.status("r1").tasks.leased;
  assert.equal(leasedA, 1);
  const taskA = k.list()[0]!; // summary only; get the task id via a fresh claim after expiry is overkill: use known id
  void taskA;
  const passAId = "r1:critique_a:pass-a";
  const briefA = readFileSync(join(k.root, "r1", "critic", "pass-a.brief.md"), "utf8");
  for (const f of cfg.frames.frames) assert.ok(!new RegExp(`\\b${f.id}\\b`).test(briefA), "pass A brief is blind");
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  k.return_(passAId, yaml(passA(hash, Object.keys(blindMap))), "w1");

  // critique_b continues pass A
  st = k.status("r1");
  assert.equal(st.state, "critique_b");
  const tb = k.claim("w1")!;
  assert.equal(tb.phase, "critique_b");
  assert.equal(tb.continues, passAId);
  const pb = passB(hash, [
    { id: "cancel", members: [frames[1]!, frames[2]!], action: "Expose cancel first." },
    { id: "consensus", members: [frames[0]!] },
    { id: "lone", members: [frames[3]!, frames[4]!], action: "Fail over instead of retrying." },
  ], { [frames[0]!]: { T1: "unchanged with details deleted" } });
  k.return_(tb.id, yaml(pb), "w1");

  // deepen: one task per surviving cluster
  st = k.status("r1");
  assert.equal(st.state, "deepen");
  assert.equal(st.tasks.pending, 2);
  for (let i = 0; i < 2; i++) {
    const td = k.claim("w3")!;
    assert.equal(td.phase, "deepen");
    assert.equal(td.agent, "adhd-deepen");
    for (const f of cfg.frames.frames) if (f.id !== td.label) assert.ok(!new RegExp(`\\b${f.id}\\b`).test(td.brief), "deepen brief isolated");
    k.return_(td.id, yaml({ problem_hash: hash, frame: td.label, verdict: "defend", response: "The objection assumes users wait.", revised_position: `Do the ${td.label} thing.`, revised_falsifier: null, confidence: "high" }), "w3");
  }
  st = k.status("r1");
  assert.equal(st.state, "done");
  const res = k.result("r1");
  assert.ok(res.synthesis);
  assert.match(res.synthesis!, /## Pruned, with reason/);
  assert.match(res.synthesis!, new RegExp(`\\*\\*${frames[0]}\\*\\*[\\s\\S]*traps: T1`));
  assert.ok(existsSync(join(k.root, "journal.jsonl")));
  const events = readFileSync(join(k.root, "journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).event);
  assert.deepEqual([...new Set(events)], ["submitted", "confirmed", "claimed", "returned", "advanced", "done"]);
});

test("lease expiry re-queues the task; the third expiry aborts the run", () => {
  const { k, clock } = kernel({ leaseSeconds: 60, maxAttempts: 3 });
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const t1 = k.claim("w1")!;
  clock.t += 61_000;
  const t2 = k.claim("w2")!;
  assert.equal(t2.id, t1.id, "the expired task is handed out again");
  assert.equal(t2.attempts, 2);
  clock.t += 61_000;
  const t3 = k.claim("w3")!;
  assert.equal(t3.attempts, 3);
  clock.t += 61_000;
  assert.equal(k.claim("w4"), null);
  const st = k.status("r1");
  assert.equal(st.state, "aborted");
  assert.match(st.reason!, /expired 3 times/);
});

test("a wrong worker cannot return someone else's task; a hash mismatch aborts the run", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const t = k.claim("w1")!;
  assert.throws(() => k.return_(t.id, yaml(artifact(t.label, hash)), "w2"), /leased to w1/);
  // Return all five, one with the wrong hash: the phase advance aborts the run.
  k.return_(t.id, yaml(artifact(t.label, hash)), "w1");
  for (let i = 0; i < 4; i++) {
    const x = k.claim("w1")!;
    const bad = i === 2 ? "sha256:" + "0".repeat(64) : hash;
    k.return_(x.id, yaml(artifact(x.label, bad)), "w1");
  }
  const st = k.status("r1");
  assert.equal(st.state, "aborted");
  assert.match(st.reason!, /HASH_MISMATCH/);
});

test("cancel mid-diverge renders the returned branches unscored (D5)", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const a = k.claim("w1")!;
  k.return_(a.id, yaml(artifact(a.label, hash)), "w1");
  const b = k.claim("w1")!;
  k.return_(b.id, yaml(artifact(b.label, hash, { position: "It depends on the caller." })), "w1");
  k.claim("w1"); // leased, never returned
  const st = k.cancel("r1", "user pressed stop");
  assert.equal(st.state, "cancelled");
  assert.equal(st.tasks.dropped, 3);
  const res = k.result("r1");
  assert.match(res.synthesis!, /UNSCORED, divergence only/);
  assert.match(res.synthesis!, /branches returned: 2 of 5/);
  assert.equal(k.claim("w1"), null);
});

test("cancel before confirm spends nothing and renders nothing", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1" });
  const st = k.cancel("r1");
  assert.equal(st.state, "cancelled");
  assert.equal(k.result("r1").synthesis, null);
});

test("monoculture ends the run at done_run_level with a synthesis and no deepen tasks", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const frames: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w")!;
    frames.push(t.label);
    k.return_(t.id, yaml(artifact(t.label, hash)), "w");
  }
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  k.claim("w");
  k.return_("r1:critique_a:pass-a", yaml(passA(hash, Object.keys(blindMap))), "w");
  const tb = k.claim("w")!;
  k.return_(tb.id, yaml(passB(hash, [{ id: "all", members: frames }])), "w");
  const st = k.status("r1");
  assert.equal(st.state, "done_run_level");
  assert.match(st.reason!, /MONOCULTURE/);
  assert.match(k.result("r1").synthesis!, /No recommendation/);
});

test("list and status reap expired leases; several runs are scheduled oldest first", () => {
  const { k, clock } = kernel({ leaseSeconds: 10 });
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "old", confirmed: true });
  clock.t += 1000;
  k.submit("Name this function.", { problem_class: "naming" }, { seed: 2, runId: "new", confirmed: true });
  const t = k.claim("w")!;
  assert.equal(t.run_id, "old");
  clock.t += 11_000;
  const l = k.list();
  assert.equal(l.find((r) => r.run_id === "old")!.tasks.leased, 0, "list reaped the lease");
  assert.equal(l.length, 2);
});

test("pass B prefers the pass A worker for one lease window, then falls back to a fresh critic", () => {
  const { k, clock } = kernel({ leaseSeconds: 60 });
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w1")!;
    k.return_(t.id, yaml(artifact(t.label, hash)), "w1");
  }
  const a = k.claim("critic-1")!;
  assert.equal(a.phase, "critique_a");
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  k.return_(a.id, yaml(passA(hash, Object.keys(blindMap))), "critic-1", 55000);
  // Another worker cannot take pass B inside the window.
  assert.equal(k.claim("critic-2"), null);
  // The pass A worker can, and gets the continuation.
  clock.t += 1000;
  const b = k.claim("critic-1")!;
  assert.equal(b.phase, "critique_b");
  assert.equal(b.continues, a.id);
  // Simulate that worker dying: lease expires, task returns to pending with the same preference.
  clock.t += 61_000;
  assert.equal(k.status("r1").tasks.pending, 1);
  // Now past others_after: a different worker may take it, as a fresh critic.
  const b2 = k.claim("critic-2")!;
  assert.equal(b2.id, b.id);
  assert.equal(b2.continues, null);
});

test("reported tokens are summed into cost.json by phase and surface in the synthesis", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const frames: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w")!;
    frames.push(t.label);
    k.return_(t.id, yaml(artifact(t.label, hash)), "w", 40000 + i);
  }
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  const a = k.claim("w")!;
  k.return_(a.id, yaml(passA(hash, Object.keys(blindMap))), "w", 50000);
  const b = k.claim("w")!;
  k.return_(b.id, yaml(passB(hash, [{ id: "one", members: frames.slice(0, 3) }, { id: "two", members: frames.slice(3) }])), "w", 70000);
  for (let i = 0; i < 2; i++) {
    const d = k.claim("w")!;
    k.return_(d.id, yaml({ problem_hash: hash, frame: d.label, verdict: "defend", response: "Holds.", revised_position: "Do it.", revised_falsifier: null, confidence: "high" }), "w", 45000);
  }
  assert.equal(k.status("r1").state, "done");
  const cost = JSON.parse(readFileSync(join(k.root, "r1", "cost.json"), "utf8")) as { tokens: number; by_phase: Record<string, number>; reported_tasks: number };
  assert.equal(cost.tokens, 200010 + 50000 + 70000 + 90000);
  assert.equal(cost.reported_tasks, 9);
  assert.equal(cost.by_phase["critique_b"], 70000);
  assert.match(k.result("r1").synthesis!, /410010/);
});

test("record promotes a finished run with provenance and an expectation that matches the eval", async () => {
  const { recordRun } = await import("../src/os.js");
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const frames: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w-a")!;
    frames.push(t.label);
    k.return_(t.id, yaml(artifact(t.label, hash)), "w-a");
  }
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  const a = k.claim("w-b")!;
  k.return_(a.id, yaml(passA(hash, Object.keys(blindMap))), "w-b");
  const b = k.claim("w-b")!;
  k.return_(b.id, yaml(passB(hash, [{ id: "cancel", members: frames.slice(0, 2), action: "Expose cancel first." }, { id: "rest", members: frames.slice(2) }], { [frames[4]!]: { T1: "generic" } })), "w-b");
  for (let i = 0; i < 2; i++) {
    const d = k.claim("w-a")!;
    k.return_(d.id, yaml({ problem_hash: hash, frame: d.label, verdict: "defend", response: "Users leave; cancel first.", revised_position: "Expose cancel and fail over to a different instance; the caller pays for the retry.", revised_falsifier: null, confidence: "high" }), "w-a");
  }
  // Record into a scratch evals tree so the repo's evals/ is untouched: point cfg.root at a copy.
  const { mkdirSync, cpSync } = await import("node:fs");
  const scratchRoot = join(tmp(), "repo");
  mkdirSync(join(scratchRoot, "evals"), { recursive: true });
  cpSync(join(cfg.root, "evals", "fixtures"), join(scratchRoot, "evals", "fixtures"), { recursive: true });
  const cfg2 = { ...cfg, root: scratchRoot };
  const r = recordRun(cfg2, k, "r1", { fixtureId: "001", name: "kernel-test" });
  assert.ok(existsSync(join(r.dest, "synthesis.md")));
  assert.ok(existsSync(join(r.dest, "critic", "pass-b.yaml")));
  assert.deepEqual(r.workers.sort(), ["w-a", "w-b"]);
  const expected = JSON.parse(readFileSync(join(r.dest, "expected.json"), "utf8")) as { outcome: string };
  assert.equal(expected.outcome, r.outcome);
  const readme = readFileSync(join(r.dest, "README.md"), "utf8");
  assert.match(readme, /Workers: w-a, w-b/);
  assert.match(readme, /Eval outcome as recorded: (PASS|FAIL)/);
  assert.throws(() => recordRun(cfg2, k, "r1", { fixtureId: "001", name: "kernel-test" }), /exists/);
});

test("a fenced return is stored as bare YAML, and a message with text outside the fence is kept whole beside it", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const t = k.claim("w")!;
  const body = yaml(artifact(t.label, hash));
  k.return_(t.id, "```yaml\n" + body + "```\n\nSources: [one](https://example.invalid)\n", "w");
  const stored = readFileSync(join(k.root, "r1", t.artifact_path), "utf8");
  assert.ok(!stored.includes("```"), "artifact must not carry the fence");
  assert.ok(!stored.includes("Sources:"), "artifact must hold only the YAML");
  const raw = readFileSync(join(k.root, "r1", t.artifact_path + ".raw.md"), "utf8");
  assert.match(raw, /Sources: \[one\]/);
  const t2 = k.claim("w")!;
  k.return_(t2.id, yaml(artifact(t2.label, hash)), "w");
  assert.equal(existsSync(join(k.root, "r1", t2.artifact_path + ".raw.md")), false, "no sidecar when nothing was outside the fence");
});

test("a pruned cluster member corroborates the action but does not hold the recommendation", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const frames: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w")!;
    frames.push(t.label);
    k.return_(t.id, yaml(artifact(t.label, hash)), "w");
  }
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  k.return_(k.claim("w")!.id, yaml(passA(hash, Object.keys(blindMap))), "w");
  const [a, b, c, d, e] = frames as [string, string, string, string, string];
  k.return_(
    k.claim("w")!.id,
    yaml(passB(hash, [{ id: "one", members: [a, b, c] }, { id: "two", members: [d, e] }], { [c]: { T1: "would be the same answer for any client" } })),
    "w",
  );
  for (let i = 0; i < 2; i++) {
    const t = k.claim("w")!;
    k.return_(t.id, yaml({ problem_hash: hash, frame: t.label, verdict: "defend", response: "Holds.", revised_position: "Do it.", revised_falsifier: null, confidence: "high" }), "w");
  }
  assert.equal(k.status("r1").state, "done");
  const s = k.result("r1").synthesis!;
  const held = s.match(/^Held by: (.*)$/m)![1]!;
  assert.match(held, new RegExp(`\\(pruned after corroborating: ${c}\\)`));
  assert.ok(!held.split("(")[0]!.includes(c), `pruned ${c} must not be listed as holding the recommendation`);
  assert.match(s, /it \*\*defended\*\*:/);
  assert.match(s, new RegExp(`- \\*\\*${c}\\*\\*:[\\s\\S]*traps: T1`), "the pruned member still ships in the pruned block");
});

test("a position that folds under its objection is reported as folded, never as a live singleton", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const frames: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w")!;
    frames.push(t.label);
    k.return_(t.id, yaml(artifact(t.label, hash)), "w");
  }
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  k.return_(k.claim("w")!.id, yaml(passA(hash, Object.keys(blindMap))), "w");
  const [a, b, c, d, e] = frames as [string, string, string, string, string];
  // Two singletons and one pair, so the pair holds the recommendation and both singletons deepen.
  k.return_(k.claim("w")!.id, yaml(passB(hash, [{ id: "pair", members: [a, b] }, { id: "lone1", members: [c] }, { id: "lone2", members: [d, e] }])), "w");
  const verdicts: Record<string, "defend" | "fold"> = {};
  for (;;) {
    const t = k.claim("w");
    if (!t) break;
    // The pair defends; every singleton folds.
    const verdict = t.label === a || t.label === b ? "defend" : "fold";
    verdicts[t.label] = verdict;
    k.return_(
      t.id,
      yaml({
        problem_hash: hash,
        frame: t.label,
        verdict,
        response: verdict === "fold" ? "The objection was right about the cost." : "Holds.",
        revised_position: verdict === "fold" ? null : "Do it.",
        revised_falsifier: null,
        confidence: "medium",
      }),
      "w",
    );
  }
  assert.equal(verdicts[c], "fold", "the singleton must have deepened");
  const s = k.result("r1").synthesis!;
  const live = s.slice(s.indexOf("## Live singletons"), s.indexOf("## Folded under objection"));
  const foldSec = s.slice(s.indexOf("## Folded under objection"), s.indexOf("## Pruned, with reason"));
  assert.ok(!live.includes(c), `folded ${c} must not be listed as a live singleton`);
  assert.match(live, /\(none\)/);
  assert.match(foldSec, new RegExp(`\\*\\*${c}\\*\\* gave up:`));
  assert.match(foldSec, new RegExp(`deepen/${c}\\.yaml`), "the fold points at its full concession");
});

test("two workers racing for the same run never receive the same task", async () => {
  // Real concurrency, not a fake clock: separate processes contending for the kernel lock.
  const root = join(tmp(), "root");
  const { k } = kernel({ clock: { t: Date.now() } });
  const realRoot = k.root;
  void root;
  k.submit(PROBLEM, { problem_class: "enumerate_options" }, { seed: 1, runId: "race", confirmed: true });
  const pending = k.status("race").tasks.pending;
  assert.ok(pending >= 5, `expected a wide run, got ${pending} tasks`);

  const claimOnce = (worker: string) =>
    new Promise<string | null>((resolve, reject) => {
      execFile(
        process.execPath,
        [join(process.cwd(), "dist", "src", "cli.js"), "os", "claim", "--worker", worker, "--run", "race", "--os-root", realRoot],
        (err, stdout) => {
          if (err && !stdout) return reject(err);
          const t = stdout.trim();
          if (!t || t === "null") return resolve(null);
          try {
            resolve((JSON.parse(t) as { id: string }).id);
          } catch {
            resolve(null);
          }
        },
      );
    });

  const workers = ["w1", "w2", "w3", "w4", "w5", "w6"];
  const claimed = (await Promise.all(workers.map(claimOnce))).filter((x): x is string => x !== null);
  const unique = new Set(claimed);
  assert.equal(unique.size, claimed.length, `a task was handed to two workers: ${claimed.join(", ")}`);
  assert.ok(claimed.length >= 5, `expected every pending task to be claimed once, got ${claimed.length}`);
});

test("a leased task cannot be returned without naming the worker that holds it", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const t = k.claim("w1")!;
  assert.throws(() => k.return_(t.id, yaml(artifact(t.label, hash))), /pass that worker id/);
  assert.throws(() => k.return_(t.id, yaml(artifact(t.label, hash)), "w2"), /leased to w1/);
  k.return_(t.id, yaml(artifact(t.label, hash)), "w1");
  assert.equal(k.status("r1").tasks.done, 1);
});

test("a lock whose owner process is gone is broken and the break is journalled", () => {
  const { k } = kernel();
  const lock = join(k.root, ".lock");
  mkdirSync(lock, { recursive: true });
  // pid 2^22 is above every default pid_max, so it names no live process.
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 4194304, host: hostname(), at: new Date().toISOString() }));
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  assert.equal(k.status("r1").state, "diverge");
  const journal = readFileSync(join(k.root, "journal.jsonl"), "utf8");
  assert.match(journal, /lock_broken/);
  assert.match(journal, /owner process is gone/);
});

test("a lock held by a live process is not broken, and the caller times out instead", () => {
  const { k } = kernel();
  const lock = join(k.root, ".lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }));
  assert.throws(() => k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true }), /lock held for more than 10s/);
});

test("an artifact returned under the wrong task is rejected, not filed under the wrong frame", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  const t1 = k.claim("w")!;
  const t2 = k.claim("w")!;
  assert.notEqual(t1.label, t2.label);
  // The worker's task-to-subagent map is wrong by one, so t2's output comes back under t1.
  assert.throws(
    () => k.return_(t1.id, yaml(artifact(t2.label, hash)), "w"),
    new RegExp(`asked for frame ${t1.label} but the artifact declares frame ${t2.label}`),
  );
  // The task is untouched and still claimable work, and nothing was written to t1's file.
  assert.equal(existsSync(join(k.root, "r1", t1.artifact_path)), false);
  k.return_(t1.id, yaml(artifact(t1.label, hash)), "w");
  assert.equal(k.status("r1").tasks.done, 1);
});

test("a critic pass returned for the other pass's task is rejected", () => {
  const { k } = kernel();
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  const hash = k.status("r1").problem_hash;
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w")!;
    k.return_(t.id, yaml(artifact(t.label, hash)), "w");
  }
  const blindMap = JSON.parse(readFileSync(join(k.root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  const passATask = k.claim("w")!;
  assert.equal(passATask.id.includes("critique_a"), true);
  const framesInRun = Object.values(blindMap);
  const passBDoc = passB(hash, [{ id: "one", members: framesInRun.slice(0, 3) }, { id: "two", members: framesInRun.slice(3) }]);
  assert.throws(() => k.return_(passATask.id, yaml(passBDoc), "w"), /is critic pass A but the artifact declares pass B/);
  k.return_(passATask.id, yaml(passA(hash, Object.keys(blindMap))), "w");
  assert.equal(k.status("r1").state, "critique_b");
});
