import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { unfence } from "./validate.js";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { PassBSchema } from "./schema.js";

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
