// `adhd viewer`: one self-contained HTML file over the recorded runs. Calls no model and
// decides nothing; it renders what the runs already wrote.
//
// The reason it exists: the most useful thing this system produces is the pruned block, and
// reading it meant `adhd why <run> <frame>` once per frame in a terminal. Five frames times
// five runs is twenty-five invocations to answer "what did the critic throw away, and was it
// right to". A page that holds all of it at once is the difference between evidence you can
// consult and evidence you technically have.
//
// Self-contained on purpose. The data is inlined rather than fetched, so the file opens from
// disk with no server and no CORS, and it stays readable years after the tooling around it
// has moved on.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { currentFrameId, type Config } from "./config.js";
import { ConfigError } from "./errors.js";
import { PlanSchema, RecordedExpectationSchema, type Plan } from "./schema.js";
import { forwardFrameIds, type ScoreResult } from "./score.js";
import { explainFrame, type WhyReport } from "./why.js";
import { runEval } from "./eval.js";
import { unfence } from "./validate.js";

export interface ViewerFrame extends WhyReport {
  /**
   * The id this run wrote, when the frame has since been renamed. The page reports frames under
   * today's names so the corpus joins, but the run's own synthesis.md and artifacts still say
   * the old one, and a reader looking at both needs to know they are the same frame.
   */
  recorded_as: string | null;
  /** Straight from score.json rather than scraped out of the terminal report, which clips. */
  position: string | null;
  forecloses: string[];
  falsifier: string | null;
  missing_actor: string | null;
}

export interface ViewerRun {
  id: string;
  control: boolean;
  problem: string;
  problem_hash: string;
  problem_class: string;
  seed: number;
  frames: ViewerFrame[];
  clusters: ScoreResult["clusters"];
  /**
   * The one frame that holds the recommendation, decided here rather than in the page so the
   * viewer and the synthesis cannot disagree. Every cluster has a representative; only the top
   * live cluster whose representative defended holds the answer.
   */
  recommendation: string | null;
  run_level: ScoreResult["run_level"] | null;
  synthesis: string | null;
  expected: { outcome: string; note?: string } | null;
  eval: { outcome: string; failures: string[]; notes: string[] } | null;
  cost: { tokens?: number; by_phase?: Record<string, number> } | null;
  raters: number;
}

export interface ViewerData {
  generated: string;
  frames: { id: string; name: string; axis: string; attacks: string[] }[];
  dimensions: { id: string; weight: number; question: string }[];
  traps: string[];
  runs: ViewerRun[];
}

const readIf = <T>(p: string, f: (raw: string) => T): T | null => (existsSync(p) ? f(readFileSync(p, "utf8")) : null);

export function collect(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded")): ViewerData {
  if (!existsSync(recordedDir)) throw new ConfigError([`${recordedDir}: no recorded runs to view`]);

  // The eval verdict per run, so the page can say which runs are recorded as failing and why
  // without re-deriving anything. Six of nine fail by design and a viewer that hid that would
  // be lying by omission.
  const evalByRun = new Map<string, { outcome: string; failures: string[]; notes: string[] }>();
  try {
    for (const p of runEval(cfg, { recordedDir }).pairs) evalByRun.set(p.recorded.split("/").pop() ?? p.recorded, { outcome: p.outcome, failures: p.failures, notes: p.notes });
  } catch {
    // A broken fixture should not stop the viewer rendering the runs themselves.
  }

  const runs: ViewerRun[] = [];
  for (const id of readdirSync(recordedDir).sort()) {
    const dir = join(recordedDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const plan = readIf<Plan>(join(dir, "plan.json"), (r) => PlanSchema.parse(JSON.parse(r)));
    const score = readIf<ScoreResult>(join(dir, "score.json"), (r) => forwardFrameIds(cfg, JSON.parse(r) as ScoreResult));
    const expected = readIf(join(dir, "expected.json"), (r) => RecordedExpectationSchema.parse(JSON.parse(r)));

    // Frames the run actually dispatched. A control has no plan, so fall back to whatever the
    // scorer recorded; anything with neither is a directory the viewer can only name.
    // `score` is already forwarded; `plan` is raw, so forward it too or a renamed frame would
    // show under two names depending on which file the run happens to carry.
    const recorded = plan ? plan.branches.map((b) => b.frame) : (score?.frames ?? []).map((f) => f.frame);
    const frames: ViewerFrame[] = recorded.map((was) => {
      const f = currentFrameId(cfg, was);
      const scored = score?.frames.find((x) => x.frame === f);
      return {
        ...explainFrame(cfg, dir, f),
        recorded_as: was === f ? null : was,
        position: scored?.position ?? null,
        forecloses: scored?.forecloses ?? [],
        falsifier: scored?.falsifier ?? null,
        missing_actor: scored?.missing_actor ?? null,
      };
    });

    runs.push({
      id,
      control: expected?.control ?? false,
      problem: readIf(join(dir, "problem.txt"), (r) => r) ?? "",
      problem_hash: plan?.problem_hash ?? "",
      problem_class: plan?.problem_class ?? "",
      seed: plan?.seed ?? 0,
      frames,
      clusters: score?.clusters ?? [],
      recommendation: score ? recommendationHolder(score, dir, cfg) : null,
      run_level: score?.run_level ?? null,
      synthesis: readIf(join(dir, "synthesis.md"), (r) => r),
      expected: expected ? { outcome: expected.outcome, note: expected.note } : null,
      eval: evalByRun.get(id) ?? null,
      cost: readIf(join(dir, "cost.json"), (r) => JSON.parse(r) as { tokens?: number }),
      raters: existsSync(join(dir, "critic")) ? readdirSync(join(dir, "critic")).filter((f) => /^pass-a(\.rater\d+)?\.yaml$/.test(f)).length : 0,
    });
  }

  return {
    generated: new Date().toISOString().slice(0, 10),
    frames: cfg.frames.frames.map((f) => ({ id: f.id, name: f.name, axis: f.axis, attacks: [...f.attacks] })),
    dimensions: cfg.rubric.dimensions.map((d) => ({ id: d.id, weight: d.weight, question: d.question })),
    traps: trapIds(cfg),
    runs,
  };
}

/**
 * The same ordering `renderSynthesis` uses: live clusters by size, then mean pass A, and the
 * first whose representative did not fold. A run-level failure produces no recommendation at
 * all, whatever the clusters look like. Duplicated logic would drift, so this reads the same
 * inputs and the viewer test pins it against the recorded synthesis.
 */
function recommendationHolder(score: ScoreResult, dir: string, cfg: Config): string | null {
  if (score.run_level.monoculture || score.run_level.scatter) return null;
  const live = [...score.clusters]
    .filter((c) => c.survivors.length > 0)
    .sort((a, b) => b.survivors.length - a.survivors.length || (b.mean_pass_a ?? 0) - (a.mean_pass_a ?? 0));
  for (const c of live) {
    if (!c.representative) continue;
    const d = explainFrame(cfg, dir, c.representative).deepen;
    if (!d || d.verdict === "defend") return c.representative;
  }
  return null;
}

function trapIds(cfg: Config): string[] {
  const md = readIf(join(cfg.root, "docs", "TRAPS.md"), (r) => r) ?? "";
  return [...new Set((md.match(/^##\s+(T\d)/gm) ?? []).map((h) => h.trim().split(/\s+/)[1]!))];
}

/** Reads the page shell and inlines the data. The shell is an asset so it stays editable. */
export function buildViewer(cfg: Config, opts: { recordedDir?: string; shell?: string } = {}): string {
  const shellPath = opts.shell ?? join(cfg.root, "assets", "viewer.html");
  const shell = readIf(shellPath, (r) => r);
  if (!shell) throw new ConfigError([`${shellPath}: the viewer page shell is missing`]);
  if (!shell.includes(DATA_MARKER)) throw new ConfigError([`${shellPath}: no ${DATA_MARKER} placeholder to inline the data into`]);
  const data = collect(cfg, opts.recordedDir);
  // `</script>` inside the JSON would close the tag early and drop the rest of the page, so the
  // slash is escaped. `\/` is a valid JSON escape for `/`, which means the text parses back
  // byte for byte. The match is case-insensitive because the parser's is, and the replacement
  // keeps the matched casing: a fixed lowercase replacement rewrote `</SCRIPT` in a problem
  // statement, which is a run's verbatim input and must not be edited by the viewer.
  const json = JSON.stringify(data).replace(/<\/script/gi, (m) => `<\\/${m.slice(2)}`);
  return shell.replace(DATA_MARKER, json);
}

export const DATA_MARKER = "/*__ADHD_DATA__*/null";

export function writeViewer(cfg: Config, outPath: string, opts: { recordedDir?: string } = {}): { path: string; runs: number; frames: number; bytes: number } {
  const html = buildViewer(cfg, opts);
  writeFileSync(outPath, html);
  const data = collect(cfg, opts.recordedDir);
  return { path: outPath, runs: data.runs.length, frames: data.runs.reduce((s, r) => s + r.frames.length, 0), bytes: Buffer.byteLength(html, "utf8") };
}

/** Pass A rows keyed by frame, for a run whose critic wrote one. Used by the page's rubric view. */
export function passARows(runDir: string): Record<string, Record<string, { score: number; evidence: string }>> | null {
  const pa = readIf(join(runDir, "critic", "pass-a.yaml"), (r) => parseYaml(unfence(r)) as { scores?: Record<string, Record<string, { score: number; evidence: string }>> });
  const map = readIf(join(runDir, "critic", "blind-map.json"), (r) => JSON.parse(r) as Record<string, string>);
  if (!pa?.scores || !map) return null;
  const out: Record<string, Record<string, { score: number; evidence: string }>> = {};
  for (const [letter, frame] of Object.entries(map)) if (pa.scores[letter]) out[frame] = pa.scores[letter]!;
  return out;
}
