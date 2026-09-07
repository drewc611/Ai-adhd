// Re-render a run's synthesis from its artifacts, and say whether it still matches (backlog 40).
//
// A recorded run's synthesis.md is the thing a reader is shown, and every claim this repository
// makes about what a run found is a claim about that file. It was written once, by whatever the
// renderer did on the day. Nothing since has checked that the same artifacts still produce it.
//
// A change to `src/synth.ts`, the scorer, the cluster ranking or the pruned block would silently
// make every recorded synthesis a description of a rendering that no longer happens. The eval
// harness would not catch it: it reads the artifacts and the fixture assertions, not the prose.
//
// So replay renders and compares. It never writes over a recording unless asked, because a check
// that has to overwrite the evidence to run is not a check.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { renderRun } from "./run.js";

export interface ReplayResult {
  run: string;
  /** The baseline's reason this run is expected to drift, if it is listed there. */
  expected_drift: string | null;
  /** Whether the run had a synthesis.md to compare against at all. */
  had_recorded: boolean;
  same: boolean;
  /** First line number where the two differ, 1-based. Null when they match. */
  first_diff_line: number | null;
  recorded_lines: number;
  rendered_lines: number;
  /** The rendered text. Held so a caller can print or write it without rendering twice. */
  rendered: string;
  error: string | null;
}

export interface ReplayReport {
  runs: ReplayResult[];
  /** Drifted and not in the baseline. These are regressions. */
  drifted: ReplayResult[];
  /** Drifted exactly as the baseline says they should. */
  expected: ReplayResult[];
  /** In the baseline and no longer drifting, so the baseline is stale. */
  stale_baseline: string[];
  failed: ReplayResult[];
  text: string;
}

export interface Baseline {
  why: string;
  drifted: Record<string, string>;
}

/**
 * Runs known to render differently from their recording, with the reason for each.
 *
 * A gate that fails forever is a gate people learn to ignore, and the four entries here are
 * renderer improvements made after those runs were recorded, not defects. The file also fails
 * in the other direction: a listed run that starts matching again means the baseline is stale,
 * and a stale baseline is how a real regression gets waved through.
 */
export function loadBaseline(cfg: Config): Baseline {
  const p = join(cfg.root, "evals", "replay-baseline.json");
  if (!existsSync(p)) return { why: "", drifted: {} };
  return JSON.parse(readFileSync(p, "utf8")) as Baseline;
}

/**
 * Is this a cancelled run, which renders through the partial path?
 *
 * Pass B is the determinant, because the partial rendering exists precisely for a run cancelled
 * before the critic finished. The obvious shortcut — grep the recorded synthesis for "cancelled"
 * or "partial" — is wrong in a way worth recording: fixture 001 is a question *about* a cancel
 * button, so every branch of `001-first-run` says "cancel" repeatedly and the whole run rendered
 * as a cancellation. A heuristic over prose cannot distinguish a run's state from its subject.
 */
function isPartial(runDir: string): boolean {
  return !existsSync(join(runDir, "critic", "pass-b.yaml"));
}

function firstDiffLine(a: string, b: string): number | null {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) if (la[i] !== lb[i]) return i + 1;
  return null;
}

/** Re-render one run and compare against the synthesis.md sitting beside its artifacts. */
export function replayRun(cfg: Config, runDir: string, opts: { write?: boolean; baseline?: Baseline } = {}): ReplayResult {
  const name = runDir.split("/").filter(Boolean).pop() ?? runDir;
  const expectedDrift = (opts.baseline ?? loadBaseline(cfg)).drifted[name] ?? null;
  const recordedPath = join(runDir, "synthesis.md");
  const hadRecorded = existsSync(recordedPath);
  let rendered: string;
  try {
    rendered = renderRun(cfg, runDir, { partial: isPartial(runDir) });
  } catch (e) {
    return { run: name, expected_drift: expectedDrift, had_recorded: hadRecorded, same: false, first_diff_line: null, recorded_lines: 0, rendered_lines: 0, rendered: "", error: (e as Error).message };
  }
  if (opts.write) writeFileSync(recordedPath, rendered);
  if (!hadRecorded) return { run: name, expected_drift: expectedDrift, had_recorded: false, same: false, first_diff_line: null, recorded_lines: 0, rendered_lines: rendered.split("\n").length, rendered, error: null };
  const recorded = readFileSync(recordedPath, "utf8");
  const same = recorded === rendered;
  return {
    run: name,
    expected_drift: expectedDrift,
    had_recorded: true,
    same,
    first_diff_line: same ? null : firstDiffLine(recorded, rendered),
    recorded_lines: recorded.split("\n").length,
    rendered_lines: rendered.split("\n").length,
    rendered,
    error: null,
  };
}

/**
 * Replay every recorded run. This is the regression test the corpus could not previously have:
 * a renderer change that alters what seven recorded runs say now fails here rather than being
 * discovered by a reader who trusted a file nobody re-derived.
 */
export function replayAll(cfg: Config, recordedDir = join(cfg.root, "evals", "recorded"), opts: { write?: boolean } = {}): ReplayReport {
  const baseline = loadBaseline(cfg);
  const runs: ReplayResult[] = [];
  if (existsSync(recordedDir))
    for (const d of readdirSync(recordedDir).sort()) {
      const dir = join(recordedDir, d);
      // A negative control is a hand-written answer, not a run: no plan, nothing to re-render.
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, "plan.json"))) continue;
      runs.push(replayRun(cfg, dir, { ...opts, baseline }));
    }

  const failed = runs.filter((r) => r.error !== null);
  const allDrifted = runs.filter((r) => r.error === null && r.had_recorded && !r.same);
  const expected = allDrifted.filter((r) => r.expected_drift !== null);
  const drifted = allDrifted.filter((r) => r.expected_drift === null);
  const staleBaseline = runs.filter((r) => r.error === null && r.same && r.expected_drift !== null).map((r) => r.run);

  const lines = [`replay over ${runs.length} recorded run(s) with a plan.json`];
  lines.push("");
  for (const r of runs) {
    const verdict = r.error
      ? `ERROR ${r.error}`
      : !r.had_recorded
        ? "no synthesis.md recorded"
        : r.same
          ? r.expected_drift
            ? `same, but the baseline expects drift — STALE BASELINE ENTRY`
            : `same (${r.recorded_lines} lines)`
          : r.expected_drift
            ? `drifted as the baseline records, from line ${r.first_diff_line}`
            : `DRIFTED, first differs at line ${r.first_diff_line} (${r.recorded_lines} recorded, ${r.rendered_lines} rendered)`;
    lines.push(`${r.run.padEnd(22)} ${verdict}`);
  }
  lines.push("");
  if (!runs.length) lines.push("nothing to replay.");
  if (failed.length)
    lines.push(`${failed.length} run(s) could not be re-rendered at all: ${failed.map((r) => r.run).join(", ")}. That is a harder failure than drift — the artifacts no longer satisfy the code that reads them.`);
  if (drifted.length)
    lines.push(
      `${drifted.length} run(s) drifted and are not in evals/replay-baseline.json: ${drifted.map((r) => r.run).join(", ")}. Either a renderer change altered what these runs say, or a recording was edited by hand. Read the diff and decide which before adding a baseline entry; the entry has to say why.`,
    );
  if (staleBaseline.length)
    lines.push(
      `${staleBaseline.length} baseline entry(ies) are stale: ${staleBaseline.join(", ")} now render as recorded. Remove them. A baseline that forgives drift which is no longer happening is how the next real regression gets waved through.`,
    );
  if (expected.length) lines.push(`${expected.length} run(s) drifted as recorded in the baseline: ${expected.map((r) => r.run).join(", ")}. Their recordings are kept as written; the reasons are in that file.`);
  if (!drifted.length && !failed.length && !staleBaseline.length && runs.length) lines.push("No unexplained drift.");
  if (opts.write) lines.push("--write was passed: recordings were overwritten with the current rendering.");

  return { runs, drifted, expected, stale_baseline: staleBaseline, failed, text: lines.join("\n") };
}
