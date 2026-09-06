import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { unfence } from "./validate.js";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { DeepenArtifactSchema, PassBSchema, TRAP_IDS, type TrapId } from "./schema.js";
import type { ScoreResult } from "./score.js";

export function listFrames(cfg: Config, json = false): string {
  if (json) return JSON.stringify(cfg.frames.frames.map(({ id, name, axis, attacks, tools }) => ({ id, name, axis, attacks, tools })), null, 2);
  const rows = cfg.frames.frames.map((f) => `${f.id.padEnd(17)} ${f.axis.padEnd(14)} attacks=${f.attacks.join(",").padEnd(10)} tools=${f.tools.length ? f.tools.join(",") : "-"}`);
  const axes = new Set(cfg.frames.frames.map((f) => f.axis));
  return [...rows, "", `${cfg.frames.frames.length} frames, ${axes.size} axes. hard_cap ${cfg.routing.defaults.hard_cap}, default n ${cfg.routing.defaults.max_branches}.`].join("\n");
}

export interface PairStat {
  a: string;
  b: string;
  together: number;
  co_clustered: number;
  rate: number;
}

/**
 * D6 empirical check: across recorded runs, how often do two frames land in the same
 * cluster when both are present? Above `threshold` they are duplicates wearing different words.
 */
export function orthogonality(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded"), threshold = 0.6, minTogether = 3): { pairs: PairStat[]; flagged: PairStat[]; runs: number; text: string } {
  const stats = new Map<string, PairStat>();
  let runs = 0;
  if (existsSync(recordedDir)) {
    for (const d of readdirSync(recordedDir)) {
      const p = join(recordedDir, d, "critic", "pass-b.yaml");
      if (!statSync(join(recordedDir, d)).isDirectory() || !existsSync(p)) continue;
      const r = PassBSchema.safeParse(parseYaml(unfence(readFileSync(p, "utf8"))));
      if (!r.success) continue;
      runs++;
      const clusterOf = new Map<string, string>();
      for (const c of r.data.clusters) for (const m of c.members) clusterOf.set(m, c.id);
      const frames = [...clusterOf.keys()].sort();
      for (let i = 0; i < frames.length; i++)
        for (let j = i + 1; j < frames.length; j++) {
          const key = `${frames[i]}|${frames[j]}`;
          const s = stats.get(key) ?? { a: frames[i]!, b: frames[j]!, together: 0, co_clustered: 0, rate: 0 };
          s.together++;
          if (clusterOf.get(frames[i]!) === clusterOf.get(frames[j]!)) s.co_clustered++;
          s.rate = s.co_clustered / s.together;
          stats.set(key, s);
        }
    }
  }
  const pairs = [...stats.values()].sort((x, y) => y.rate - x.rate || y.together - x.together);
  // One co-clustering is an anecdote. Flag only pairs observed together at least minTogether times.
  const flagged = pairs.filter((p) => p.rate > threshold && p.together >= minTogether);
  const lines = [`orthogonality over ${runs} recorded run(s) with critic/pass-b.yaml (flag threshold ${threshold * 100}%, min ${minTogether} shared runs)`];
  if (!pairs.length) lines.push("no pairs observed yet. Record runs to populate this.");
  for (const p of pairs)
    lines.push(
      `${flagged.includes(p) ? "!!" : p.rate > threshold ? " ?" : "  "} ${p.a.padEnd(17)} ${p.b.padEnd(17)} co-clustered ${p.co_clustered}/${p.together} (${(p.rate * 100).toFixed(0)}%)${p.rate > threshold && p.together < minTogether ? "  too few shared runs to flag" : ""}`,
    );
  if (flagged.length) lines.push(`${flagged.length} pair(s) above ${threshold * 100}%: candidates for removal or rewrite (D6).`);
  return { pairs, flagged, runs, text: lines.join("\n") };
}

export interface FrameStat {
  frame: string;
  axis: string;
  runs: number;
  pruned: number;
  survived: number;
  /** Survived the trap sweep, then folded under its objection. */
  folded: number;
  defended: number;
  /** Held the recommendation: representative of the top live cluster with a non-fold verdict. */
  recommended: number;
  singleton: number;
  mean_pass_a: number | null;
  traps: Partial<Record<TrapId, number>>;
}

export interface TrapStat {
  trap: TrapId;
  fired: number;
  frames: string[];
}

/**
 * Per-frame behaviour across recorded runs. This is the D6 evidence surface: a frame pruned
 * every time it appears and a frame never pruned are both suspicious, for opposite reasons,
 * and neither is visible from a single run. Counts only; the judgement is the owner's.
 */
export function frameStats(
  cfg: Config,
  recordedDir = join(cfg.root, "evals", "recorded"),
): { frames: FrameStat[]; traps: TrapStat[]; runs: number; text: string } {
  const axisOf = new Map(cfg.frames.frames.map((f) => [f.id, f.axis]));
  const by = new Map<string, FrameStat & { passASum: number; passAN: number }>();
  const trapCounts = new Map<TrapId, Set<string>>();
  const trapFires = new Map<TrapId, number>();
  let runs = 0;

  const get = (frame: string) => {
    let s = by.get(frame);
    if (!s) {
      s = {
        frame,
        axis: axisOf.get(frame) ?? "(not in library)",
        runs: 0,
        pruned: 0,
        survived: 0,
        folded: 0,
        defended: 0,
        recommended: 0,
        singleton: 0,
        mean_pass_a: null,
        traps: {},
        passASum: 0,
        passAN: 0,
      };
      by.set(frame, s);
    }
    return s;
  };

  if (existsSync(recordedDir)) {
    for (const d of readdirSync(recordedDir).sort()) {
      const dir = join(recordedDir, d);
      if (!statSync(dir).isDirectory()) continue;
      const scorePath = join(dir, "score.json");
      if (!existsSync(scorePath)) continue;
      let score: ScoreResult;
      try {
        score = JSON.parse(readFileSync(scorePath, "utf8")) as ScoreResult;
      } catch {
        continue;
      }
      if (!Array.isArray(score.frames)) continue;
      runs++;

      // Deepen verdicts live beside the score, one file per frame that reached the phase.
      const deepenDir = join(dir, "deepen");
      const verdicts = new Map<string, "defend" | "fold">();
      if (existsSync(deepenDir))
        for (const f of readdirSync(deepenDir)) {
          if (!f.endsWith(".yaml")) continue;
          const r = DeepenArtifactSchema.safeParse(parseYaml(unfence(readFileSync(join(deepenDir, f), "utf8"))));
          if (r.success) verdicts.set(r.data.frame, r.data.verdict);
        }

      // The recommendation goes to the highest-ranked live cluster whose representative defended.
      const live = [...score.clusters]
        .filter((c) => c.survivors.length > 0)
        .sort((a, b) => b.survivors.length - a.survivors.length || (b.mean_pass_a ?? 0) - (a.mean_pass_a ?? 0));
      const runFailed = score.run_level?.monoculture || score.run_level?.scatter;
      const holder = runFailed
        ? undefined
        : live.find((c) => {
            const v = c.representative ? verdicts.get(c.representative) : undefined;
            return !v || v === "defend";
          })?.representative;

      for (const f of score.frames) {
        const s = get(f.frame);
        s.runs++;
        if (f.status === "pruned") s.pruned++;
        else s.survived++;
        if (f.pass_a !== null && f.pass_a !== undefined) {
          s.passASum += f.pass_a;
          s.passAN++;
        }
        for (const t of f.fired ?? []) {
          s.traps[t.trap] = (s.traps[t.trap] ?? 0) + 1;
          trapFires.set(t.trap, (trapFires.get(t.trap) ?? 0) + 1);
          if (!trapCounts.has(t.trap)) trapCounts.set(t.trap, new Set());
          trapCounts.get(t.trap)!.add(f.frame);
        }
        const v = verdicts.get(f.frame);
        if (v === "fold") s.folded++;
        else if (v === "defend") s.defended++;
        if (f.frame === holder) s.recommended++;
      }
      for (const c of score.clusters) if (c.singleton && c.members[0]) get(c.members[0]).singleton++;
    }
  }

  const frames: FrameStat[] = [...by.values()]
    .map(({ passASum, passAN, ...s }) => ({ ...s, mean_pass_a: passAN ? passASum / passAN : null }))
    .sort((a, b) => b.runs - a.runs || b.pruned / (b.runs || 1) - a.pruned / (a.runs || 1) || a.frame.localeCompare(b.frame));
  const traps: TrapStat[] = TRAP_IDS.map((t) => ({ trap: t, fired: trapFires.get(t) ?? 0, frames: [...(trapCounts.get(t) ?? [])].sort() }));

  const lines = [`frame stats over ${runs} recorded run(s) with score.json`];
  if (!frames.length) {
    lines.push("no scored runs yet. Record runs to populate this.");
    return { frames, traps, runs, text: lines.join("\n") };
  }
  lines.push("");
  lines.push(`${"frame".padEnd(17)} ${"axis".padEnd(15)} runs  pruned  folded  rec  meanA  traps`);
  for (const f of frames) {
    const t = TRAP_IDS.filter((x) => f.traps[x]).map((x) => `${x}x${f.traps[x]}`).join(",") || "-";
    lines.push(
      `${f.frame.padEnd(17)} ${f.axis.padEnd(15)} ${String(f.runs).padStart(4)}  ${String(f.pruned).padStart(6)}  ${String(f.folded).padStart(6)}  ${String(f.recommended).padStart(3)}  ${(f.mean_pass_a ?? 0).toFixed(2).padStart(5)}  ${t}`,
    );
  }
  lines.push("");
  lines.push("detectors:");
  for (const t of traps)
    lines.push(`  ${t.trap}  fired ${String(t.fired).padStart(2)}${t.fired ? `  on ${t.frames.join(", ")}` : "  never fired in any recorded run"}`);

  // Only worth saying once a frame has appeared enough times for the rate to mean anything.
  const MIN = 2;
  const always = frames.filter((f) => f.runs >= MIN && f.pruned === f.runs);
  const never = frames.filter((f) => f.runs >= MIN && f.pruned === 0);
  const unused = cfg.frames.frames.filter((f) => !by.has(f.id)).map((f) => f.id);
  lines.push("");
  if (always.length) lines.push(`pruned in every appearance (>=${MIN} runs): ${always.map((f) => `${f.frame} ${f.pruned}/${f.runs}`).join(", ")}`);
  if (never.length) lines.push(`never pruned (>=${MIN} runs): ${never.map((f) => `${f.frame} 0/${f.runs}`).join(", ")}`);
  if (unused.length) lines.push(`never dispatched in a recorded run: ${unused.join(", ")}`);
  const dead = traps.filter((t) => t.fired === 0).map((t) => t.trap);
  if (dead.length) lines.push(`detectors that have never fired: ${dead.join(", ")}. Prevention or dead weight; the counts cannot tell you which.`);
  lines.push("Counts, not verdicts. Changing the library on this evidence is a D6 decision.");

  return { frames, traps, runs, text: lines.join("\n") };
}
