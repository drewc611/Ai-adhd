import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { cfg, tmp } from "./helpers.js";
import { dimensionCorrelation, weightSensitivity } from "../src/learn.js";

const DIMS = cfg.rubric.dimensions.map((d) => d.id);

/**
 * A recorded run as `learn` reads one: critic/pass-a.yaml, critic/blind-map.json, score.json,
 * and the expected.json that says whether it is a real run or a negative control.
 */
function recordRun(
  root: string,
  id: string,
  artifacts: Record<string, { frame: string; scores?: Record<string, number>; base?: number }>,
  clusters: { id: string; members: string[]; survivors: string[] }[] = [],
  opts: { control?: boolean; fence?: boolean } = {},
) {
  const dir = join(root, id);
  mkdirSync(join(dir, "critic"), { recursive: true });

  const scores: Record<string, Record<string, { score: number; evidence: string }>> = {};
  const blindMap: Record<string, string> = {};
  for (const [letter, a] of Object.entries(artifacts)) {
    blindMap[letter] = a.frame;
    scores[letter] = {};
    for (const d of DIMS) scores[letter]![d] = { score: a.scores?.[d] ?? a.base ?? 2, evidence: `${letter}.${d}` };
  }

  const body = stringify({ problem_hash: `hash-${id}`, pass: "A", scores });
  writeFileSync(join(dir, "critic", "pass-a.yaml"), opts.fence ? "```yaml\n" + body + "```\n" : body);
  writeFileSync(join(dir, "critic", "blind-map.json"), JSON.stringify(blindMap));
  writeFileSync(
    join(dir, "score.json"),
    JSON.stringify({
      n: Object.keys(artifacts).length,
      frames: [],
      clusters: clusters.map((c) => ({
        ...c,
        action: "act",
        singleton: c.members.length === 1,
        strongest_objection: null,
        representative: c.survivors[0] ?? null,
        mean_pass_a: 0.8,
      })),
      run_level: { monoculture: false, scatter: false, notes: [] },
      proceed: true,
    }),
  );
  writeFileSync(join(dir, "expected.json"), JSON.stringify({ outcome: "pass", control: opts.control ?? false }));
  return dir;
}

test("sensitivity reports nothing when no cluster ever had a choice to make", () => {
  const root = tmp();
  recordRun(root, "001", { A: { frame: "LEDGER" }, B: { frame: "MECHANIC" } }, [
    { id: "c1", members: ["LEDGER"], survivors: ["LEDGER"] },
    { id: "c2", members: ["MECHANIC"], survivors: ["MECHANIC"] },
  ]);
  const r = weightSensitivity(cfg, root);
  assert.equal(r.runs, 1);
  assert.equal(r.cluster_decisions, 0, "single survivor clusters must not count as decisions");
  assert.equal(r.flips.length, 0);
  assert.match(r.text, /has never actually/);
});

test("a representative that a one-point weight move changes is reported as a flip", () => {
  const root = tmp();
  // Weighted totals under shipped weights (reasoning_carries 1, substance 2): LEDGER 3, MECHANIC 4.
  // Move reasoning_carries to 2 and LEDGER takes it at 6. The rubric did not choose; the weight did.
  recordRun(
    root,
    "001",
    {
      A: { frame: "LEDGER", base: 0, scores: { reasoning_carries: 3 } },
      B: { frame: "MECHANIC", base: 0, scores: { substance: 2 } },
    },
    [{ id: "c1", members: ["LEDGER", "MECHANIC"], survivors: ["LEDGER", "MECHANIC"] }],
  );
  const r = weightSensitivity(cfg, root);
  assert.equal(r.cluster_decisions, 1);
  assert.ok(r.flips.length > 0, "expected at least one flip");
  assert.ok(
    r.flips.some((f) => f.under_shipped === "MECHANIC" && f.under_perturbed === "LEDGER"),
    "shipped weights pick MECHANIC; a perturbation should hand it to LEDGER",
  );
  assert.ok(r.by_dimension.some((d) => d.dimension === "reasoning_carries" && d.flips > 0));
  assert.match(r.text, /chosen by the weights/);
});

test("a survivor that dominates on every dimension never flips", () => {
  const root = tmp();
  recordRun(
    root,
    "001",
    { A: { frame: "LEDGER", base: 3 }, B: { frame: "MECHANIC", base: 1 } },
    [{ id: "c1", members: ["LEDGER", "MECHANIC"], survivors: ["LEDGER", "MECHANIC"] }],
  );
  const r = weightSensitivity(cfg, root);
  assert.equal(r.cluster_decisions, 1);
  assert.equal(r.flips.length, 0);
  assert.match(r.text, /not the weights/);
});

test("negative controls are excluded from both reports", () => {
  const root = tmp();
  recordRun(root, "001", { A: { frame: "LEDGER" } }, [{ id: "c1", members: ["LEDGER"], survivors: ["LEDGER"] }]);
  recordRun(root, "002-control", { A: { frame: "MECHANIC" } }, [], { control: true });
  assert.equal(weightSensitivity(cfg, root).runs, 1);
  assert.equal(dimensionCorrelation(cfg, root).n, 1, "one artifact, from the real run only");
});

test("pass A wrapped in a code fence still loads", () => {
  const root = tmp();
  recordRun(root, "001", { A: { frame: "LEDGER" }, B: { frame: "MECHANIC" } }, [], { fence: true });
  assert.equal(dimensionCorrelation(cfg, root).n, 2);
});

test("two dimensions that move together are flagged as one dimension charging twice", () => {
  const root = tmp();
  // committal and substance track each other exactly across six artifacts; nothing else varies.
  const rows = [0, 1, 2, 3, 2, 1];
  const artifacts: Record<string, { frame: string; base: number; scores: Record<string, number> }> = {};
  const frames = ["LEDGER", "MECHANIC", "SABOTEUR", "MINIMALIST", "HORIZON", "END_USER"];
  rows.forEach((v, i) => {
    artifacts[String.fromCharCode(65 + i)] = { frame: frames[i]!, base: 1, scores: { committal: v, substance: v } };
  });
  recordRun(root, "001", artifacts);
  const r = dimensionCorrelation(cfg, root);
  assert.equal(r.n, 6);
  const pair = r.pairs.find((p) => (p.a === "committal" && p.b === "substance") || (p.a === "substance" && p.b === "committal"));
  assert.ok(pair, "the pair should be present");
  assert.ok(Math.abs(pair!.r - 1) < 1e-9, `expected r=1, got ${pair!.r}`);
  assert.match(r.text, /moves together/);
  assert.match(r.text, /1 pair\(s\) at \|r\| >= 0\.8/);
});

test("a dimension that never varies is reported as deciding nothing", () => {
  const root = tmp();
  recordRun(root, "001", {
    A: { frame: "LEDGER", base: 0, scores: { committal: 1 } },
    B: { frame: "MECHANIC", base: 0, scores: { committal: 2 } },
    C: { frame: "SABOTEUR", base: 0, scores: { committal: 3 } },
  });
  const r = dimensionCorrelation(cfg, root);
  const flat = r.variance.filter((v) => v.sd === 0).map((v) => v.dimension);
  assert.ok(flat.includes("substance"), "substance was 0 in every artifact");
  assert.ok(!flat.includes("committal"));
  assert.match(r.text, /never varies, so it decides nothing/);
  assert.match(r.text, /carry weight and change no outcome/);
});

/**
 * The finding correlation cannot make. A dimension that scores the maximum on all but one
 * artifact varies, so it is not flat, and correlates with nothing, so no pair flags it. It still
 * adds a near-constant to every total: weight spent, ranking unmoved.
 */
test("a dimension pinned at the ceiling is flagged even though it varies", () => {
  const root = tmp();
  const artifacts: Record<string, { frame: string; base: number; scores: Record<string, number> }> = {};
  const frames = ["LEDGER", "MECHANIC", "SABOTEUR", "MINIMALIST", "HORIZON", "END_USER", "HORIZON", "PRIOR_ART", "DOOR_KEEPER", "MINIMALIST"];
  frames.forEach((f, i) => {
    artifacts[String.fromCharCode(65 + i)] = { frame: f, base: i % 4, scores: { foreclosure: i === 0 ? 2 : 3 } };
  });
  recordRun(root, "001", artifacts);
  const r = dimensionCorrelation(cfg, root);
  const fore = r.variance.find((v) => v.dimension === "foreclosure")!;
  assert.ok(fore.sd > 0, "it varies, so the flat check will not catch it");
  assert.equal(fore.at_ceiling, 0.9);
  assert.equal(fore.distinct, 2);
  assert.match(r.text, /near ceiling: carries weight, separates almost nothing/);
  assert.match(r.text, /foreclosure 90%/);
});

test("a clean rubric reports no finding rather than inventing one", () => {
  const root = tmp();
  // One column per dimension, eight artifacts. Every column spans the scale, none sits at the
  // ceiling, and the strongest pair is r=0.53. Hand-picked, so the test fails on a real change
  // to the flagging rules rather than on the luck of a generator.
  const columns: number[][] = [
    [3, 3, 0, 2, 3, 2, 2, 0],
    [1, 2, 1, 3, 2, 2, 0, 1],
    [0, 3, 2, 1, 0, 3, 2, 0],
    [1, 3, 2, 2, 1, 0, 3, 1],
    [3, 3, 2, 0, 2, 1, 1, 3],
    [2, 0, 2, 1, 0, 2, 3, 0],
    [0, 1, 1, 2, 3, 3, 2, 3],
    [0, 0, 2, 0, 1, 2, 2, 1],
    [2, 2, 0, 0, 0, 2, 3, 1],
  ];
  assert.equal(columns.length, DIMS.length, "one column per rubric dimension");
  const artifacts: Record<string, { frame: string; scores: Record<string, number> }> = {};
  const frames = ["LEDGER", "MECHANIC", "SABOTEUR", "MINIMALIST", "HORIZON", "END_USER", "PRIOR_ART", "DOOR_KEEPER"];
  frames.forEach((f, i) => {
    const scores: Record<string, number> = {};
    DIMS.forEach((d, j) => (scores[d] = columns[j]![i]!));
    artifacts[String.fromCharCode(65 + i)] = { frame: f, scores };
  });
  recordRun(root, "001", artifacts);
  const r = dimensionCorrelation(cfg, root);
  assert.equal(r.n, 8);
  assert.ok(r.pairs.every((p) => Math.abs(p.r) < 0.8), `no pair should be flagged, strongest was ${r.pairs[0]?.r.toFixed(2)}`);
  assert.ok(r.variance.every((v) => v.sd > 0 && v.at_ceiling < 0.85));
  assert.match(r.text, /No pair moves together/);
});

test("an empty corpus reports nothing instead of throwing", () => {
  const root = tmp();
  const s = weightSensitivity(cfg, root);
  assert.equal(s.runs, 0);
  assert.equal(s.flips.length, 0);
  const c = dimensionCorrelation(cfg, join(root, "does-not-exist"));
  assert.equal(c.n, 0);
});
