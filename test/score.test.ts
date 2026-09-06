import { test } from "node:test";
import assert from "node:assert/strict";
import { artifact, cfg, passB } from "./helpers.js";
import { scoreRun } from "../src/score.js";
import type { BranchValidation } from "../src/validate.js";

const H = "sha256:" + "a".repeat(64);
const ok = (frame: string, over = {}): BranchValidation => ({ ok: true, artifact: artifact(frame, H, over) });

test("a fired trap prunes even at a perfect pass A score", () => {
  const branches = [ok("LEDGER"), ok("MECHANIC"), ok("SABOTEUR")];
  const pb = passB(H, [{ id: "cancel", members: ["LEDGER", "MECHANIC"] }, { id: "consensus", members: ["SABOTEUR"] }], {
    SABOTEUR: { T1: "true for every HTTP client that ever existed" },
  });
  const r = scoreRun(cfg, branches, { LEDGER: 0.5, MECHANIC: 0.6, SABOTEUR: 1.0 }, pb, []);
  const s = r.frames.find((f) => f.frame === "SABOTEUR")!;
  assert.equal(s.status, "pruned");
  assert.deepEqual(s.fired.map((t) => t.trap), ["T1"]);
  assert.equal(r.frames.filter((f) => f.status === "survivor").length, 2);
  assert.equal(r.proceed, true);
});

test("a singleton is escalated, never pruned for being alone", () => {
  const branches = [ok("LEDGER"), ok("MECHANIC"), ok("SABOTEUR")];
  const pb = passB(H, [{ id: "cancel", members: ["LEDGER", "MECHANIC"] }, { id: "lone", members: ["SABOTEUR"] }]);
  const r = scoreRun(cfg, branches, null, pb, []);
  const lone = r.clusters.find((c) => c.id === "lone")!;
  assert.equal(lone.singleton, true);
  assert.equal(lone.representative, "SABOTEUR");
  assert.equal(r.frames.find((f) => f.frame === "SABOTEUR")!.status, "survivor");
  assert.ok(r.run_level.notes.some((n) => /singleton SABOTEUR escalated/.test(n)));
});

test("contract violation prunes without a critic verdict", () => {
  const branches: BranchValidation[] = [ok("LEDGER"), { ok: false, frame: "MECHANIC", violations: ["forecloses: too small"], raw: {} }, ok("SABOTEUR")];
  const pb = passB(H, [{ id: "a", members: ["LEDGER", "SABOTEUR"] }]);
  const r = scoreRun(cfg, branches, null, pb, []);
  const m = r.frames.find((f) => f.frame === "MECHANIC")!;
  assert.equal(m.status, "pruned");
  assert.deepEqual(m.violations, ["forecloses: too small"]);
});

test("monoculture: one cluster holds >= 80% of branches; deepen refused", () => {
  const frames = ["LEDGER", "MECHANIC", "SABOTEUR", "HORIZON", "MINIMALIST"];
  const pb = passB(H, [{ id: "same", members: frames.slice(0, 4) }, { id: "other", members: [frames[4]!] }]);
  const r = scoreRun(cfg, frames.map((f) => ok(f)), null, pb, []);
  assert.equal(r.run_level.monoculture, true);
  assert.equal(r.proceed, false);
});

test("scatter: n>=3 and no cluster of 2; deepen refused", () => {
  const frames = ["LEDGER", "MECHANIC", "SABOTEUR"];
  const pb = passB(H, frames.map((f) => ({ id: f.toLowerCase(), members: [f] })));
  const r = scoreRun(cfg, frames.map((f) => ok(f)), null, pb, []);
  assert.equal(r.run_level.scatter, true);
  assert.equal(r.proceed, false);
});

test("lint disagreement is reported, not resolved", () => {
  const branches = [ok("LEDGER"), ok("MECHANIC")];
  const pb = passB(H, [{ id: "a", members: ["LEDGER", "MECHANIC"] }]); // critic: nothing fired
  const r = scoreRun(cfg, branches, null, pb, [{ frame: "LEDGER", trap: "T5", evidence: "hedge" }]);
  const l = r.frames.find((f) => f.frame === "LEDGER")!;
  assert.equal(l.status, "survivor", "the lint alone does not prune");
  assert.equal(l.lint_disagreements.length, 1);
});

test("representative is the highest pass A survivor in the cluster", () => {
  const branches = [ok("LEDGER"), ok("MECHANIC"), ok("SABOTEUR")];
  const pb = passB(H, [{ id: "a", members: ["LEDGER", "MECHANIC", "SABOTEUR"] }], { MECHANIC: { T3: "citation only" } });
  const r = scoreRun(cfg, branches, { LEDGER: 0.4, MECHANIC: 0.9, SABOTEUR: 0.7 }, pb, []);
  assert.equal(r.clusters[0]!.representative, "SABOTEUR");
});
