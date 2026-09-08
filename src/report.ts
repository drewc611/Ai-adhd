// Reporting surfaces over the recorded corpus (catalogue 35, 46, 47). Never calls a model.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { currentFrameId } from "./config.js";
import { assertionHistory } from "./fixtures.js";
import { forwardFrameIds, type ScoreResult } from "./score.js";

// ---- run comparison matrix (catalogue 46) --------------------------------------------------

export interface MatrixReport {
  runs: string[];
  items: string[];
  /** cells[item][run] is "held", "missed", or "absent" when that fixture has no such run. */
  cells: Record<string, Record<string, "held" | "missed" | "absent">>;
  text: string;
}

/**
 * Every assertion against every run of its fixture, as a grid.
 *
 * `--history` answers "which runs held this assertion" one row at a time, which is the right
 * shape for reading one assertion and the wrong shape for seeing a pattern across runs. The
 * grid is what makes it obvious that `001-seed2` and `001-altframes` fail different assertions,
 * which is the whole finding of the two pre-registered experiments and took a person reading
 * two reports side by side to notice.
 */
export function comparisonMatrix(cfg: Config, opts: { fixturesDir?: string; recordedDir?: string } = {}): MatrixReport {
  const history = assertionHistory(cfg, opts);
  const runs = [...new Set(history.rows.flatMap((r) => [...r.passing, ...r.failing]))].sort();
  const items = history.rows.map((r) => `${r.fixture}/${r.item}`);
  const cells: MatrixReport["cells"] = {};
  for (const r of history.rows) {
    const row: Record<string, "held" | "missed" | "absent"> = {};
    for (const run of runs) row[run] = r.passing.includes(run) ? "held" : r.failing.includes(run) ? "missed" : "absent";
    cells[`${r.fixture}/${r.item}`] = row;
  }

  const mark = (v: "held" | "missed" | "absent") => (v === "held" ? " ok" : v === "missed" ? " --" : "  .");
  const width = Math.max(20, ...items.map((i) => i.length));
  const lines = [`assertion matrix: ${items.length} assertion(s) over ${runs.length} recorded run(s)`, ""];
  // Numbered columns with a legend underneath. An earlier version spelled the run names
  // downwards one character per line and produced eighteen rows of unreadable header.
  for (let i = 0; i < runs.length; i++) lines.push(`  ${String(i + 1).padStart(2)}  ${runs[i]}`);
  lines.push("");
  lines.push(`${" ".repeat(width)} ${runs.map((_, i) => String(i + 1).padStart(3)).join("")}`);
  lines.push("-".repeat(width + 1 + runs.length * 3));
  for (const item of items) lines.push(`${item.padEnd(width)} ${runs.map((r) => mark(cells[item]![r]!)).join("")}`);
  lines.push("");
  lines.push("ok = held, -- = did not hold, . = that fixture has no such run");

  // The finding the grid exists to make visible.
  const differing: string[] = [];
  for (const a of runs)
    for (const b of runs) {
      if (a >= b) continue;
      const both = items.filter((i) => cells[i]![a] !== "absent" && cells[i]![b] !== "absent");
      if (both.length < 2) continue;
      const aOnly = both.filter((i) => cells[i]![a] === "held" && cells[i]![b] === "missed");
      const bOnly = both.filter((i) => cells[i]![a] === "missed" && cells[i]![b] === "held");
      if (aOnly.length && bOnly.length) differing.push(`${a} and ${b} each hold an assertion the other misses: ${a} has ${aOnly.join(", ")}, ${b} has ${bOnly.join(", ")}`);
    }
  if (differing.length) {
    lines.push("");
    for (const d of differing) lines.push(d);
    lines.push("Different assertions have different dependencies. A single 'this run is better' reading of any such pair is wrong.");
  }
  return { runs, items, cells, text: lines.join("\n") };
}

// ---- one run as a single Markdown file (catalogue 47) --------------------------------------

/**
 * Everything about one run in one file, in the order a reader needs it.
 *
 * The run directory is a dozen files and the reader has to know which. `adhd viewer` solves
 * this for a browser; this is the version you can paste into an issue, mail to somebody, or
 * diff against another run. The pruned block goes above the branch artifacts on purpose: it is
 * the part the architecture exists to deliver and the part a reader skips if it is at the end.
 */
export function exportRun(cfg: Config, runDir: string): string {
  const read = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const name = runDir.split("/").filter(Boolean).pop() ?? runDir;
  const plan = read(join(runDir, "plan.json"));
  const parsed = plan ? (JSON.parse(plan) as { problem_class: string; seed: number; n: number; problem_hash: string; branches: { frame: string; artifact_path: string }[] }) : null;
  const score = read(join(runDir, "score.json"));
  const scored = score ? forwardFrameIds(cfg, JSON.parse(score) as ScoreResult) : null;

  const out: string[] = [`# ${name}`, ""];
  if (parsed) {
    out.push(`Class \`${parsed.problem_class}\`, seed ${parsed.seed}, n ${parsed.n}.`, "");
    out.push(`\`problem_hash: ${parsed.problem_hash}\``, "");
  }
  const problem = read(join(runDir, "problem.txt"));
  if (problem) out.push("## Problem, verbatim", "", "```", problem.trimEnd(), "```", "");

  const synthesis = read(join(runDir, "synthesis.md"));
  // Demoted one level. The synthesis is a whole document with its own H1, and pasting it under
  // this file's H1 gives the export two top-level headings and an outline that does not nest.
  if (synthesis) out.push("## Synthesis", "", synthesis.trimEnd().replace(/^(#{1,5}) /gm, "#$1 "), "");

  if (scored) {
    out.push("## Scores", "", "| frame | status | pass A | traps fired |", "|---|---|---|---|");
    for (const f of [...scored.frames].sort((a, b) => (b.pass_a ?? 0) - (a.pass_a ?? 0)))
      out.push(`| ${f.frame} | ${f.status} | ${f.pass_a === null || f.pass_a === undefined ? "-" : f.pass_a.toFixed(4)} | ${(f.fired ?? []).map((t) => t.trap).join(", ") || "-"} |`);
    out.push("");
    // Detector evidence, because a pruned frame without the text that pruned it is an assertion.
    const fired = scored.frames.flatMap((f) => (f.fired ?? []).map((t) => ({ frame: f.frame, ...t })));
    if (fired.length) {
      out.push("## Detectors that fired, with the text that fired them", "");
      for (const t of fired) out.push(`- **${t.frame}** ${t.trap}: ${t.evidence}`);
      out.push("");
    }
  }

  const bdir = join(runDir, "branches");
  if (existsSync(bdir)) {
    out.push("## Branch artifacts", "");
    for (const f of readdirSync(bdir).filter((x) => x.endsWith(".yaml")).sort()) {
      const recorded = f.replace(/\.yaml$/, "");
      const now = currentFrameId(cfg, recorded);
      out.push(`### ${now}${now === recorded ? "" : ` (recorded as ${recorded})`}`, "", "```yaml", readFileSync(join(bdir, f), "utf8").trimEnd(), "```", "");
    }
  }
  const ddir = join(runDir, "deepen");
  if (existsSync(ddir) && readdirSync(ddir).some((x) => x.endsWith(".yaml"))) {
    out.push("## Deepen", "");
    for (const f of readdirSync(ddir).filter((x) => x.endsWith(".yaml")).sort())
      out.push(`### ${currentFrameId(cfg, f.replace(/\.yaml$/, ""))}`, "", "```yaml", readFileSync(join(ddir, f), "utf8").trimEnd(), "```", "");
  }
  const cost = read(join(runDir, "cost.json"));
  if (cost) out.push("## Cost", "", "```json", cost.trimEnd(), "```", "");
  out.push("---", "", "Rendered by `adhd export` from the run directory. No model wrote this file.");
  return out.join("\n") + "\n";
}

// ---- run directory tree (catalogue 35) -----------------------------------------------------

export interface TreeEntry {
  path: string;
  bytes: number;
  dir: boolean;
}

/**
 * What a run directory holds, with sizes.
 *
 * A run is a dozen files whose names mean something specific, and the first question anybody
 * asks of an unfamiliar one is which of them exist. A missing `critic/pass-b.yaml` is the
 * difference between a cancelled run and a completed one; a missing branch artifact is a branch
 * that returned nothing, which is not the same as one that scored badly.
 */
export function runTree(runDir: string): { entries: TreeEntry[]; bytes: number; text: string } {
  const entries: TreeEntry[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        entries.push({ path: rel + "/", bytes: 0, dir: true });
        walk(full, rel);
      } else entries.push({ path: rel, bytes: statSync(full).size, dir: false });
    }
  };
  walk(runDir, "");
  const bytes = entries.reduce((a, e) => a + e.bytes, 0);

  const lines = [`${runDir}  ${entries.filter((e) => !e.dir).length} file(s), ${(bytes / 1024).toFixed(1)} KiB`, ""];
  const width = Math.max(20, ...entries.map((e) => e.path.length));
  for (const e of entries) lines.push(`${e.path.padEnd(width)}  ${e.dir ? "" : `${(e.bytes / 1024).toFixed(1)} KiB`}`);

  // What is absent matters as much as what is there, and only somebody who knows the layout can
  // tell. That is the reason this command exists rather than `ls -R`.
  const has = (p: string) => entries.some((e) => e.path === p);
  const notes: string[] = [];
  if (has("plan.json") && !has("critic/pass-b.yaml")) notes.push("no critic/pass-b.yaml: the critic never finished, so this run was cancelled or aborted before pass B.");
  if (has("plan.json") && !has("score.json")) notes.push("no score.json: nothing was scored, so any synthesis here is the unscored partial rendering.");
  if (has("plan.json")) {
    const planned = (JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as { branches?: { frame: string; artifact_path: string }[] }).branches ?? [];
    const missing = planned.filter((b) => !has(b.artifact_path));
    if (missing.length) notes.push(`planned and never returned: ${missing.map((b) => b.frame).join(", ")}. A branch that returned nothing is not one that scored badly.`);
  }
  if (!has("plan.json")) notes.push("no plan.json: this is a hand-written negative control, not a run.");
  if (notes.length) {
    lines.push("");
    for (const n of notes) lines.push(n);
  }
  return { entries, bytes, text: lines.join("\n") };
}
