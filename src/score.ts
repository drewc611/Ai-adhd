// The scorer is code. It aggregates critic output deterministically, applies the hard rules
// in config/critic-rubric.yaml, and refuses to proceed on a missing record. It never rescues
// a branch with a fired trap on the strength of its pass A score.
import { currentFrameId, type Config } from "./config.js";
import type { DetectorRecord, PassA, PassB, TrapId } from "./schema.js";
import type { BranchValidation } from "./validate.js";
import type { LintHint } from "./lint.js";
import { TRAP_IDS } from "./schema.js";

export interface FiredTrap {
  trap: TrapId;
  evidence: string;
}

export interface ScoredFrame {
  frame: string;
  status: "survivor" | "pruned";
  cluster: string | null;
  pass_a: number | null;
  fired: FiredTrap[];
  violations: string[];
  lint_disagreements: string[];
  position: string | null;
  forecloses: string[];
  falsifier: string | null;
  missing_actor: string | null;
}

export interface ScoredCluster {
  id: string;
  action: string;
  members: string[];
  survivors: string[];
  singleton: boolean;
  strongest_objection: string | null;
  /** Highest pass A survivor. Goes to deepen. */
  representative: string | null;
  mean_pass_a: number | null;
}

export interface RunLevel {
  monoculture: boolean;
  scatter: boolean;
  t2_no_branch_attacked_assumption: DetectorRecord;
  t6_all_missing_actor_null: DetectorRecord;
  notes: string[];
}

export interface ScoreResult {
  n: number;
  frames: ScoredFrame[];
  clusters: ScoredCluster[];
  run_level: RunLevel;
  /** False on monoculture or scatter: do not deepen. */
  proceed: boolean;
  /**
   * The rubric that produced these numbers. `pass_a` is a weighted total, so it is only
   * comparable across runs scored under the same weights, and until this was stamped a rubric
   * change would have silently split the corpus into halves that look comparable and are not.
   * The field existed in config/critic-rubric.yaml and nothing read it.
   */
  rubric_version: number;
}

/**
 * A recorded run names frames by the ids that were current when it ran, and a rename must not
 * split the corpus in two. Mapping forward here, once, at the point a recorded score is read,
 * keeps every count downstream about frames as the library names them today.
 *
 * The recorded files themselves are never rewritten. `score.json`, `plan.json`,
 * `blind-map.json`, the branch filenames and the append-only `os.json` journal are the record
 * of what ran; editing them to match a later rename would make a run claim a frame that did not
 * exist yet. An unknown id passes through unchanged, because a run may name a frame that has
 * since been retired outright and that is a real fact about the run.
 */
export function forwardFrameIds(cfg: Config, score: ScoreResult): ScoreResult {
  const cur = (id: string) => currentFrameId(cfg, id);
  return {
    ...score,
    frames: score.frames.map((f) => ({ ...f, frame: cur(f.frame) })),
    clusters: score.clusters.map((c) => ({
      ...c,
      members: c.members.map(cur),
      survivors: c.survivors.map(cur),
      representative: c.representative ? cur(c.representative) : c.representative,
    })),
  };
}

/** weighted mean, normalised to [0,1]. */
export function passAScores(cfg: Config, passA: PassA, blindMap: Record<string, string>): Record<string, number> {
  const dims = cfg.rubric.dimensions;
  const max = cfg.rubric.scale.max;
  const denom = dims.reduce((s, d) => s + d.weight * max, 0);
  const out: Record<string, number> = {};
  for (const [letter, row] of Object.entries(passA.scores)) {
    const frame = blindMap[letter];
    if (!frame) continue;
    const num = dims.reduce((s, d) => s + d.weight * (row[d.id]?.score ?? 0), 0);
    out[frame] = denom ? num / denom : 0;
  }
  return out;
}

export function scoreRun(
  cfg: Config,
  branches: BranchValidation[],
  passAByFrame: Record<string, number> | null,
  passB: PassB,
  lints: LintHint[],
): ScoreResult {
  const rules = cfg.rubric.hard_rules;
  const n = branches.length;
  const frames: ScoredFrame[] = [];
  const clusterOf = new Map<string, string>();
  for (const c of passB.clusters) for (const m of c.members) clusterOf.set(m, c.id);

  for (const b of branches) {
    const frame = b.ok ? b.artifact.frame : b.frame;
    const fired: FiredTrap[] = [];
    const violations: string[] = b.ok ? [] : b.violations.slice();
    const row = passB.traps[frame];
    if (row) for (const t of TRAP_IDS) if (row[t]?.fired) fired.push({ trap: t, evidence: row[t]!.evidence });
    const lintHere = lints.filter((l) => l.frame === frame);
    const disagreements: string[] = [];
    for (const l of lintHere) {
      const critic = row?.[l.trap]?.fired;
      if (critic === false) disagreements.push(`${l.trap}: lint fired (${l.evidence}); critic did not`);
    }
    const pruned = (rules.prune_on_any_fired_trap && fired.length > 0) || (rules.contract_violation_prunes && violations.length > 0);
    frames.push({
      frame,
      status: pruned ? "pruned" : "survivor",
      cluster: clusterOf.get(frame) ?? null,
      pass_a: passAByFrame?.[frame] ?? null,
      fired,
      violations,
      lint_disagreements: disagreements,
      position: b.ok ? b.artifact.position : null,
      forecloses: b.ok ? b.artifact.forecloses : [],
      falsifier: b.ok ? b.artifact.falsifier : null,
      missing_actor: b.ok ? b.artifact.missing_actor : null,
    });
  }

  const byFrame = new Map(frames.map((f) => [f.frame, f]));
  const clusters: ScoredCluster[] = passB.clusters.map((c) => {
    const survivors = c.members.filter((m) => byFrame.get(m)?.status === "survivor");
    const scored = survivors.map((m) => byFrame.get(m)!.pass_a).filter((x): x is number => x !== null);
    const representative =
      survivors.length === 0
        ? null
        : survivors.slice().sort((a, b) => (byFrame.get(b)!.pass_a ?? 0) - (byFrame.get(a)!.pass_a ?? 0))[0]!;
    return {
      id: c.id,
      action: c.action,
      members: c.members,
      survivors,
      singleton: c.members.length === 1,
      strongest_objection: c.strongest_objection,
      representative,
      mean_pass_a: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
    };
  });

  const notes: string[] = [];
  const largest = Math.max(0, ...passB.clusters.map((c) => c.members.length));
  const monoculture = n > 0 && largest / n >= rules.monoculture_fraction;
  if (monoculture)
    notes.push(
      `MONOCULTURE: one cluster holds ${largest} of ${n} branches (>= ${rules.monoculture_fraction}). Frames were not orthogonal or an anchor leaked. Re-run with a different frame set.`,
    );
  const scatter = n >= rules.scatter.min_n && !passB.clusters.some((c) => c.members.length >= rules.scatter.requires_cluster_of);
  if (scatter)
    notes.push(`SCATTER: ${n} branches and no two share a position. The problem statement is probably underspecified. Return the ambiguity to the asker.`);
  if (rules.run_level_t2_if_no_branch_attacks_assumption && passB.run_level.T2_no_branch_attacked_assumption.fired)
    notes.push(`T2 (run level): no branch attacked the load bearing assumption. ${passB.run_level.T2_no_branch_attacked_assumption.evidence}`);
  if (passB.run_level.T6_all_missing_actor_null.fired)
    notes.push(`T6 (run level): every branch left missing_actor null. ${passB.run_level.T6_all_missing_actor_null.evidence}`);
  for (const c of clusters) if (c.singleton && c.survivors.length) notes.push(`singleton ${c.members[0]} escalated to deepen, flagged unverified`);
  if (!frames.some((f) => f.status === "survivor")) notes.push("every branch was pruned. Nothing to deepen.");

  return {
    n,
    frames,
    clusters,
    run_level: {
      monoculture,
      scatter,
      t2_no_branch_attacked_assumption: passB.run_level.T2_no_branch_attacked_assumption,
      t6_all_missing_actor_null: passB.run_level.T6_all_missing_actor_null,
      notes,
    },
    proceed: !monoculture && !scatter && frames.some((f) => f.status === "survivor"),
    rubric_version: cfg.rubric.version,
  };
}
