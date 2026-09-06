import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
