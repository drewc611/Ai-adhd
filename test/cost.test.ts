import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { costReport, PHASES } from "../src/cost.js";
import { compile, previewText } from "../src/compile.js";
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

test("every run quoted under the old estimate over-ran it, and the first run quoted under D32 did not", () => {
  // This test pinned "the estimate under-quotes every run" and left instructions: if a config
  // change fixes the estimate, rewrite it to the new truth rather than deleting it. D32 is that
  // change — `tokens_per_branch_estimate` 12,000 -> 51,000 — and this is the new truth.
  //
  // Seven runs were quoted 156,000 and cost 407,407 to 519,482, a ratio of 2.6x to 3.3x. That was
  // the finding, and it is still in the corpus because a recorded estimate is what that run was
  // actually quoted and never changes. `001-seed3` was quoted 520,200 and cost 485,412: 0.9x, the
  // first run in the corpus to come in under its own gate, and under by 6.7%.
  //
  // The "up to" wording in the preview is what that buys. A gate set to the mean would be exceeded
  // about half the time; set to the observed maximum it is exceeded rarely, and a user who consents
  // to a ceiling and is billed less than it has not been misled.
  const r = costReport(cfg);
  const withEstimate = r.runs.filter((x) => x.ratio !== null);
  assert.ok(withEstimate.length >= 8, "the corpus lost its cost data");

  const old = withEstimate.filter((x) => x.estimate === 156000);
  const recalibrated = withEstimate.filter((x) => x.estimate !== 156000);
  assert.ok(old.length >= 7, `expected the seven pre-D32 runs, found ${old.length}`);
  for (const x of old) assert.ok(x.ratio! > 1, `${x.run} was quoted 156,000 and no longer over-ran it`);
  const mean = old.reduce((a, x) => a + x.ratio!, 0) / old.length;
  assert.ok(mean > 2, `mean ratio over the pre-D32 runs is ${mean.toFixed(2)}, no longer the under-quote this pins`);

  // Post-D32 the quote scales with n, so there is one figure per branch count rather than one
  // figure. n=5 is 520,200 and n=7 is 728,280; both are `tokens_per_branch_estimate` times the
  // same phase model, so a new n adds a value here rather than breaking the claim.
  assert.ok(recalibrated.length >= 1, "no run has been quoted under the recalibrated estimate yet");
  const quotes = new Map<number, number>();
  for (const x of recalibrated) {
    assert.ok(x.n !== null, `${x.run} has a recalibrated estimate and no branch count`);
    const seen = quotes.get(x.n!);
    if (seen === undefined) quotes.set(x.n!, x.estimate!);
    else assert.equal(x.estimate, seen, `two runs at n=${x.n} were quoted different figures`);
    assert.ok(x.ratio! <= 1, `${x.run} over-ran the recalibrated gate at ${x.ratio!.toFixed(1)}x, so D32 is not yet enough`);
  }
  assert.equal(quotes.get(5), 520200, "the n=5 quote moved");
  // The wide path's first two runs came in at 0.8x, which is the same shape as n=5's 0.9x rather
  // than a new regime, so `tokens_per_branch_estimate` holds across branch counts and not just at
  // the one it was fitted on. `001-seed3-repeat` reads 0.5x and is not evidence either way: its
  // five diverge tasks ran in the foreground and the harness reported no count for them, which its
  // own cost.json says.
  if (quotes.has(7)) assert.equal(quotes.get(7), 728280, "the n=7 quote moved");
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

/**
 * D32 chose the observed maximum over the mean, and the reason is that a consent gate is a promise
 * rather than a statistic: a user who agreed to 156,000 tokens and spent 519,482 was misled, and
 * being misled upward costs them nothing. So the property to hold is not "the estimate is accurate"
 * but "the estimate is never exceeded by a run on record".
 *
 * This fails when a new run comes in above the quote, which is exactly when the figure needs raising
 * again — and it fails loudly rather than leaving `adhd cost` to mention a drifting mean.
 */
test("the D5 gate never quotes less than the worst run on record", () => {
  const report = costReport(cfg);
  const withEstimate = report.runs.filter((r) => r.ratio !== null);
  assert.ok(withEstimate.length >= 7, "there should be recorded runs to check against");

  /*
   * The comparison is per branch count, and it has to be. The quote scales with n, so measuring an
   * n=5 quote against the worst run at any n asks the five-branch gate to cover a seven-branch run.
   * E10's two n=7 runs are what found that: both came in under their own 728,280 quote at 0.8x,
   * and the test still failed because it was holding the n=5 figure against them.
   */
  const classFor = (n: number) => (n === 7 ? "enumerate_options" : "design_decision");
  const problemFor = (n: number) =>
    n === 7 ? "We run background jobs on a cron and it has started overlapping. What are the options?" : "What timeouts should I set on this HTTP client?";
  for (const n of new Set(withEstimate.map((r) => r.n).filter((x): x is number => x !== null))) {
    const worstAtN = Math.max(...withEstimate.filter((r) => r.n === n).map((r) => r.tokens));
    const c = compile(cfg, problemFor(n), { problem_class: classFor(n) }, { seed: 1 });
    if (c.kind !== "plan") throw new Error("expected a plan");
    if (c.plan.branches.length !== n) continue;
    assert.ok(
      c.plan.estimate.tokens_total >= worstAtN,
      `the gate quotes ${c.plan.estimate.tokens_total.toLocaleString()} for n=${n} against a recorded run of ${worstAtN.toLocaleString()}`,
    );
  }
});

test("the estimate's shape matches the measured phase split, not an invented one", () => {
  // `adhd cost` reports 49% diverge, 30% critique, 21% deepen. The old model used tpb*n for the
  // critic and tpb*ceil(n/2) for deepen, which is 38/38/23 — it over-weighted the critic by a third.
  // A total that is right with components that are wrong tells a user the wrong thing about which
  // phase to stop before.
  const c = compile(cfg, "What timeouts should I set on this HTTP client?", { problem_class: "design_decision" }, { seed: 1 });
  if (c.kind !== "plan") throw new Error("expected a plan");
  const e = c.plan.estimate;
  const share = (part: number) => part / e.tokens_total;
  assert.ok(Math.abs(share(e.tokens_branches) - 0.49) < 0.02, `diverge share is ${share(e.tokens_branches).toFixed(2)}, measured 0.49`);
  assert.ok(Math.abs(share(e.tokens_critic) - 0.30) < 0.02, `critique share is ${share(e.tokens_critic).toFixed(2)}, measured 0.30`);
  assert.ok(Math.abs(share(e.tokens_deepen) - 0.21) < 0.02, `deepen share is ${share(e.tokens_deepen).toFixed(2)}, measured 0.21`);
});

test("the preview says up to, because the figure is a ceiling and not an average", () => {
  const c = compile(cfg, "What timeouts should I set on this HTTP client?", { problem_class: "design_decision" }, { seed: 1 });
  if (c.kind !== "plan") throw new Error("expected a plan");
  const preview = previewText(c);
  assert.match(preview, /estimate: up to/);
  assert.ok(!/order of magnitude/.test(preview), "the old label described the old figure, which was one");
  assert.match(preview, /Nothing has been spent/);
});
