import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { costReport, PHASES } from "../src/cost.js";
import { kernelStats } from "../src/os.js";

function recorded(runs: Record<string, { cost: unknown; plan?: unknown; os?: unknown }>): string {
  const dir = join(tmp(), "recorded");
  for (const [name, files] of Object.entries(runs)) {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "cost.json"), JSON.stringify(files.cost));
    if (files.plan) writeFileSync(join(d, "plan.json"), JSON.stringify(files.plan));
    if (files.os) writeFileSync(join(d, "os.json"), JSON.stringify(files.os));
  }
  return dir;
}

test("cost reports actual against the estimate the D5 gate showed", () => {
  const dir = recorded({
    a: { cost: { tokens: 300, by_phase: { diverge: 200, deepen: 100 } }, plan: { n: 5, estimate: { tokens_total: 100 } } },
    b: { cost: { tokens: 50 }, plan: { n: 3, estimate: { tokens_total: 100 } } },
  });
  const r = costReport(cfg, dir);
  assert.equal(r.runs.length, 2);
  assert.equal(r.total, 350);
  assert.equal(r.total_estimate, 200);
  assert.equal(r.runs.find((x) => x.run === "a")!.ratio, 3);
  assert.equal(r.runs.find((x) => x.run === "b")!.ratio, 0.5);
  assert.deepEqual(r.by_phase, { diverge: 200, deepen: 100 });
});

test("a run with no phase breakdown is named as unreconstructable, not silently dropped", () => {
  // The two pre-kernel recordings have a hand-written cost.json with a prose wall and no
  // by_phase. Averaging the phase shares over runs that have one and reporting it as the
  // corpus's would be the quiet version of this.
  const dir = recorded({ old: { cost: { tokens: 400, wall: "~45 min wall clock" } }, kernelled: { cost: { tokens: 400, by_phase: { diverge: 400 } } } });
  const r = costReport(cfg, dir);
  assert.deepEqual(r.unbroken, ["old"]);
  assert.match(r.text, /no phase breakdown: old\. Recorded before the kernel wrote one, and not reconstructable\./);
  assert.equal(r.by_phase.diverge, 400, "the run that has a breakdown still contributes its own");
});

test("per-frame tokens come from cost.json, or from an os.json still in the directory, and forward renamed ids", () => {
  const dir = recorded({
    fresh: { cost: { tokens: 30, by_frame: { LEDGER: 30 } } },
    // An older recording that kept os.json: per-task tokens are recoverable from it. END_USER is
    // SUPPLICANT's former id, and a corpus split across both names would double-count the frame.
    legacy: {
      cost: { tokens: 70 },
      os: {
        tasks: [
          { label: "END_USER", phase: "diverge", tokens: 40 },
          { label: "END_USER", phase: "deepen", tokens: 20 },
          { label: "pass-a", phase: "critique_a", tokens: 10 },
        ],
      },
    },
  });
  const r = costReport(cfg, dir);
  assert.deepEqual(r.runs.find((x) => x.run === "fresh")!.by_frame, { LEDGER: 30 });
  // Critic tasks are labelled by pass, not by frame, so they contribute nothing here.
  assert.deepEqual(r.runs.find((x) => x.run === "legacy")!.by_frame, { SUPPLICANT: 60 });
  assert.match(r.text, /SUPPLICANT/);
  assert.ok(!/END_USER/.test(r.text), "a renamed frame's spend is reported under one name");
});

test("cost says so rather than dividing by zero when there is nothing recorded", () => {
  const r = costReport(cfg, join(tmp(), "nothing-here"));
  assert.deepEqual(r.runs, []);
  assert.equal(r.total, 0);
  assert.match(r.text, /no run has recorded a cost yet/);
});

test("the recorded corpus shows the D5 estimate under-quoting every run", () => {
  // The finding, pinned. Every recorded run costs more than the gate quoted, and the gate is
  // the whole of D5's informed consent. If a future config change fixes the estimate this test
  // fails and should be rewritten to the new truth, not deleted.
  const r = costReport(cfg);
  const withEstimate = r.runs.filter((x) => x.ratio !== null);
  assert.ok(withEstimate.length >= 5, "the corpus lost its cost data");
  for (const x of withEstimate) assert.ok(x.ratio! > 1, `${x.run} came in at or under estimate; the finding has changed`);
  const mean = withEstimate.reduce((a, x) => a + x.ratio!, 0) / withEstimate.length;
  assert.ok(mean > 2, `mean ratio is ${mean.toFixed(2)}, no longer the under-quote this pins`);
});

// ---- kernel journal statistics -------------------------------------------------------------

function journal(lines: Record<string, unknown>[]): string {
  const root = join(tmp(), "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "journal.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return root;
}

test("kernel stats time each phase from its last claim to its return", () => {
  const root = journal([
    { at: "2026-09-06T00:00:00Z", event: "submitted", run_id: "r1" },
    { at: "2026-09-06T00:00:01Z", event: "confirmed", run_id: "r1" },
    { at: "2026-09-06T00:00:02Z", event: "claimed", run_id: "r1", task: "r1:diverge:LEDGER", worker: "w1" },
    // Expired and re-claimed. The attempt that produced the artifact is the one that counts.
    { at: "2026-09-06T00:01:02Z", event: "lease_expired", run_id: "r1", task: "r1:diverge:LEDGER" },
    { at: "2026-09-06T00:02:00Z", event: "claimed", run_id: "r1", task: "r1:diverge:LEDGER", worker: "w2" },
    { at: "2026-09-06T00:02:10Z", event: "returned", run_id: "r1", task: "r1:diverge:LEDGER" },
    { at: "2026-09-06T00:03:00Z", event: "done", run_id: "r1" },
  ]);
  const s = kernelStats(root);
  assert.equal(s.runs, 1);
  assert.deepEqual(s.by_outcome, { done: 1 });
  assert.equal(s.claims, 2);
  assert.equal(s.expiries, 1);
  assert.equal(s.expiry_rate, 0.5);
  assert.deepEqual(s.workers, ["w1", "w2"]);
  const diverge = s.phases.find((p) => p.phase === "diverge")!;
  assert.equal(diverge.tasks, 1);
  assert.equal(diverge.mean_seconds, 10, "timed from the second claim, not the first");
});

test("kernel stats survive a truncated final line and an empty journal", () => {
  const root = journal([{ at: "2026-09-06T00:00:00Z", event: "submitted", run_id: "r1" }]);
  writeFileSync(join(root, "journal.jsonl"), `{"at":"2026-09-06T00:00:00Z","event":"submitted","run_id":"r1"}\n{"at":"2026-09-0`);
  const s = kernelStats(root);
  assert.equal(s.runs, 1, "a half-written last line is ordinary on an append-only file");
  const empty = kernelStats(join(tmp(), "no-journal"));
  assert.equal(empty.runs, 0);
  assert.match(empty.text, /no journal yet/);
});

test("kernel stats name the longest task against the lease that has to cover it", () => {
  const root = journal([
    { at: "2026-09-06T00:00:00Z", event: "submitted", run_id: "r1" },
    { at: "2026-09-06T00:00:00Z", event: "claimed", run_id: "r1", task: "r1:critique_b:pass-b", worker: "w1" },
    { at: "2026-09-06T00:05:00Z", event: "returned", run_id: "r1", task: "r1:critique_b:pass-b" },
  ]);
  const s = kernelStats(root);
  assert.equal(s.phases.find((p) => p.phase === "critique_b")!.max_seconds, 300);
  assert.match(s.text, /took 300s \(critique_b\)/);
  assert.match(s.text, /the default is 900s/);
  // Every phase the timing table can report is a phase a task can be in.
  for (const p of s.phases) assert.ok((PHASES as readonly string[]).includes(p.phase));
});
