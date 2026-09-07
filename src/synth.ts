import type { Config } from "./config.js";
import type { DeepenArtifact, Plan } from "./schema.js";
import type { ScoreResult } from "./score.js";
import type { BranchValidation } from "./validate.js";
import type { LintHint } from "./lint.js";
import { render } from "./template.js";
import { lintBranch } from "./lint.js";

export interface Cost {
  tokens: number | string;
  wall: string;
}

function summarise(d: DeepenArtifact): string {
  const flat = d.response.replace(/\s+/g, " ").trim();
  const first = flat.split(/(?<=[.!?])\s+/)[0] ?? "";
  return first.length > 240 ? `${first.slice(0, 237)}...` : first;
}

export function renderSynthesis(
  cfg: Config,
  plan: Plan,
  score: ScoreResult,
  deepen: Record<string, DeepenArtifact>,
  cost: Cost,
): string {
  const byFrame = new Map(score.frames.map((f) => [f.frame, f]));
  const deepenFor = (frame: string | null) => {
    if (!frame) return null;
    const d = deepen[frame];
    return d
      ? {
          verdict: d.verdict,
          verdict_past: d.verdict === "defend" ? "defended" : "folded",
          summary: summarise(d),
          revised_position: d.revised_position,
          revised_falsifier: d.revised_falsifier ?? null,
        }
      : null;
  };
  // A cluster is held by its survivors. A pruned member corroborated the action but does not
  // hold the recommendation, and the reader must be able to see that from the line.
  const heldBy = (c: { members: string[]; survivors: string[] }) => {
    const pruned = c.members.filter((m) => !c.survivors.includes(m));
    return c.survivors.join(", ") + (pruned.length ? ` (pruned after corroborating: ${pruned.join(", ")})` : "");
  };

  // Candidate order: live clusters by size, then mean pass A. A folded representative drops
  // the cluster out of the recommendation slot but it still reports.
  const live = score.clusters
    .filter((c) => c.survivors.length > 0)
    .sort((a, b) => b.survivors.length - a.survivors.length || (b.mean_pass_a ?? 0) - (a.mean_pass_a ?? 0));
  // A run level failure produces no recommendation, whatever the clusters look like.
  const runFailed = score.run_level.monoculture || score.run_level.scatter;
  const rec = runFailed
    ? undefined
    : live.find((c) => {
        const d = deepenFor(c.representative);
        return !d || d.verdict === "defend";
      });
  const recFrame = rec ? byFrame.get(rec.representative!) : undefined;
  const recDeepen = rec ? deepenFor(rec.representative) : null;

  const corroborated = score.clusters
    .filter((c) => c.members.length >= cfg.rubric.hard_rules.cluster_min_size && c.survivors.length > 0)
    .map((c) => ({ action: c.action, members: heldBy(c), deepen: deepenFor(c.representative) }));
  // A cluster that survived the trap sweep and then folded under its objection is not live.
  // It is still reported: the fold says what the position should have been, and that is a
  // finding. Run 004 produced two of them and the first draft filed both under "live".
  const singletonClusters = score.clusters
    .filter((c) => c.singleton && c.survivors.length > 0)
    .map((c) => ({ frame: c.members[0]!, position: byFrame.get(c.members[0]!)?.position ?? "", deepen: deepenFor(c.members[0]!) }));
  const singletons = singletonClusters.filter((s) => s.deepen?.verdict !== "fold");
  const folded = score.clusters
    .filter((c) => c.survivors.length > 0 && deepenFor(c.representative ?? c.members[0]!)?.verdict === "fold")
    .map((c) => {
      const frame = c.representative ?? c.members[0]!;
      return { frame, position: byFrame.get(frame)?.position ?? "", deepen: deepenFor(frame) };
    });
  const pruned = score.frames
    .filter((f) => f.status === "pruned")
    .map((f) => ({
      frame: f.frame,
      position: f.position ?? "(no valid artifact)",
      traps: f.fired.length ? f.fired.map((t) => t.trap).join(", ") : "none fired",
      evidence: f.fired.length ? f.fired.map((t) => `${t.trap}: ${t.evidence}`).join(" | ") : "contract violation, see below",
      violations: f.violations.length ? f.violations.join("; ") : "",
      lint_disagreement: f.lint_disagreements.length ? f.lint_disagreements.join(" | ") : "",
    }));
  const forecloses = rec ? [...new Set(rec.survivors.flatMap((m) => byFrame.get(m)?.forecloses ?? []))] : [];

  // How much rubric separated the representative from the runner up in its own cluster. Every
  // contested decision in the recorded corpus came in at two anchor points or fewer out of 48,
  // and one was an exact tie broken by `localeCompare`. A reader cannot see that from the
  // recommendation line, which reads as though a decision was made, so the line says so.
  const anchorStep = Math.min(...cfg.rubric.dimensions.map((d) => d.weight)) / cfg.rubric.dimensions.reduce((sum, d) => sum + d.weight * cfg.rubric.scale.max, 0);
  const closeCall = (() => {
    if (!rec || rec.survivors.length < 2) return "";
    const passA = (f: string) => score.frames.find((x) => x.frame === f)?.pass_a ?? null;
    const ordered = rec.survivors
      .map((f) => ({ frame: f, pass_a: passA(f) }))
      .filter((x): x is { frame: string; pass_a: number } => x.pass_a !== null)
      .sort((a, b) => b.pass_a - a.pass_a || a.frame.localeCompare(b.frame));
    if (ordered.length < 2) return "";
    const [top, second] = ordered as [{ frame: string; pass_a: number }, { frame: string; pass_a: number }];
    const margin = top.pass_a - second.pass_a;
    if (margin > anchorStep * 2 + 1e-9) return "";
    const scale = `${margin.toFixed(4)} on a scale where one anchor point is ${anchorStep.toFixed(4)}`;
    return margin <= 1e-9
      ? `${top.frame} and ${second.frame} scored level in pass A. The tie was broken by frame id, alphabetically, not by the rubric. ${second.frame}'s position in the corroborating block is as well supported as this one.`
      : `${top.frame} led ${second.frame} by ${scale}. A single anchor read the other way would have sent ${second.frame} here instead.`;
  })();

  let no_recommendation = "";
  if (!rec) {
    if (score.run_level.monoculture) no_recommendation = "Run level monoculture. See below.";
    else if (score.run_level.scatter) no_recommendation = "Run level scatter. The question needs clarification before it can be answered.";
    else if (live.length === 0) no_recommendation = "Every branch was pruned. The pruned block is the result.";
    else no_recommendation = "Every surviving position folded under its strongest objection.";
  }

  return tidy(render(cfg.prompts.synthesis, {
    problem_hash: plan.problem_hash,
    seed: plan.seed,
    recommendation: rec
      ? {
          position: recDeepen?.revised_position ?? recFrame?.position ?? rec.action,
          action: rec.action,
          falsifier: recDeepen?.revised_falsifier ?? recFrame?.falsifier ?? "",
          members: heldBy(rec),
          close_call: closeCall,
          deepen: recDeepen,
          revised: Boolean(recDeepen?.revised_position && recDeepen.revised_position !== recFrame?.position),
          original_position: recFrame?.position ?? "",
        }
      : null,
    no_recommendation,
    corroborated,
    no_corroborated: corroborated.length === 0,
    singletons,
    no_singletons: singletons.length === 0,
    folded,
    no_folded: folded.length === 0,
    pruned,
    no_pruned: pruned.length === 0,
    run_level: score.run_level.notes.length ? score.run_level.notes : ["clean: no monoculture, no scatter, no run level trap"],
    forecloses,
    no_forecloses: forecloses.length === 0,
    cost: { branches: plan.n, tokens: cost.tokens, wall: cost.wall },
  }));
}

/** Collapse the blank lines that block templates leave behind. */
export function tidy(md: string): string {
  // Trailing spaces and tabs are stripped by walking back from each line end. `/[ \t]+\n/g`
  // reads better but rescans from every position inside a run, which is quadratic on a long
  // line of whitespace, and this runs over rendered synthesis text carrying subagent output.
  const lines = md.split("\n").map((line) => {
    let end = line.length;
    while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
    return line.slice(0, end);
  });
  // A single quantifier over one character: no ambiguity, linear.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** D5: what the user gets back when they cancel mid diverge. Code lints only. */
export function renderPartial(cfg: Config, plan: Plan, branches: BranchValidation[], lints: LintHint[], cost: Cost): string {
  const returned = new Set(branches.map((b) => (b.ok ? b.artifact.frame : b.frame)));
  return tidy(render(cfg.prompts.synthesisPartial, {
    problem_hash: plan.problem_hash,
    planned: plan.n,
    returned: branches.length,
    tokens: cost.tokens,
    branches: branches.map((b) => {
      if (!b.ok)
        return {
          frame: b.frame,
          position: "(no valid artifact)",
          forecloses: [],
          falsifier: "",
          missing_actor: "",
          confidence: "",
          reasoning: "",
          lints: [],
          violations: b.violations,
        };
      const a = b.artifact;
      const hints = lints.length ? lints.filter((l) => l.frame === a.frame) : lintBranch(a);
      return {
        frame: a.frame,
        position: a.position,
        forecloses: a.forecloses,
        falsifier: a.falsifier,
        missing_actor: a.missing_actor ?? "null",
        confidence: a.confidence,
        reasoning: a.reasoning,
        lints: hints,
        violations: [],
      };
    }),
    missing: plan.branches.map((b) => b.frame).filter((f) => !returned.has(f)),
  }));
}
