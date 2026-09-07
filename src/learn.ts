// The learning loop. Not training in the machine-learning sense: this repo has no model and
// adds none. It is the machinery for turning recorded runs into facts about the frame library,
// the rubric, and the fixtures, so those can be changed on evidence instead of on taste.
//
// Everything here is a pure function over runs that already exist. Nothing calls a model.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { currentFrameId, type Config } from "./config.js";
import { PassASchema, RecordedExpectationSchema, type PassA } from "./schema.js";
import { unfence } from "./validate.js";
import { forwardFrameIds, type ScoreResult } from "./score.js";

interface ScoredRun {
  id: string;
  dir: string;
  passA: PassA;
  blindMap: Record<string, string>;
  score: ScoreResult | null;
}

/** Real runs only. A negative control is a hand written answer, not a critic's scoring. */
function loadScoredRuns(cfg: Config, recordedDir: string): ScoredRun[] {
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
      blindMap: forwardBlindMap(cfg, JSON.parse(readFileSync(bm, "utf8")) as Record<string, string>),
      score: existsSync(scorePath) ? forwardFrameIds(cfg, JSON.parse(readFileSync(scorePath, "utf8")) as ScoreResult) : null,
    });
  }
  return out;
}

/** The blind map is letter -> frame id as the run wrote it. Same forwarding, same reason. */
function forwardBlindMap(cfg: Config, m: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(m).map(([letter, frame]) => [letter, currentFrameId(cfg, frame)]));
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
  /** How much rubric separated each shipped representative from the runner up in its cluster. */
  margins: { run: string; cluster: string; winner: string; runner_up: string; margin: number }[];
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
  const runs = loadScoredRuns(cfg, recordedDir);
  const max = cfg.rubric.scale.max;
  const base: Record<string, number> = {};
  for (const d of cfg.rubric.dimensions) base[d.id] = d.weight;

  const flips: RepresentativeFlip[] = [];
  const flipsByDim = new Map<string, number>();
  let decisions = 0;

  const rank = (frames: string[], scores: Record<string, number>): string[] =>
    [...frames].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b));
  const pick = (frames: string[], scores: Record<string, number>): string => rank(frames, scores)[0]!;
  const margins: SensitivityReport["margins"] = [];

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
    for (const c of contested) {
      const order = rank(c.survivors, shipped);
      margins.push({ run: run.id, cluster: c.id, winner: order[0]!, runner_up: order[1]!, margin: (shipped[order[0]!] ?? 0) - (shipped[order[1]!] ?? 0) });
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
  // A "no flip" result reads as stability, and it is not stability if the decision was never
  // wide in the first place. One point on the cheapest dimension is the smallest move any single
  // anchor can make; a margin at or under that is inside the rubric's own resolution.
  const minWeight = Math.min(...cfg.rubric.dimensions.map((d) => d.weight));
  const step = minWeight / cfg.rubric.dimensions.reduce((sum, d) => sum + d.weight * max, 0);
  // Margins are ratios of small integers and land a bit either side of an exact anchor point.
  const atMost = (v: number, bound: number) => v <= bound + 1e-9;
  if (margins.length) {
    lines.push("", `how much rubric separated each shipped representative (one anchor point on the cheapest dimension is ${step.toFixed(4)}):`);
    for (const m of margins.sort((a, b) => a.margin - b.margin))
      lines.push(`  ${m.run.padEnd(24)} ${m.cluster.padEnd(26)} ${m.winner} over ${m.runner_up}  ${m.margin.toFixed(4)}${m.margin === 0 ? "  !! exact tie, broken alphabetically" : atMost(m.margin, step) ? "  !! one anchor point" : ""}`);
    const tight = margins.filter((m) => atMost(m.margin, step * 2));
    if (tight.length === margins.length)
      lines.push(
        "",
        `Every one of the ${margins.length} contested decisions was settled by two anchor points or fewer out of`,
        `${cfg.rubric.dimensions.reduce((sum, d) => sum + d.weight * max, 0)}. Read the no-flip result above against that: these representatives are not`,
        "stable because the rubric is decisive, they are close enough that any of them could ship.",
      );
    else if (tight.length) lines.push("", `${tight.length} of ${margins.length} contested decisions were settled by two anchor points or fewer.`);
  }
  lines.push("", `Corpus size is ${runs.length} run(s). Treat everything above as a pointer, not a result.`);
  return { runs: runs.length, cluster_decisions: decisions, flips, by_dimension, margins, text: lines.join("\n") };
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
  const runs = loadScoredRuns(cfg, recordedDir);
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

export interface DimensionAgreement {
  dimension: string;
  exact: number;
  within_one: number;
  mean_abs_diff: number;
  n: number;
}

export interface InterRaterReport {
  artifacts: number;
  cells: number;
  exact: number;
  within_one: number;
  by_dimension: DimensionAgreement[];
  ranking_changed: boolean;
  representative_changes: { cluster: string; a: string; b: string }[];
  text: string;
}

/**
 * Two critics, one artifact pack, blind both times. The rubric is only worth its weights if two
 * readings of the same five artifacts land in the same place, and until now nothing in the repo
 * measured that.
 *
 * Cell agreement is the cheap number and the least interesting one. What decides a run is the
 * ordering: which artifact tops its cluster and goes to deepen. Two critics can disagree on
 * half the cells and ship the same answer, or agree on most and still send a different position
 * forward. Both are reported, and the second is the one to read.
 */
export function interRater(cfg: Config, runDir: string, altPassAPath: string): InterRaterReport {
  const dims = cfg.rubric.dimensions.map((d) => d.id);
  const max = cfg.rubric.scale.max;
  const weights: Record<string, number> = {};
  for (const d of cfg.rubric.dimensions) weights[d.id] = d.weight;

  const readPassA = (p: string): PassA => PassASchema.parse(parseYaml(unfence(readFileSync(p, "utf8"))));
  const first = readPassA(join(runDir, "critic", "pass-a.yaml"));
  const second = readPassA(altPassAPath);
  if (first.problem_hash !== second.problem_hash)
    throw new Error(`problem_hash mismatch: the two scorings are not of the same problem (${first.problem_hash} vs ${second.problem_hash})`);

  const blindMap = JSON.parse(readFileSync(join(runDir, "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  // Both critics see the same blind pack, so a letter means the same artifact to each. If the
  // second scoring used its own shuffle, the letters do not line up and nothing below is valid.
  const letters = Object.keys(first.scores).filter((l) => second.scores[l]).sort();
  const missing = Object.keys(first.scores).filter((l) => !second.scores[l]);
  if (missing.length) throw new Error(`second scoring is missing artifact(s) ${missing.join(", ")}: an incomplete pack cannot be compared`);

  const diffs = new Map<string, number[]>(dims.map((d) => [d, []]));
  for (const l of letters)
    for (const d of dims) {
      const a = (first.scores[l] as Record<string, { score: number } | undefined>)[d];
      const b = (second.scores[l] as Record<string, { score: number } | undefined>)[d];
      if (a && b) diffs.get(d)!.push(b.score - a.score);
    }

  const by_dimension = dims
    .map((d) => {
      const xs = diffs.get(d)!;
      return {
        dimension: d,
        exact: xs.length ? xs.filter((v) => v === 0).length / xs.length : 0,
        within_one: xs.length ? xs.filter((v) => Math.abs(v) <= 1).length / xs.length : 0,
        mean_abs_diff: xs.length ? xs.reduce((s, v) => s + Math.abs(v), 0) / xs.length : 0,
        n: xs.length,
      };
    })
    .sort((a, b) => a.exact - b.exact);

  const all = [...diffs.values()].flat();
  const exact = all.length ? all.filter((v) => v === 0).length / all.length : 0;
  const within_one = all.length ? all.filter((v) => Math.abs(v) <= 1).length / all.length : 0;

  const totals = (pa: PassA): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const l of letters) {
      const frame = blindMap[l];
      if (frame) out[frame] = weightedScore(pa.scores[l] as Record<string, { score: number }>, weights, max);
    }
    return out;
  };
  const tA = totals(first);
  const tB = totals(second);
  const order = (t: Record<string, number>) => Object.keys(t).sort((x, y) => (t[y] ?? 0) - (t[x] ?? 0) || x.localeCompare(y));
  const ranking_changed = order(tA).join(",") !== order(tB).join(",");

  const scorePath = join(runDir, "score.json");
  const clusters = existsSync(scorePath) ? (forwardFrameIds(cfg, JSON.parse(readFileSync(scorePath, "utf8")) as ScoreResult).clusters ?? []) : [];
  const pick = (frames: string[], t: Record<string, number>) => [...frames].sort((x, y) => (t[y] ?? 0) - (t[x] ?? 0) || x.localeCompare(y))[0]!;
  const representative_changes: { cluster: string; a: string; b: string }[] = [];
  for (const c of clusters.filter((c) => c.survivors.length > 1)) {
    const a = pick(c.survivors, tA);
    const b = pick(c.survivors, tB);
    if (a !== b) representative_changes.push({ cluster: c.id, a, b });
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lines = [
    `critic agreement on ${letters.length} artifact(s), ${all.length} scored cell(s)`,
    "",
    `exact agreement    ${pct(exact)}`,
    `within one point   ${pct(within_one)}`,
    "",
    "per dimension, worst agreement first:",
  ];
  for (const d of by_dimension)
    lines.push(`  ${d.dimension.padEnd(20)} exact ${pct(d.exact).padStart(4)}  within 1 ${pct(d.within_one).padStart(4)}  mean |diff| ${d.mean_abs_diff.toFixed(2)}`);

  lines.push("", "what it changes:");
  lines.push(`  ranking of artifacts by weighted total: ${ranking_changed ? "CHANGED" : "unchanged"}`);
  lines.push(`  first critic:  ${order(tA).join(" > ")}`);
  lines.push(`  second critic: ${order(tB).join(" > ")}`);
  if (!clusters.length) lines.push("  no scored clusters on disk, so no representative decision to check");
  else if (!clusters.some((c) => c.survivors.length > 1)) lines.push("  every cluster had one survivor, so no representative decision could change");
  else if (!representative_changes.length) {
    lines.push("  every contested cluster kept its representative: the same positions go to deepen");
    // Clustering absorbs most rank disagreement. Two artifacts in different clusters both go to
    // deepen whatever their order, so a swap across clusters decides nothing. Only order inside
    // a contested cluster does, and saying so stops "CHANGED" reading as alarming when it is not.
    if (ranking_changed)
      lines.push("  The rank changes were across clusters, and cross-cluster order decides nothing:", "  each cluster sends its own representative regardless of how it ranks against another's.");
  }
  else {
    lines.push(`  ${representative_changes.length} cluster representative(s) changed:`);
    for (const r of representative_changes) lines.push(`    ${r.cluster}: ${r.a} -> ${r.b}`);
    lines.push("  A different position went to deepen, so this run's recommendation depends on which critic read it.");
  }
  lines.push(
    "",
    "Cell agreement is the cheap number. Two critics can disagree on half the cells and ship the",
    "same answer, or agree on most and send a different position forward. Read the ranking.",
  );
  return { artifacts: letters.length, cells: all.length, exact, within_one, by_dimension, ranking_changed, representative_changes, text: lines.join("\n") };
}

export interface CorpusAgreement {
  runs: { run: string; report: InterRaterReport }[];
  cells: number;
  exact: number;
  within_one: number;
  by_dimension: DimensionAgreement[];
  runs_with_changed_representative: string[];
  text: string;
}

/** The second scoring lives beside the one the run shipped on, under a name that says so. */
const SECOND_SCORING = "pass-a.rater2.yaml";

/**
 * Every run that has a second scoring, pooled. One pack is a reading; a corpus is a number, and
 * the pooled per-dimension figures are the only ones worth quoting. The run-level count that
 * matters is not how many cells moved but how many runs would have sent a different position to
 * deepen, because that is the only disagreement a reader of the output could ever see.
 */
export function interRaterCorpus(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded")): CorpusAgreement {
  const dims = cfg.rubric.dimensions.map((d) => d.id);
  const runs: { run: string; report: InterRaterReport }[] = [];
  if (existsSync(recordedDir))
    for (const id of readdirSync(recordedDir).sort()) {
      const dir = join(recordedDir, id);
      if (!statSync(dir).isDirectory()) continue;
      // The first second-scoring on disk, so a run carrying only a rater3 still counts.
      const alt = raterFiles(dir)[0];
      if (alt) runs.push({ run: id, report: interRater(cfg, dir, alt.path) });
    }

  // Pooled by weight of cells, not by mean of run means: a five artifact pack and a three
  // artifact pack are not equal evidence, and averaging the percentages would pretend they are.
  const pooled = (get: (d: DimensionAgreement) => number) => (dim: string) => {
    let hits = 0;
    let n = 0;
    for (const r of runs)
      for (const d of r.report.by_dimension)
        if (d.dimension === dim) {
          hits += get(d) * d.n;
          n += d.n;
        }
    return { hits, n };
  };
  const by_dimension: DimensionAgreement[] = dims
    .map((dim) => {
      const e = pooled((d) => d.exact)(dim);
      const w = pooled((d) => d.within_one)(dim);
      const m = pooled((d) => d.mean_abs_diff)(dim);
      return {
        dimension: dim,
        exact: e.n ? e.hits / e.n : 0,
        within_one: w.n ? w.hits / w.n : 0,
        mean_abs_diff: m.n ? m.hits / m.n : 0,
        n: e.n,
      };
    })
    .sort((a, b) => a.exact - b.exact);

  const cells = runs.reduce((s, r) => s + r.report.cells, 0);
  const exact = cells ? runs.reduce((s, r) => s + r.report.exact * r.report.cells, 0) / cells : 0;
  const within_one = cells ? runs.reduce((s, r) => s + r.report.within_one * r.report.cells, 0) / cells : 0;
  const runs_with_changed_representative = runs.filter((r) => r.report.representative_changes.length).map((r) => r.run);

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lines: string[] = [];
  if (!runs.length)
    lines.push(
      `no run under ${recordedDir} has a ${SECOND_SCORING}.`,
      "",
      "A second scoring is produced by handing critic/pass-a.brief.md verbatim to a fresh critic",
      "in a separate context window, with instructions to read nothing else, and saving its pass A",
      `beside the first as ${SECOND_SCORING}.`,
    );
  else {
    lines.push(
      `critic agreement pooled over ${runs.length} run(s), ${cells} scored cell(s)`,
      "",
      `exact agreement    ${pct(exact)}`,
      `within one point   ${pct(within_one)}`,
      "",
      "per dimension, worst agreement first:",
    );
    for (const d of by_dimension)
      lines.push(`  ${d.dimension.padEnd(20)} exact ${pct(d.exact).padStart(4)}  within 1 ${pct(d.within_one).padStart(4)}  mean |diff| ${d.mean_abs_diff.toFixed(2)}  n=${d.n}`);
    lines.push("", "per run:");
    for (const r of runs)
      lines.push(
        `  ${r.run.padEnd(24)} exact ${pct(r.report.exact).padStart(4)}  ranking ${r.report.ranking_changed ? "CHANGED " : "same    "}  representatives ${
          r.report.representative_changes.length ? `CHANGED (${r.report.representative_changes.map((c) => `${c.a}->${c.b}`).join(", ")})` : "same"
        }`,
      );
    lines.push("");
    lines.push(
      runs_with_changed_representative.length
        ? `${runs_with_changed_representative.length} of ${runs.length} run(s) would have sent a different position to deepen: ${runs_with_changed_representative.join(", ")}.`
        : `No run would have sent a different position to deepen. Cell disagreement did not reach the output in any of the ${runs.length}.`,
    );
    lines.push("", `Pooled over ${cells} cells from ${runs.length} run(s), one second critic each. Grow both before quoting a figure.`);
  }
  return { runs, cells, exact, within_one, by_dimension, runs_with_changed_representative, text: lines.join("\n") };
}

export interface PanelCluster {
  cluster: string;
  survivors: string[];
  picks: Record<string, string>;
  unanimous: boolean;
  split: { frame: string; raters: string[] }[];
  /** Top minus second, per critic. How much rubric actually separates the position that ships. */
  margins: Record<string, number>;
  /** Critics whose top two were exactly level, so the pick fell to the alphabetical tie-break. */
  ties: string[];
  narrowest: number;
}

export interface PanelReport {
  run: string;
  raters: string[];
  artifacts: number;
  cells: number;
  unanimous_cells: number;
  max_spread: number;
  by_dimension: { dimension: string; unanimous: number; mean_spread: number; max_spread: number }[];
  clusters: PanelCluster[];
  text: string;
}

/** Second and later scorings of one pack: pass-a.rater2.yaml, pass-a.rater3.yaml, and so on. */
function raterFiles(runDir: string): { label: string; path: string }[] {
  const dir = join(runDir, "critic");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^pass-a\.rater[0-9]+\.yaml$/.test(f))
    .map((f) => ({ label: f.slice("pass-a.".length, -".yaml".length), path: join(dir, f), n: Number(f.replace(/\D+/g, "")) }))
    .sort((a, b) => a.n - b.n)
    .map(({ label, path }) => ({ label, path }));
}

/**
 * Three or more critics on one pack. Two raters can tell you they disagreed and nothing about
 * why: an ambiguous rubric and one idiosyncratic critic look identical at n=2. A panel separates
 * them. If the raters split evenly on a cluster the rubric does not determine the answer; if one
 * rater stands alone the rubric does and that rater read it differently.
 *
 * The cell figures are here because they are cheap. The cluster table is the report.
 */
export function raterPanel(cfg: Config, runDir: string): PanelReport {
  const dims = cfg.rubric.dimensions.map((d) => d.id);
  const max = cfg.rubric.scale.max;
  const weights: Record<string, number> = {};
  for (const d of cfg.rubric.dimensions) weights[d.id] = d.weight;

  const read = (p: string): PassA => PassASchema.parse(parseYaml(unfence(readFileSync(p, "utf8"))));
  const shipped = read(join(runDir, "critic", "pass-a.yaml"));
  const extra = raterFiles(runDir).map((f) => ({ label: f.label, pa: read(f.path) }));
  const panel = [{ label: "shipped", pa: shipped }, ...extra];
  for (const r of extra)
    if (r.pa.problem_hash !== shipped.problem_hash)
      throw new Error(`problem_hash mismatch on ${r.label}: a panel must be scoring one problem (${r.pa.problem_hash} vs ${shipped.problem_hash})`);

  const blindMap = JSON.parse(readFileSync(join(runDir, "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  const letters = Object.keys(shipped.scores)
    .filter((l) => panel.every((r) => r.pa.scores[l]))
    .sort();

  const spreads = new Map<string, number[]>(dims.map((d) => [d, []]));
  for (const l of letters)
    for (const d of dims) {
      const vals = panel.map((r) => (r.pa.scores[l] as Record<string, { score: number } | undefined>)[d]?.score).filter((v): v is number => v !== undefined);
      if (vals.length === panel.length) spreads.get(d)!.push(Math.max(...vals) - Math.min(...vals));
    }
  const all = [...spreads.values()].flat();
  const by_dimension = dims
    .map((d) => {
      const xs = spreads.get(d)!;
      return {
        dimension: d,
        unanimous: xs.length ? xs.filter((v) => v === 0).length / xs.length : 0,
        mean_spread: xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0,
        max_spread: xs.length ? Math.max(...xs) : 0,
      };
    })
    .sort((a, b) => a.unanimous - b.unanimous);

  const totalsFor = (pa: PassA): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const l of letters) {
      const frame = blindMap[l];
      if (frame) out[frame] = weightedScore(pa.scores[l] as Record<string, { score: number }>, weights, max);
    }
    return out;
  };
  const ranked = (frames: string[], t: Record<string, number>) => [...frames].sort((x, y) => (t[y] ?? 0) - (t[x] ?? 0) || x.localeCompare(y));
  const scorePath = join(runDir, "score.json");
  const scored = existsSync(scorePath) ? (forwardFrameIds(cfg, JSON.parse(readFileSync(scorePath, "utf8")) as ScoreResult).clusters ?? []) : [];

  const clusters: PanelCluster[] = scored
    .filter((c) => c.survivors.length > 1)
    .map((c) => {
      const picks: Record<string, string> = {};
      const margins: Record<string, number> = {};
      const ties: string[] = [];
      for (const r of panel) {
        const t = totalsFor(r.pa);
        const order = ranked(c.survivors, t);
        picks[r.label] = order[0]!;
        margins[r.label] = (t[order[0]!] ?? 0) - (t[order[1]!] ?? 0);
        // An exact tie is not a close decision, it is no decision: `ranked` falls through to
        // localeCompare, so the frame that ships is the one whose id sorts first.
        if (margins[r.label] === 0) ties.push(r.label);
      }
      const grouped = new Map<string, string[]>();
      for (const [label, frame] of Object.entries(picks)) grouped.set(frame, [...(grouped.get(frame) ?? []), label]);
      const split = [...grouped.entries()].map(([frame, raters]) => ({ frame, raters })).sort((a, b) => b.raters.length - a.raters.length);
      return { cluster: c.id, survivors: c.survivors, picks, unanimous: split.length === 1, split, margins, ties, narrowest: Math.min(...Object.values(margins)) };
    });

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const unanimous_cells = all.length ? all.filter((v) => v === 0).length / all.length : 0;
  // One point on the lowest weighted dimension, as a fraction of the normalised total. A margin
  // under this is closer than the smallest move any single anchor can make.
  const minWeight = Math.min(...cfg.rubric.dimensions.map((d) => d.weight));
  const nearTie = minWeight / cfg.rubric.dimensions.reduce((sum, d) => sum + d.weight * max, 0);
  const lines = [
    `panel of ${panel.length} critic(s) on ${runDir.split("/").pop()}: ${panel.map((r) => r.label).join(", ")}`,
    "",
    `${letters.length} artifact(s), ${all.length} cell(s), ${pct(unanimous_cells)} scored identically by every critic`,
    `widest disagreement on any cell: ${all.length ? Math.max(...all) : 0} point(s)`,
    "",
    "per dimension, least unanimous first:",
  ];
  for (const d of by_dimension) lines.push(`  ${d.dimension.padEnd(20)} unanimous ${pct(d.unanimous).padStart(4)}  mean spread ${d.mean_spread.toFixed(2)}  widest ${d.max_spread}`);

  lines.push("", "contested clusters, and who each critic sends to deepen:");
  if (!clusters.length) lines.push("  none: every cluster had one survivor, so no critic had a choice to make.");
  for (const c of clusters) {
    lines.push(`  ${c.cluster}  (${c.survivors.join(" vs ")})`);
    for (const s of c.split) lines.push(`    ${s.frame.padEnd(18)} ${s.raters.join(", ")}`);
    lines.push(`    margin over second place: ${panel.map((r) => `${r.label} ${c.margins[r.label]!.toFixed(4)}`).join(", ")}`);
    if (c.ties.length)
      lines.push(
        `    !! EXACT TIE for ${c.ties.join(", ")}: the rubric separates nothing, so the position that`,
        "       ships is whichever frame id sorts first alphabetically. That is not a decision.",
      );
    else if (c.narrowest <= nearTie + 1e-9)
      lines.push(`    !! narrowest margin ${c.narrowest.toFixed(4)} is under ${nearTie.toFixed(4)}, one point on the cheapest`, "       dimension. A single anchor read either way would change what ships.");
    if (c.unanimous) lines.push("    unanimous: the rubric determines this one.");
    // An even split is the more specific statement, so it is checked before the no-majority
    // case: with two critics disagreeing both are true and only one is worth printing.
    else if (c.split.length === 2 && c.split[0]!.raters.length * 2 === panel.length)
      lines.push("    even split: the rubric does not determine the answer. This is the rubric, not the critic.");
    else if (c.split[0]!.raters.length === 1)
      lines.push(`    ${c.split.length}-way split with no majority: on ${panel.length} critics the rubric does not settle it.`);
    else lines.push(`    ${c.split.map((s) => s.raters.length).join("-")}: a majority, and ${c.split.slice(1).flatMap((s) => s.raters).join(", ")} read it differently.`);
  }
  lines.push(
    "",
    "Cell agreement is cheap. The cluster table is the report: it is the only place a critic's",
    "disagreement can reach a reader of the output.",
  );
  return { run: runDir, raters: panel.map((r) => r.label), artifacts: letters.length, cells: all.length, unanimous_cells, max_spread: all.length ? Math.max(...all) : 0, by_dimension, clusters, text: lines.join("\n") };
}
