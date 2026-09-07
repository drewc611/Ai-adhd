import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { cfg, tmp } from "./helpers.js";
import { dimensionCorrelation, interRater, interRaterCorpus, raterPanel, weightSensitivity } from "../src/learn.js";

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

/** A second scoring of one pack, written where `interRater` expects to be pointed at it. */
function writeSecond(dir: string, artifacts: Record<string, Record<string, number> | undefined>, hash?: string) {
  const scores: Record<string, Record<string, { score: number; evidence: string }>> = {};
  for (const [letter, over] of Object.entries(artifacts)) {
    if (!over) continue;
    scores[letter] = {};
    for (const d of DIMS) scores[letter]![d] = { score: over[d] ?? 2, evidence: `second ${letter}.${d}` };
  }
  const p = join(dir, "second.yaml");
  writeFileSync(p, stringify({ problem_hash: hash ?? "hash-001", pass: "A", scores }));
  return p;
}

test("two identical scorings agree on every cell and change nothing", () => {
  const root = tmp();
  const dir = recordRun(
    root,
    "001",
    { A: { frame: "LEDGER", base: 3 }, B: { frame: "MECHANIC", base: 1 } },
    [{ id: "c1", members: ["LEDGER", "MECHANIC"], survivors: ["LEDGER", "MECHANIC"] }],
  );
  const r = interRater(cfg, dir, writeSecond(root, { A: Object.fromEntries(DIMS.map((d) => [d, 3])), B: Object.fromEntries(DIMS.map((d) => [d, 1])) }));
  assert.equal(r.artifacts, 2);
  assert.equal(r.cells, DIMS.length * 2);
  assert.equal(r.exact, 1);
  assert.equal(r.ranking_changed, false);
  assert.equal(r.representative_changes.length, 0);
  assert.match(r.text, /kept its representative/);
});

test("a disagreement that reverses a contested cluster is reported as a changed representative", () => {
  const root = tmp();
  const dir = recordRun(
    root,
    "001",
    { A: { frame: "LEDGER", base: 3 }, B: { frame: "MECHANIC", base: 1 } },
    [{ id: "c1", members: ["LEDGER", "MECHANIC"], survivors: ["LEDGER", "MECHANIC"] }],
  );
  // The second critic reads the pack the other way round.
  const r = interRater(cfg, dir, writeSecond(root, { A: Object.fromEntries(DIMS.map((d) => [d, 1])), B: Object.fromEntries(DIMS.map((d) => [d, 3])) }));
  assert.equal(r.exact, 0);
  assert.equal(r.ranking_changed, true);
  assert.deepEqual(r.representative_changes, [{ cluster: "c1", a: "LEDGER", b: "MECHANIC" }]);
  assert.match(r.text, /depends on which critic read it/);
});

/**
 * The case the recorded corpus actually produced. Clusters absorb cross-cluster rank
 * disagreement, so a changed ranking is not by itself a changed outcome.
 */
test("a ranking change across clusters leaves every representative standing", () => {
  const root = tmp();
  const dir = recordRun(
    root,
    "001",
    { A: { frame: "LEDGER", base: 3 }, B: { frame: "MECHANIC", base: 2 }, C: { frame: "HORIZON", base: 1 } },
    [
      { id: "c1", members: ["LEDGER", "MECHANIC"], survivors: ["LEDGER", "MECHANIC"] },
      { id: "c2", members: ["HORIZON"], survivors: ["HORIZON"] },
    ],
  );
  // HORIZON climbs past both, but it is a singleton: it goes to deepen either way.
  const r = interRater(
    cfg,
    dir,
    writeSecond(root, {
      A: Object.fromEntries(DIMS.map((d) => [d, 2])),
      B: Object.fromEntries(DIMS.map((d) => [d, 1])),
      C: Object.fromEntries(DIMS.map((d) => [d, 3])),
    }),
  );
  assert.equal(r.ranking_changed, true);
  assert.equal(r.representative_changes.length, 0);
  assert.match(r.text, /cross-cluster order decides nothing/);
});

test("scoring a different problem is refused rather than compared", () => {
  const root = tmp();
  const dir = recordRun(root, "001", { A: { frame: "LEDGER" } });
  assert.throws(() => interRater(cfg, dir, writeSecond(root, { A: undefined, B: {} }, "hash-other")), /problem_hash mismatch/);
});

test("an incomplete second pack is refused rather than compared on what is there", () => {
  const root = tmp();
  const dir = recordRun(root, "001", { A: { frame: "LEDGER" }, B: { frame: "MECHANIC" } });
  assert.throws(() => interRater(cfg, dir, writeSecond(root, { A: {} })), /missing artifact\(s\) B/);
});

test("the recorded second scoring of 003 is readable and still says what D8 records", () => {
  const runDir = join(cfg.root, "evals", "recorded", "003-kernel-strategy");
  const r = interRater(cfg, runDir, join(runDir, "critic", "pass-a.rater2.yaml"));
  assert.equal(r.artifacts, 5);
  assert.equal(r.cells, 45);
  assert.ok(r.exact > 0.8, `exact agreement was ${r.exact}`);
  assert.equal(r.within_one, 1, "no cell disagreed by more than one point");
  assert.equal(r.ranking_changed, true);
  assert.equal(r.representative_changes.length, 0, "the contested cluster kept DOOR_KEEPER");
});

test("a corpus with no second scoring says how to make one instead of printing zeroes", () => {
  const root = tmp();
  recordRun(root, "001", { A: { frame: "LEDGER" } });
  const r = interRaterCorpus(cfg, root);
  assert.equal(r.runs.length, 0);
  assert.equal(r.cells, 0);
  assert.match(r.text, /pass-a\.rater2\.yaml/);
  assert.match(r.text, /separate context window/);
});

/**
 * Pooling is by cell, not by mean of run means. A three-artifact pack and a five-artifact pack
 * are not equal evidence, and averaging percentages would pretend they are.
 */
test("corpus agreement pools by cell rather than averaging run percentages", () => {
  const root = tmp();
  const big = recordRun(root, "001", {
    A: { frame: "LEDGER", base: 2 },
    B: { frame: "MECHANIC", base: 2 },
    C: { frame: "HORIZON", base: 2 },
    D: { frame: "SABOTEUR", base: 2 },
  });
  const small = recordRun(root, "002", { A: { frame: "LEDGER", base: 2 } }, [], {});
  // Four artifacts scored identically, one artifact disagreeing on every dimension.
  const same = Object.fromEntries(DIMS.map((d) => [d, 2]));
  writeFileSync(
    join(big, "critic", "pass-a.rater2.yaml"),
    stringify({ problem_hash: "hash-001", pass: "A", scores: Object.fromEntries(["A", "B", "C", "D"].map((l) => [l, Object.fromEntries(DIMS.map((d) => [d, { score: same[d], evidence: "e" }]))])) }),
  );
  writeFileSync(
    join(small, "critic", "pass-a.rater2.yaml"),
    stringify({ problem_hash: "hash-002", pass: "A", scores: { A: Object.fromEntries(DIMS.map((d) => [d, { score: 3, evidence: "e" }])) } }),
  );
  const r = interRaterCorpus(cfg, root);
  assert.equal(r.runs.length, 2);
  assert.equal(r.cells, DIMS.length * 5);
  // Cell-pooled: 36 of 45 agree. A mean of run means would give 50%.
  assert.ok(Math.abs(r.exact - 36 / 45) < 1e-9, `expected 0.8, got ${r.exact}`);
  assert.ok(r.by_dimension.every((d) => d.n === 5));
});

test("the corpus rollup names the runs whose representative would have changed", () => {
  const root = tmp();
  const dir = recordRun(
    root,
    "001",
    { A: { frame: "LEDGER", base: 3 }, B: { frame: "MECHANIC", base: 1 } },
    [{ id: "c1", members: ["LEDGER", "MECHANIC"], survivors: ["LEDGER", "MECHANIC"] }],
  );
  writeFileSync(
    join(dir, "critic", "pass-a.rater2.yaml"),
    stringify({
      problem_hash: "hash-001",
      pass: "A",
      scores: {
        A: Object.fromEntries(DIMS.map((d) => [d, { score: 1, evidence: "e" }])),
        B: Object.fromEntries(DIMS.map((d) => [d, { score: 3, evidence: "e" }])),
      },
    }),
  );
  const r = interRaterCorpus(cfg, root);
  assert.deepEqual(r.runs_with_changed_representative, ["001"]);
  assert.match(r.text, /would have sent a different position to deepen/);
  assert.match(r.text, /LEDGER->MECHANIC/);
});

/**
 * Pinned to the recorded corpus so the figures quoted in D8 fail the suite if they stop being
 * true. Not pinned to the exact percentage, which would break on the next second scoring added.
 */
test("the recorded corpus rollup reads every second scoring on disk", () => {
  const r = interRaterCorpus(cfg);
  assert.ok(r.runs.length >= 5, `expected at least 5 runs with a second scoring, got ${r.runs.length}`);
  assert.ok(r.cells >= 225);
  assert.ok(r.exact > 0.7, `pooled exact agreement was ${r.exact}`);
  assert.equal(r.within_one, 1, "no cell in the corpus disagreed by more than one point");
  assert.ok(
    r.by_dimension.every((d) => d.n === r.runs.reduce((s, x) => s + x.report.artifacts, 0)),
    "every dimension should be scored on every artifact",
  );
  // The two dimensions the correlation report finds pinned at the ceiling are also the two the
  // critics agree on most. They agree because almost every artifact gets a 3.
  const worst = r.by_dimension[0]!;
  const best = r.by_dimension.slice(-2).map((d) => d.dimension);
  assert.deepEqual(new Set(best), new Set(["foreclosure", "reasoning_carries"]));
  assert.equal(worst.dimension, "specificity", "the highest weighted dimension has the worst agreement");
  // One run in the corpus would have sent a different position to deepen. This is the finding
  // the tool exists to catch, and it is recorded rather than smoothed over.
  assert.deepEqual(r.runs_with_changed_representative, ["002-kernel-enduser"]);
});

test("every recorded run's ranking moved between critics and only one outcome did", () => {
  const r = interRaterCorpus(cfg);
  assert.ok(
    r.runs.every((x) => x.report.ranking_changed),
    "all five rankings changed",
  );
  assert.equal(r.runs.filter((x) => x.report.representative_changes.length).length, 1);
});

/** Write pass-a.raterN.yaml beside a run's shipped scoring. */
function addRater(dir: string, n: number, artifacts: Record<string, number>, hash = "hash-001") {
  writeFileSync(
    join(dir, "critic", `pass-a.rater${n}.yaml`),
    stringify({
      problem_hash: hash,
      pass: "A",
      scores: Object.fromEntries(Object.entries(artifacts).map(([l, v]) => [l, Object.fromEntries(DIMS.map((d) => [d, { score: v, evidence: "e" }]))])),
    }),
  );
}

function contestedRun(root: string, id = "001") {
  return recordRun(
    root,
    id,
    { A: { frame: "LEDGER", base: 3 }, B: { frame: "MECHANIC", base: 1 } },
    [{ id: "c1", members: ["LEDGER", "MECHANIC"], survivors: ["LEDGER", "MECHANIC"] }],
  );
}

test("a panel where every critic agrees says the rubric determines the cluster", () => {
  const root = tmp();
  const dir = contestedRun(root);
  addRater(dir, 2, { A: 3, B: 2 });
  addRater(dir, 3, { A: 2, B: 1 });
  const r = raterPanel(cfg, dir);
  assert.deepEqual(r.raters, ["shipped", "rater2", "rater3"]);
  assert.equal(r.clusters.length, 1);
  assert.equal(r.clusters[0]!.unanimous, true);
  assert.deepEqual(r.clusters[0]!.picks, { shipped: "LEDGER", rater2: "LEDGER", rater3: "LEDGER" });
  assert.match(r.text, /unanimous: the rubric determines this one/);
});

/**
 * The distinction two raters cannot make. A 2-1 majority means the rubric settles it and one
 * critic read it differently; an even split means the rubric does not settle it at all.
 */
test("a 2-1 majority names the critic that read it differently", () => {
  const root = tmp();
  const dir = contestedRun(root);
  addRater(dir, 2, { A: 3, B: 1 });
  addRater(dir, 3, { A: 1, B: 3 });
  const r = raterPanel(cfg, dir);
  assert.equal(r.clusters[0]!.unanimous, false);
  assert.deepEqual(r.clusters[0]!.split, [
    { frame: "LEDGER", raters: ["shipped", "rater2"] },
    { frame: "MECHANIC", raters: ["rater3"] },
  ]);
  assert.match(r.text, /2-1: a majority, and rater3 read it differently/);
});

test("an even split is reported as the rubric's problem, not a critic's", () => {
  const root = tmp();
  const dir = contestedRun(root);
  addRater(dir, 2, { A: 1, B: 3 });
  const r = raterPanel(cfg, dir);
  assert.equal(r.raters.length, 2);
  assert.equal(r.clusters[0]!.unanimous, false);
  assert.match(r.text, /even split: the rubric does not determine the answer/);
  assert.match(r.text, /This is the rubric, not the critic/);
});

test("panel spread is measured across every critic, not pairwise", () => {
  const root = tmp();
  const dir = contestedRun(root);
  addRater(dir, 2, { A: 2, B: 1 });
  addRater(dir, 3, { A: 1, B: 1 });
  const r = raterPanel(cfg, dir);
  // A was scored 3, 2 and 1: a spread of 2, which no pair of critics would show as more than 1.
  assert.equal(r.max_spread, 2);
  assert.ok(r.by_dimension.every((d) => d.max_spread === 2));
  // B was 1 from all three, so half the cells are unanimous and half span two points.
  assert.equal(r.unanimous_cells, 0.5);
});

test("a panel scoring a different problem is refused", () => {
  const root = tmp();
  const dir = contestedRun(root);
  addRater(dir, 2, { A: 2, B: 2 }, "hash-other");
  assert.throws(() => raterPanel(cfg, dir), /problem_hash mismatch on rater2/);
});

test("a run with no second scoring is still a panel of one", () => {
  const root = tmp();
  const dir = contestedRun(root);
  const r = raterPanel(cfg, dir);
  assert.deepEqual(r.raters, ["shipped"]);
  assert.equal(r.unanimous_cells, 1, "one critic agrees with itself on every cell");
  assert.equal(r.clusters[0]!.unanimous, true);
});

test("rater files are ordered numerically, not by string", () => {
  const root = tmp();
  const dir = contestedRun(root);
  for (const n of [10, 2, 3]) addRater(dir, n, { A: 3, B: 1 });
  assert.deepEqual(raterPanel(cfg, dir).raters, ["shipped", "rater2", "rater3", "rater10"]);
});

test("an exact tie is reported as no decision, not a close one", () => {
  const root = tmp();
  const dir = contestedRun(root);
  // Both survivors scored identically: `pick` falls through to localeCompare.
  addRater(dir, 2, { A: 2, B: 2 });
  const r = raterPanel(cfg, dir);
  const c = r.clusters[0]!;
  assert.deepEqual(c.ties, ["rater2"]);
  assert.equal(c.margins.rater2, 0);
  assert.equal(c.picks.rater2, "LEDGER", "LEDGER sorts before MECHANIC");
  assert.match(r.text, /EXACT TIE for rater2/);
  assert.match(r.text, /sorts first alphabetically. That is not a decision/);
});

/**
 * Margins are ratios of small integers, so a margin of exactly one anchor point lands either
 * side of the bound in floating point. It was silently unflagged before an epsilon was added.
 */
test("a margin of exactly one anchor point is flagged despite float representation", () => {
  const r = weightSensitivity(cfg);
  const minWeight = Math.min(...cfg.rubric.dimensions.map((d) => d.weight));
  const step = minWeight / cfg.rubric.dimensions.reduce((sum, d) => sum + d.weight * cfg.rubric.scale.max, 0);
  const oneAnchor = r.margins.filter((m) => Math.abs(m.margin - step) < 1e-9);
  assert.ok(oneAnchor.length >= 2, `expected at least two one-anchor margins, got ${oneAnchor.length}`);
  const flagged = (r.text.match(/!! one anchor point/g) ?? []).length;
  assert.equal(flagged, oneAnchor.length, "every one-anchor margin should carry the flag");
});

/**
 * The finding that reframes "0 flips". Every contested representative in the corpus is separated
 * from the runner up by two anchor points or fewer out of 48. A no-flip result on decisions that
 * narrow is not evidence the rubric is decisive.
 */
test("every contested decision in the corpus is settled inside two anchor points", () => {
  const r = weightSensitivity(cfg);
  assert.equal(r.margins.length, 4);
  const step = 1 / cfg.rubric.dimensions.reduce((sum, d) => sum + d.weight * cfg.rubric.scale.max, 0);
  assert.ok(
    r.margins.every((m) => m.margin <= step * 2 + 1e-9),
    `widest margin was ${Math.max(...r.margins.map((m) => m.margin))}`,
  );
  assert.match(r.text, /they are close enough that any of them could ship/);
});

/** The four-critic panel on the pack that split. Pinned because D8 quotes it. */
test("002-kernel-enduser splits evenly across four critics", () => {
  const r = raterPanel(cfg, join(cfg.root, "evals", "recorded", "002-kernel-enduser"));
  assert.deepEqual(r.raters, ["shipped", "rater2", "rater3", "rater4"]);
  assert.equal(r.max_spread, 1, "no cell disagreed by more than one point");
  const c = r.clusters[0]!;
  assert.equal(c.unanimous, false);
  assert.deepEqual(c.split.map((x) => x.raters.length), [2, 2]);
  assert.deepEqual(c.ties, ["rater4"], "rater4 scored the top two level");
  assert.match(r.text, /even split: the rubric does not determine the answer/);
});
