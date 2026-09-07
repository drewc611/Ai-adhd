// The learning loop. Not training in the machine-learning sense: this repo has no model and
// adds none. It is the machinery for turning recorded runs into facts about the frame library,
// the rubric, and the fixtures, so those can be changed on evidence instead of on taste.
//
// Everything here is a pure function over runs that already exist. Nothing calls a model.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { PassASchema, RecordedExpectationSchema, type PassA } from "./schema.js";
import { unfence } from "./validate.js";
import type { ScoreResult } from "./score.js";

interface ScoredRun {
  id: string;
  dir: string;
  passA: PassA;
  blindMap: Record<string, string>;
  score: ScoreResult | null;
}

/** Real runs only. A negative control is a hand written answer, not a critic's scoring. */
function loadScoredRuns(recordedDir: string): ScoredRun[] {
  if (!existsSync(recordedDir)) return [];
  const out: ScoredRun[] = [];
  for (const id of readdirSync(recordedDir).sort()) {
    const dir = join(recordedDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const expected = join(dir, "expected.json");
    if (existsSync(expected) && RecordedExpectationSchema.parse(JSON.parse(readFileSync(expected, "utf8"))).control) continue;
    const pa = join(dir, "critic", "pass-a.yaml");
    const bm = join(dir, "critic", "blind-map.json");
    if (!existsSync(pa) || !existsSync(bm)) continue;
    const parsed = PassASchema.safeParse(parseYaml(unfence(readFileSync(pa, "utf8"))));
    if (!parsed.success) continue;
    const scorePath = join(dir, "score.json");
    out.push({
      id,
      dir,
      passA: parsed.data,
      blindMap: JSON.parse(readFileSync(bm, "utf8")) as Record<string, string>,
      score: existsSync(scorePath) ? (JSON.parse(readFileSync(scorePath, "utf8")) as ScoreResult) : null,
    });
  }
  return out;
}

function weightedScore(row: Record<string, { score: number }>, weights: Record<string, number>, max: number): number {
  let num = 0;
  let den = 0;
  for (const [dim, w] of Object.entries(weights)) {
    num += w * (row[dim]?.score ?? 0);
    den += w * max;
  }
  return den ? num / den : 0;
}

export interface RepresentativeFlip {
  run: string;
  cluster: string;
  under_shipped: string;
  under_perturbed: string;
  perturbation: string;
}

export interface SensitivityReport {
  runs: number;
  cluster_decisions: number;
  flips: RepresentativeFlip[];
  by_dimension: { dimension: string; flips: number }[];
  text: string;
}

/**
 * Rubric weight sensitivity. Pass A does not prune anything: a fired trap does that. What pass A
 * decides is which survivor represents its cluster, and the representative is the position that
 * goes to deepen and, if it defends, becomes the recommendation. So the question that matters is
 * whether the shipped weights and a slightly different set would send different positions forward.
 *
 * Each dimension is perturbed one at a time, up and down, and every cluster with more than one
 * survivor is re-decided. A representative that changes under a small weight change was never
 * chosen by the rubric; it was chosen by the weights.
 */
export function weightSensitivity(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded"), delta = 1): SensitivityReport {
  const runs = loadScoredRuns(recordedDir);
  const max = cfg.rubric.scale.max;
  const base: Record<string, number> = {};
  for (const d of cfg.rubric.dimensions) base[d.id] = d.weight;

  const flips: RepresentativeFlip[] = [];
  const flipsByDim = new Map<string, number>();
  let decisions = 0;

  const pick = (frames: string[], scores: Record<string, number>): string =>
    [...frames].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))[0]!;

  for (const run of runs) {
    const scoresUnder = (weights: Record<string, number>): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [letter, row] of Object.entries(run.passA.scores)) {
        const frame = run.blindMap[letter];
        if (frame) out[frame] = weightedScore(row as Record<string, { score: number }>, weights, max);
      }
      return out;
    };
    const shipped = scoresUnder(base);
    // Only clusters with a real choice to make. A single survivor represents itself whatever
    // the weights say, so counting it would dilute the rate with decisions that cannot flip.
    const contested = (run.score?.clusters ?? []).filter((c) => c.survivors.length > 1);
    for (const dim of cfg.rubric.dimensions) {
      for (const dir of [-delta, delta]) {
        const w = { ...base, [dim.id]: Math.max(0, base[dim.id]! + dir) };
        if (w[dim.id] === base[dim.id]) continue;
        const perturbed = scoresUnder(w);
        for (const c of contested) {
          const a = pick(c.survivors, shipped);
          const b = pick(c.survivors, perturbed);
          if (a !== b) {
            flips.push({ run: run.id, cluster: c.id, under_shipped: a, under_perturbed: b, perturbation: `${dim.id} ${dir > 0 ? "+" : ""}${dir}` });
            flipsByDim.set(dim.id, (flipsByDim.get(dim.id) ?? 0) + 1);
          }
        }
      }
    }
    decisions += contested.length;
  }

  const by_dimension = cfg.rubric.dimensions
    .map((d) => ({ dimension: d.id, flips: flipsByDim.get(d.id) ?? 0 }))
    .sort((a, b) => b.flips - a.flips);

  const lines = [
    `rubric weight sensitivity over ${runs.length} real recorded run(s), weights moved by +/-${delta}`,
    "",
    `contested cluster decisions (more than one survivor): ${decisions}`,
  ];
  if (decisions === 0) {
    lines.push(
      "",
      "No cluster in any recorded run had more than one survivor, so pass A has never actually",
      "chosen between two positions. The weights are untested by the corpus: this reports nothing",
      "about them, which is itself worth knowing.",
    );
  } else if (flips.length === 0) {
    lines.push("", `No representative changed under any single-dimension move of +/-${delta}.`, "On this corpus the choice is not the weights.");
  } else {
    lines.push("", `${flips.length} representative flip(s):`);
    for (const f of flips) lines.push(`  ${f.run}  cluster ${f.cluster}: ${f.under_shipped} -> ${f.under_perturbed}  (${f.perturbation})`);
    lines.push("", "A representative that changes under a small weight change was chosen by the weights,", "not by the rubric. That position went to deepen and may have become the recommendation.");
    lines.push("", "flips by dimension:");
    for (const d of by_dimension.filter((x) => x.flips)) lines.push(`  ${d.dimension.padEnd(20)} ${d.flips}`);
  }
  lines.push("", `Corpus size is ${runs.length} run(s). Treat everything above as a pointer, not a result.`);
  return { runs: runs.length, cluster_decisions: decisions, flips, by_dimension, text: lines.join("\n") };
}

export interface DimensionPair {
  a: string;
  b: string;
  r: number;
  n: number;
}

export interface CorrelationReport {
  n: number;
  pairs: DimensionPair[];
  variance: { dimension: string; mean: number; sd: number; distinct: number; at_ceiling: number; at_floor: number }[];
  text: string;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

/**
 * Do two dimensions measure the same thing? Nine dimensions with distinct names can still be
 * three dimensions charging three times each, and the rubric would look thorough while being
 * thin. A dimension that never varies is also worth finding: it costs weight and decides nothing.
 */
/** A dimension scoring the maximum this often is not separating artifacts, only inflating them. */
const CEILING = 0.85;

export function dimensionCorrelation(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded"), flagAt = 0.8): CorrelationReport {
  const runs = loadScoredRuns(recordedDir);
  const dims = cfg.rubric.dimensions.map((d) => d.id);
  const columns = new Map<string, number[]>(dims.map((d) => [d, []]));
  for (const run of runs)
    for (const row of Object.values(run.passA.scores))
      for (const d of dims) {
        const cell = (row as Record<string, { score: number } | undefined>)[d];
        if (cell) columns.get(d)!.push(cell.score);
      }
  const n = columns.get(dims[0]!)?.length ?? 0;

  const pairs: DimensionPair[] = [];
  for (let i = 0; i < dims.length; i++)
    for (let j = i + 1; j < dims.length; j++) {
      const r = pearson(columns.get(dims[i]!)!, columns.get(dims[j]!)!);
      if (!Number.isNaN(r)) pairs.push({ a: dims[i]!, b: dims[j]!, r, n });
    }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  const max = cfg.rubric.scale.max;
  const variance = dims.map((d) => {
    const xs = columns.get(d)!;
    const mean = xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
    const sd = xs.length ? Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length) : 0;
    return {
      dimension: d,
      mean,
      sd,
      distinct: new Set(xs).size,
      at_ceiling: xs.length ? xs.filter((v) => v === max).length / xs.length : 0,
      at_floor: xs.length ? xs.filter((v) => v === 0).length / xs.length : 0,
    };
  });

  const lines = [`dimension correlation over ${runs.length} real run(s), ${n} scored artifact(s)`, ""];
  if (n < 10) lines.push(`Only ${n} artifacts. Correlations on this little data are suggestive at best; they are printed so the number grows with the corpus.`, "");
  lines.push("strongest pairs:");
  for (const p of pairs.slice(0, 8)) lines.push(`  ${p.a.padEnd(20)} ${p.b.padEnd(20)} r=${p.r >= 0 ? " " : ""}${p.r.toFixed(2)}${Math.abs(p.r) >= flagAt ? "  !! moves together" : ""}`);
  lines.push("", "per dimension:");
  for (const v of variance)
    lines.push(
      `  ${v.dimension.padEnd(20)} mean ${v.mean.toFixed(2)}  sd ${v.sd.toFixed(2)}  ${String(Math.round(v.at_ceiling * 100)).padStart(3)}% at ceiling  ${v.distinct} distinct${
        v.sd === 0 ? "  !! never varies, so it decides nothing" : v.at_ceiling >= CEILING ? "  !! near ceiling: carries weight, separates almost nothing" : ""
      }`,
    );
  const flagged = pairs.filter((p) => Math.abs(p.r) >= flagAt);
  const flat = variance.filter((v) => v.sd === 0);
  // A dimension can vary and still separate almost nothing. If nearly every artifact scores the
  // maximum, the dimension adds a near-constant to every total: it costs weight, moves no
  // ranking, and makes the rubric look broader than it is. Correlation will not catch that,
  // because a near-constant correlates with nothing.
  const ceiling = variance.filter((v) => v.sd > 0 && v.at_ceiling >= CEILING);
  lines.push("");
  if (flagged.length) lines.push(`${flagged.length} pair(s) at |r| >= ${flagAt}: candidates for merging, or evidence the rubric is thinner than it looks.`);
  if (flat.length) lines.push(`${flat.length} dimension(s) never varied: they carry weight and change no outcome.`);
  if (ceiling.length)
    lines.push(
      `${ceiling.length} dimension(s) sit at or above ${Math.round(CEILING * 100)}% ceiling: ${ceiling.map((v) => `${v.dimension} ${Math.round(v.at_ceiling * 100)}%`).join(", ")}.`,
      "  Each adds a near-constant to every artifact's total, so it costs weight and moves almost",
      "  no ranking. Either the bar is too low for what it asks, or the output contract already",
      "  guarantees what it is measuring, in which case the contract is doing the work.",
    );
  if (!flagged.length && !flat.length && !ceiling.length) lines.push("No pair moves together, every dimension varies, and none sits at the ceiling.");
  return { n, pairs, variance, text: lines.join("\n") };
}
