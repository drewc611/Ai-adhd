// Token spend across recorded runs (backlog 41).
//
// The D5 gate shows an estimate before anything is spent, and `cost.json` records what a run
// actually cost once it finishes. Nothing has ever compared the two. An estimate nobody checks
// is a number that drifts until the gate is showing a figure with no relationship to the bill,
// which makes the gate worse than absent: it looks like informed consent and isn't.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { currentFrameId } from "./config.js";

export const PHASES = ["diverge", "critique_a", "critique_b", "deepen"] as const;
export type Phase = (typeof PHASES)[number];

export interface RunCost {
  run: string;
  tokens: number;
  estimate: number | null;
  /** Actual over estimate. Null when the run has no plan to compare against. */
  ratio: number | null;
  wall: string | null;
  by_phase: Partial<Record<Phase, number>> | null;
  by_frame: Record<string, number> | null;
  n: number | null;
}

export interface CostReport {
  runs: RunCost[];
  total: number;
  total_estimate: number;
  by_phase: Partial<Record<Phase, number>>;
  /** Runs whose cost.json predates the kernel and carries no phase breakdown. */
  unbroken: string[];
  text: string;
}

const num = (n: number) => n.toLocaleString("en-US");

/**
 * Spend per recorded run, against the estimate the D5 gate showed for it.
 *
 * `by_frame` is present only for runs whose directory still carries the kernel's `os.json`,
 * because per-task tokens live there and `adhd os record` does not copy them into the
 * recording. Recordings made after this change carry the breakdown in `cost.json` instead;
 * older ones cannot be reconstructed and are reported as unavailable rather than guessed at.
 */
export function costReport(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded")): CostReport {
  const runs: RunCost[] = [];
  if (existsSync(recordedDir))
    for (const d of readdirSync(recordedDir).sort()) {
      const dir = join(recordedDir, d);
      if (!statSync(dir).isDirectory()) continue;
      const costPath = join(dir, "cost.json");
      if (!existsSync(costPath)) continue;
      let cost: { tokens?: number; wall?: string; by_phase?: Record<string, number>; by_frame?: Record<string, number> };
      try {
        cost = JSON.parse(readFileSync(costPath, "utf8"));
      } catch {
        continue;
      }
      if (typeof cost.tokens !== "number") continue;

      let estimate: number | null = null;
      let n: number | null = null;
      const planPath = join(dir, "plan.json");
      if (existsSync(planPath))
        try {
          const plan = JSON.parse(readFileSync(planPath, "utf8")) as { estimate?: { tokens_total?: number }; n?: number };
          estimate = plan.estimate?.tokens_total ?? null;
          n = plan.n ?? null;
        } catch {
          /* a run without a readable plan has nothing to compare against */
        }

      // Per-frame tokens: from cost.json when the recording carries them, otherwise from an
      // os.json still sitting in the directory. Ids are forwarded, same as everywhere else.
      let byFrame: Record<string, number> | null = null;
      const fromCost = cost.by_frame ?? null;
      const osPath = join(dir, "os.json");
      if (fromCost) byFrame = fromCost;
      else if (existsSync(osPath))
        try {
          const rec = JSON.parse(readFileSync(osPath, "utf8")) as { tasks?: { label?: string; phase?: string; tokens?: number | null }[] };
          const acc: Record<string, number> = {};
          for (const t of rec.tasks ?? [])
            if (typeof t.tokens === "number" && t.label && (t.phase === "diverge" || t.phase === "deepen")) {
              const f = currentFrameId(cfg, t.label);
              acc[f] = (acc[f] ?? 0) + t.tokens;
            }
          if (Object.keys(acc).length) byFrame = acc;
        } catch {
          /* no usable record */
        }

      const byPhase = cost.by_phase ? (Object.fromEntries(PHASES.filter((p) => cost.by_phase![p] !== undefined).map((p) => [p, cost.by_phase![p]!])) as Partial<Record<Phase, number>>) : null;
      runs.push({
        run: d,
        tokens: cost.tokens,
        estimate,
        ratio: estimate ? cost.tokens / estimate : null,
        wall: cost.wall ?? null,
        by_phase: byPhase,
        by_frame: byFrame,
        n,
      });
    }

  const total = runs.reduce((a, r) => a + r.tokens, 0);
  const totalEstimate = runs.reduce((a, r) => a + (r.estimate ?? 0), 0);
  const byPhase: Partial<Record<Phase, number>> = {};
  for (const r of runs) for (const p of PHASES) if (r.by_phase?.[p]) byPhase[p] = (byPhase[p] ?? 0) + r.by_phase[p]!;
  const unbroken = runs.filter((r) => !r.by_phase).map((r) => r.run);

  const lines = [`token spend over ${runs.length} recorded run(s) with cost.json`];
  if (!runs.length) {
    lines.push("no run has recorded a cost yet.");
    return { runs, total, total_estimate: totalEstimate, by_phase: byPhase, unbroken, text: lines.join("\n") };
  }
  lines.push("");
  lines.push(`${"run".padEnd(22)} ${"n".padStart(2)}  ${"actual".padStart(9)}  ${"estimate".padStart(9)}  ratio  wall`);
  for (const r of runs)
    lines.push(
      `${r.run.padEnd(22)} ${String(r.n ?? "-").padStart(2)}  ${num(r.tokens).padStart(9)}  ${(r.estimate === null ? "-" : num(r.estimate)).padStart(9)}  ${(r.ratio === null ? "-" : `${r.ratio.toFixed(1)}x`).padStart(5)}  ${r.wall ?? "-"}`,
    );

  lines.push("");
  const phased = runs.filter((r) => r.by_phase);
  if (phased.length) {
    const phaseTotal = PHASES.reduce((a, p) => a + (byPhase[p] ?? 0), 0);
    lines.push(`by phase over the ${phased.length} run(s) that record one:`);
    for (const p of PHASES) {
      const v = byPhase[p] ?? 0;
      lines.push(`  ${p.padEnd(11)} ${num(v).padStart(9)}  ${phaseTotal ? ((v / phaseTotal) * 100).toFixed(0).padStart(3) : "  -"}%`);
    }
  }
  if (unbroken.length) lines.push(`no phase breakdown: ${unbroken.join(", ")}. Recorded before the kernel wrote one, and not reconstructable.`);

  const framed = runs.filter((r) => r.by_frame);
  if (framed.length) {
    const acc = new Map<string, { tokens: number; runs: number }>();
    for (const r of framed) for (const [f, t] of Object.entries(r.by_frame!)) {
      const e = acc.get(f) ?? { tokens: 0, runs: 0 };
      e.tokens += t;
      e.runs++;
      acc.set(f, e);
    }
    lines.push("");
    lines.push(`by frame over the ${framed.length} run(s) that record one (branch and deepen tasks only):`);
    for (const [f, e] of [...acc.entries()].sort((a, b) => b[1].tokens - a[1].tokens))
      lines.push(`  ${f.padEnd(17)} ${num(e.tokens).padStart(9)}  over ${e.runs} run(s), mean ${num(Math.round(e.tokens / e.runs)).padStart(7)}`);
  } else {
    lines.push("");
    lines.push("no run records per-frame tokens. They live in the kernel's os.json, which `adhd os record` does not copy; recordings made from here on carry the breakdown in cost.json.");
  }

  lines.push("");
  const withEstimate = runs.filter((r) => r.ratio !== null);
  if (withEstimate.length) {
    const meanRatio = withEstimate.reduce((a, r) => a + r.ratio!, 0) / withEstimate.length;
    lines.push(`total ${num(total)} actual against ${num(totalEstimate)} estimated, mean ${meanRatio.toFixed(1)}x over ${withEstimate.length} run(s).`);
    lines.push(
      `The D5 gate shows the estimate, so a mean this far from 1.0 is the gate quoting a figure ${meanRatio > 1 ? "well under" : "well over"} what the run costs. \`tokens_per_branch_estimate\` in config/routing.yaml is what sets it.`,
    );
  }
  return { runs, total, total_estimate: totalEstimate, by_phase: byPhase, unbroken, text: lines.join("\n") };
}
