import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { unfence } from "./validate.js";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { currentFrameId, type Config } from "./config.js";
import { DeepenArtifactSchema, PassBSchema, TRAP_IDS, type TrapId } from "./schema.js";
import { forwardFrameIds, type ScoreResult } from "./score.js";

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
      // pass-b.yaml names frames by the ids current when the run happened; forward them so a
      // renamed frame's pair history is not split across two names.
      for (const c of r.data.clusters) for (const m of c.members) clusterOf.set(currentFrameId(cfg, m), c.id);
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
        score = forwardFrameIds(cfg, JSON.parse(readFileSync(scorePath, "utf8")) as ScoreResult);
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

export interface RunSummary {
  dir: string;
  id: string;
  fixture: string | null;
  seed: number | null;
  frames: { frame: string; status: string; pass_a: number | null; fired: string[] }[];
  clusters: { id: string; action: string; members: string[] }[];
  recommendation: string;
}

export interface RunDiff {
  a: RunSummary;
  b: RunSummary;
  same_problem: boolean;
  shared_frames: string[];
  only_a: string[];
  only_b: string[];
  status_changed: { frame: string; a: string; b: string }[];
  pass_a_moved: { frame: string; a: number; b: number; delta: number }[];
  text: string;
}

function summarise(cfg: Config, dir: string): RunSummary {
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
  const plan = read("plan.json");
  const p = plan ? (JSON.parse(plan) as { problem_hash?: string; seed?: number }) : {};
  const scoreRaw = read("score.json");
  const score = scoreRaw ? forwardFrameIds(cfg, JSON.parse(scoreRaw) as ScoreResult) : null;
  const synth = read("synthesis.md") ?? "";
  const bold = synth.match(/## Recommendation\s*\n+\*\*([\s\S]*?)\*\*/);
  const id = dir.split("/").filter(Boolean).pop() ?? dir;
  return {
    dir,
    id,
    fixture: /^(\d+)-/.exec(id)?.[1] ?? null,
    seed: typeof p.seed === "number" ? p.seed : null,
    frames: (score?.frames ?? []).map((f) => ({ frame: f.frame, status: f.status, pass_a: f.pass_a, fired: (f.fired ?? []).map((t) => t.trap) })),
    clusters: (score?.clusters ?? []).map((c) => ({ id: c.id, action: c.action, members: c.members })),
    recommendation: bold ? bold[1]!.replace(/\s+/g, " ").trim() : "(none rendered)",
  };
}

/**
 * Two runs of the same fixture, side by side. The question this answers is the one the repo
 * cannot currently answer at all: when a finding appears, is it the frame set or the seed?
 * A frame that survives at one seed and is pruned at another is a fact about the seed.
 */
export function diffRuns(cfg: Config, dirA: string, dirB: string): RunDiff {
  const a = summarise(cfg, dirA);
  const b = summarise(cfg, dirB);
  const hash = (d: string) => {
    const p = join(d, "plan.json");
    return existsSync(p) ? ((JSON.parse(readFileSync(p, "utf8")) as { problem_hash?: string }).problem_hash ?? null) : null;
  };
  const same_problem = hash(dirA) !== null && hash(dirA) === hash(dirB);

  const byFrameA = new Map(a.frames.map((f) => [f.frame, f]));
  const byFrameB = new Map(b.frames.map((f) => [f.frame, f]));
  const shared_frames = [...byFrameA.keys()].filter((f) => byFrameB.has(f)).sort();
  const only_a = [...byFrameA.keys()].filter((f) => !byFrameB.has(f)).sort();
  const only_b = [...byFrameB.keys()].filter((f) => !byFrameA.has(f)).sort();

  const status_changed = shared_frames
    .filter((f) => byFrameA.get(f)!.status !== byFrameB.get(f)!.status)
    .map((f) => ({ frame: f, a: byFrameA.get(f)!.status, b: byFrameB.get(f)!.status }));
  const pass_a_moved = shared_frames
    .filter((f) => byFrameA.get(f)!.pass_a !== null && byFrameB.get(f)!.pass_a !== null)
    .map((f) => {
      const x = byFrameA.get(f)!.pass_a!;
      const y = byFrameB.get(f)!.pass_a!;
      return { frame: f, a: x, b: y, delta: y - x };
    })
    .filter((r) => Math.abs(r.delta) >= 0.01)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const lines = [
    `${a.id}  (seed ${a.seed ?? "?"})`,
    `${b.id}  (seed ${b.seed ?? "?"})`,
    "",
    same_problem
      ? "same problem_hash: these runs are comparable."
      : "!! DIFFERENT problem_hash. These are not two runs of one problem, so nothing below is a comparison.",
    "",
  ];
  if (only_a.length || only_b.length) {
    lines.push(`frames only in ${a.id}: ${only_a.join(", ") || "(none)"}`);
    lines.push(`frames only in ${b.id}: ${only_b.join(", ") || "(none)"}`);
    // Two runs can differ in more than one way. Attributing anything below to the seed when
    // the frame set also changed is the unearned attribution this repo exists to catch, and
    // it is true of the whole comparison, not only of the frames whose status moved.
    lines.push(
      "CONFOUNDED: the frame sets differ, so nothing below can be attributed to the seed.",
      "Compare two runs with the same frames at different seeds to separate them.",
      "",
    );
  }
  lines.push(`shared frames: ${shared_frames.length}`);
  if (status_changed.length) {
    lines.push("", "status changed between the runs:");
    for (const c of status_changed) lines.push(`  ${c.frame.padEnd(17)} ${c.a} -> ${c.b}`);
    if (only_a.length || only_b.length) {
      /* the confound is reported once, above, for the whole comparison */
    } else if (a.seed !== null && b.seed !== null && a.seed !== b.seed)
      lines.push("  Same frames, different seed, so this change is the seed's doing.");
    else lines.push("  Same frames and the same seed, so this change is run-to-run variance in the critic.");
  } else if (shared_frames.length) {
    lines.push("", "no frame changed status between the runs.");
  }
  if (pass_a_moved.length) {
    lines.push("", "pass A moved (>= 0.01):");
    for (const m of pass_a_moved.slice(0, 12)) lines.push(`  ${m.frame.padEnd(17)} ${m.a.toFixed(2)} -> ${m.b.toFixed(2)}  ${m.delta > 0 ? "+" : ""}${m.delta.toFixed(2)}`);
    const biggest = Math.max(...pass_a_moved.map((m) => Math.abs(m.delta)));
    lines.push(
      `  Largest move ${biggest.toFixed(2)} on an unchanged artifact-producing frame. Until the`,
      "  run-to-run noise floor is measured, a move this size cannot be called signal.",
    );
  }
  lines.push("", "recommendation:", `  ${a.id}: ${a.recommendation.slice(0, 160)}`, `  ${b.id}: ${b.recommendation.slice(0, 160)}`);
  lines.push(
    "",
    a.recommendation === b.recommendation
      ? "The recommendations are identical."
      : only_a.length || only_b.length
        ? "The recommendations differ, but so do the frame sets: this pair cannot say which caused it."
        : a.seed !== b.seed
          ? "The recommendations differ at different seeds with the same frames. That is a seed effect."
          : "The recommendations differ with the same frames and the same seed. That is critic variance.",
  );
  return { a, b, same_problem, shared_frames, only_a, only_b, status_changed, pass_a_moved, text: lines.join("\n") };
}

export interface Collision {
  frame: string;
  label: string;
  own: number;
  foreign: number;
  examples: string[];
}

export interface CollisionReport {
  artifacts: number;
  collisions: Collision[];
  text: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = (label: string) =>
  label
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(esc)
    .join("[\\s_-]*");

/**
 * Which frame labels are also ordinary English. The redactor cannot tell "from inside the End
 * user stance" from "the end user behind that caller", so it removes both, and the second was
 * the artifact naming an actor. That damages the text pass A scores, on the very dimension the
 * phrase was demonstrating.
 *
 * A label found in artifacts other than its own frame's is not identifying anything: any branch
 * could have written it. A label found only in its own frame's artifact is doing its job. Both
 * are counted from the recorded corpus rather than guessed at by reading the names.
 */
export function labelCollisions(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded")): CollisionReport {
  const labels = cfg.frames.frames.flatMap((f) => [
    { frame: f.id, label: f.id },
    { frame: f.id, label: f.name },
  ]);
  const tally = new Map<string, Collision>(labels.map((l) => [`${l.frame} ${l.label}`, { ...l, own: 0, foreign: 0, examples: [] }]));

  let artifacts = 0;
  if (existsSync(recordedDir))
    for (const id of readdirSync(recordedDir).sort()) {
      const dir = join(recordedDir, id);
      if (!statSync(dir).isDirectory()) continue;
      const branches = join(dir, "branches");
      if (!existsSync(branches)) continue;
      for (const file of readdirSync(branches)) {
        if (!file.endsWith(".yaml")) continue;
        const writer = file.slice(0, -".yaml".length);
        // The mandatory `frame:` field is stripped before the critic sees anything, so counting
        // it would put every label at own >= 1 for free and hide the real signal.
        const body = readFileSync(join(branches, file), "utf8").replace(/^frame:.*$/m, "");
        artifacts++;
        for (const l of labels) {
          const hits = [...body.matchAll(new RegExp(`\\b${pattern(l.label)}\\b`, "gi"))];
          if (!hits.length) continue;
          const rec = tally.get(`${l.frame} ${l.label}`)!;
          if (writer === l.frame) rec.own += hits.length;
          else {
            rec.foreign += hits.length;
            if (rec.examples.length < 3) rec.examples.push(`${id}/${writer}: "${hits[0]![0]}"`);
          }
        }
      }
    }

  const collisions = [...tally.values()].filter((c) => c.foreign > 0).sort((a, b) => b.foreign - a.foreign);
  const lines = [`frame label collisions across ${artifacts} recorded artifact(s)`, ""];
  if (!artifacts) lines.push("no recorded artifacts to read.");
  else if (!collisions.length) lines.push("No label appeared in an artifact other than its own frame's. Every label is discriminating.");
  else {
    lines.push("labels that appeared in artifacts they do not identify:", "");
    for (const c of collisions) {
      lines.push(`  ${c.label.padEnd(18)} (${c.frame})  ${c.foreign} foreign use(s), ${c.own} own`);
      for (const e of c.examples) lines.push(`      ${e}`);
    }
    lines.push(
      "",
      "Each foreign use is a phrase the redactor removes from an artifact that frame did not write.",
      "The critic then reads [frame] where a real noun phrase stood. The pass A prompt tells it to",
      "read through the redaction, which limits the damage but does not undo it.",
      "",
      "The fix is a display name that is not also a common noun. Renaming a frame is a D6 change,",
      "so this counts the problem and stops there.",
    );
  }
  return { artifacts, collisions, text: lines.join("\n") };
}
