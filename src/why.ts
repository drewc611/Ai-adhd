// `adhd why <run> <frame>`: everything that happened to one frame in one run, in the order it
// happened, from the files the run already wrote. It calls nothing and decides nothing.
//
// The question it answers is the one a reader of a synthesis actually has. A frame is missing
// from the recommendation and the pruned block gives a trap id and a sentence. That says which
// detector fired, not whether the frame was ever close, what the critic scored it, or what the
// deepen pass did with the position it held.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { currentFrameId, frameIdHistory, type Config } from "./config.js";
import { UsageError } from "./errors.js";
import { DeepenArtifactSchema, PassASchema, PlanSchema, type PassA, type Plan } from "./schema.js";
import { forwardFrameIds, type ScoreResult, type ScoredCluster, type ScoredFrame } from "./score.js";
import { unfence } from "./validate.js";

export interface FrameStanding {
  /** Weighted pass A total, and where it sat inside its own cluster. */
  pass_a: number | null;
  rank_in_cluster: number | null;
  margin_to_next: number | null;
  representative: boolean;
  tie: boolean;
}

export interface WhyReport {
  run: string;
  frame: string;
  dispatched: boolean;
  axis: string | null;
  status: "survivor" | "pruned" | "not dispatched" | "no artifact";
  standing: FrameStanding;
  dimensions: { dimension: string; score: number; weight: number; evidence: string }[];
  cluster: ScoredCluster | null;
  fired: { trap: string; evidence: string }[];
  violations: string[];
  lint_disagreements: string[];
  deepen: { verdict: "defend" | "fold"; response: string; revised_position: string | null } | null;
  in_synthesis: string[];
  text: string;
}

const read = <T>(p: string, f: (raw: string) => T): T | null => (existsSync(p) ? f(readFileSync(p, "utf8")) : null);

/**
 * This is a summary view over artifacts that run to paragraphs. Every long field is one line
 * here and the file it came from is named, so nothing in the report dumps a whole artifact.
 */
const CLIP = 300;
/** Collapse a multi-line field to one line. Length is enforced once, at join time, by `trunc`. */
const clip = (text: string): string => text.replace(/\s+/g, " ").trim();
/** Truncate without collapsing, so the column alignment in the pass A rows survives. */
const trunc = (line: string): string => (line.length > CLIP ? `${line.slice(0, CLIP - 3)}...` : line);
const body = (lines: string[]): string => lines.map(trunc).join("\n");

export function explainFrame(cfg: Config, runDir: string, frameId: string): WhyReport {
  const asked = frameId.toUpperCase();
  if (!cfg.frames.frames.some((f) => f.id === asked || f.former_ids.includes(asked)))
    throw new UsageError(`unknown frame ${asked}. The library has: ${cfg.frames.frames.map((f) => f.id).join(", ")}`);
  // A recorded run names frames by the ids current when it ran. Report under today's name, and
  // look the run's files up under every name the frame has ever had, so `adhd why <run> SUPPLICANT`
  // finds branches/END_USER.yaml and `adhd why <run> END_USER` still works for anyone holding
  // an old note.
  const history = frameIdHistory(cfg, asked);
  const frame = history[0]!;
  const isFrame = (id: string | null | undefined) => id !== null && id !== undefined && history.includes(id);

  const plan = read<Plan>(join(runDir, "plan.json"), (r) => PlanSchema.parse(JSON.parse(r)));
  const score = read<ScoreResult>(join(runDir, "score.json"), (r) => forwardFrameIds(cfg, JSON.parse(r) as ScoreResult));
  const passA = read<PassA>(join(runDir, "critic", "pass-a.yaml"), (r) => PassASchema.parse(parseYaml(unfence(r))));
  const blindMap = read<Record<string, string>>(join(runDir, "critic", "blind-map.json"), (r) => JSON.parse(r) as Record<string, string>);
  const deepenPath = history.map((id) => join(runDir, "deepen", `${id}.yaml`)).find((p) => existsSync(p)) ?? join(runDir, "deepen", `${frame}.yaml`);
  const deepenRaw = read(deepenPath, (r) => DeepenArtifactSchema.parse(parseYaml(unfence(r))));
  const synthesis = read(join(runDir, "synthesis.md"), (r) => r);

  const branch = plan?.branches.find((b) => isFrame(b.frame)) ?? null;
  const scored: ScoredFrame | null = score?.frames.find((f) => f.frame === frame) ?? null;
  const cluster = score?.clusters.find((c) => c.members.includes(frame)) ?? null;  // already forwarded

  const max = cfg.rubric.scale.max;
  const den = cfg.rubric.dimensions.reduce((s, d) => s + d.weight * max, 0);
  const anchorStep = Math.min(...cfg.rubric.dimensions.map((d) => d.weight)) / den;

  const letter = blindMap ? Object.entries(blindMap).find(([, f]) => isFrame(f))?.[0] : undefined;
  const row = letter && passA ? (passA.scores[letter] as Record<string, { score: number; evidence: string } | undefined>) : undefined;
  const dimensions = row
    ? cfg.rubric.dimensions
        .map((d) => ({ dimension: d.id, score: row[d.id]?.score ?? 0, weight: d.weight, evidence: row[d.id]?.evidence ?? "" }))
        .sort((a, b) => a.score * a.weight - b.score * b.weight)
    : [];

  // Where the frame stood inside its own cluster, which is the only comparison that decided
  // anything. Ranking it against the whole run would be a comparison the scorer never made.
  const standing: FrameStanding = { pass_a: scored?.pass_a ?? null, rank_in_cluster: null, margin_to_next: null, representative: cluster?.representative === frame, tie: false };
  if (cluster && score) {
    const byPassA = (f: string) => score.frames.find((x) => x.frame === f)?.pass_a ?? null;
    const order = cluster.survivors
      .map((f) => ({ frame: f, pass_a: byPassA(f) }))
      .filter((x): x is { frame: string; pass_a: number } => x.pass_a !== null)
      .sort((a, b) => b.pass_a - a.pass_a || a.frame.localeCompare(b.frame));
    const i = order.findIndex((x) => x.frame === frame);
    if (i >= 0) {
      standing.rank_in_cluster = i + 1;
      const neighbour = i === 0 ? order[1] : order[i - 1];
      if (neighbour) standing.margin_to_next = Math.abs(order[i]!.pass_a - neighbour.pass_a);
      standing.tie = standing.margin_to_next !== null && standing.margin_to_next <= 1e-9 && order.length > 1;
    }
  }

  const status: WhyReport["status"] = !branch ? "not dispatched" : !scored ? "no artifact" : scored.status;
  const in_synthesis = synthesis
    ? synthesis
        .split("\n")
        .filter((l) => new RegExp(`\\b${frame}\\b`).test(l))
        .map((l) => l.trim())
    : [];

  const lines: string[] = [`${frame} in ${runDir.split("/").pop()}`, ""];
  if (!branch) {
    lines.push(`Not dispatched. The plan for this run selected ${plan?.branches.length ?? 0} frames and ${frame} was not among them:`, `  ${plan?.branches.map((b) => currentFrameId(cfg, b.frame)).join(", ") ?? "(no plan.json)"}`, "", "A frame that was never asked cannot have been rejected. Routing chose the set; see config/routing.yaml.");
    return { run: runDir, frame, dispatched: false, axis: null, status, standing, dimensions, cluster, fired: [], violations: [], lint_disagreements: [], deepen: null, in_synthesis, text: body(lines) };
  }

  lines.push(`Dispatched on the axis: ${branch.axis}`, `Tools allowed: ${branch.tools.length ? branch.tools.join(", ") : "none"}`, "");
  if (!scored) {
    lines.push("No scored record. The branch never returned a valid artifact, so nothing downstream saw it.");
    return { run: runDir, frame, dispatched: true, axis: branch.axis, status, standing, dimensions, cluster, fired: [], violations: [], lint_disagreements: [], deepen: null, in_synthesis, text: body(lines) };
  }

  lines.push(`Position: ${scored.position ? clip(scored.position) : "(none)"}`, "");
  if (dimensions.length) {
    lines.push(`Pass A (blind, as artifact ${letter}). Weighted total ${scored.pass_a?.toFixed(4) ?? "n/a"}, weakest first:`);
    for (const d of dimensions) lines.push(`  ${d.dimension.padEnd(20)} ${d.score}/${max} x${d.weight}  ${clip(d.evidence)}`);
    lines.push("");
  }

  if (cluster) {
    lines.push(`Cluster ${cluster.id}: ${clip(cluster.action)}`, `  members:   ${cluster.members.join(", ")}`, `  survivors: ${cluster.survivors.join(", ") || "(none)"}`);
    if (standing.rank_in_cluster) {
      lines.push(`  ${frame} ranked ${standing.rank_in_cluster} of ${cluster.survivors.length} survivor(s)${standing.representative ? ", and represented the cluster in deepen" : ""}.`);
      if (standing.tie)
        lines.push(
          `  !! It scored level with its neighbour. The order came from frame id, alphabetically,`,
          `     not from the rubric. ${standing.representative ? "This frame won a tie it did not win." : "It lost a tie it did not lose."}`,
        );
      else if (standing.margin_to_next !== null && standing.margin_to_next <= anchorStep * 2 + 1e-9)
        lines.push(`  !! Margin to its neighbour is ${standing.margin_to_next.toFixed(4)}, at most two anchor points (one is ${anchorStep.toFixed(4)}).`, `     One dimension read the other way would have changed this.`);
    } else if (!cluster.survivors.includes(frame))
      // A pruned member of a cluster that others still hold corroborated the action. A pruned
      // frame that was the whole cluster corroborated nothing; the action left with it.
      lines.push(
        cluster.members.length > 1
          ? `  ${frame} was pruned, so it corroborated the action without holding it.`
          : `  ${frame} was this cluster's only member and was pruned, so the action has no holder and reaches the reader only through the pruned block.`,
      );
    lines.push("");
  } else lines.push("No cluster: pass B did not group this frame with anything, including itself.", "");

  if (scored.fired.length) {
    lines.push("Pruned by these detectors:");
    for (const t of scored.fired) lines.push(`  ${t.trap}: ${clip(t.evidence)}`);
    lines.push("");
  }
  if (scored.violations.length) lines.push("Contract violations, which remove the artifact before the critic sees it:", ...scored.violations.map((v) => `  ${v}`), "");
  if (scored.lint_disagreements.length) lines.push("Mechanical lint disagreed with the critic:", ...scored.lint_disagreements.map((v) => `  ${v}`), "");
  if (!scored.fired.length && !scored.violations.length) lines.push("No detector fired and no contract rule broke.", "");

  const deepen = deepenRaw ? { verdict: deepenRaw.verdict, response: deepenRaw.response, revised_position: deepenRaw.revised_position } : null;
  if (deepen) {
    // A deepen response runs to several paragraphs. This view is a summary, so it prints the
    // opening and points at the file; the full concession is the artifact, not this.
    const flat = deepen.response.replace(/\s+/g, " ").trim();
    lines.push(`Deepen: ${deepen.verdict === "defend" ? "defended" : "folded"}. ${clip(flat)}`);
    if (flat.length > CLIP) lines.push(`  Full response in deepen/${frame}.yaml.`);
    if (deepen.revised_position) lines.push(`  Revised position: ${clip(deepen.revised_position)}`);
    lines.push("");
  } else if (standing.representative) lines.push("No deepen artifact, though this frame represented its cluster.", "");

  lines.push(in_synthesis.length ? "Where it appears in the synthesis:" : "It does not appear in the synthesis by name.");
  for (const l of in_synthesis) lines.push(`  ${clip(l)}`);

  return { run: runDir, frame, dispatched: true, axis: branch.axis, status, standing, dimensions, cluster, fired: scored.fired, violations: scored.violations, lint_disagreements: scored.lint_disagreements, deepen, in_synthesis, text: body(lines) };
}
