// The eval harness. Never calls a model. Replays recorded runs against fixture assertions.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { FixtureSchema, RecordedExpectationSchema, type Fixture } from "./schema.js";
import { problemHash, PLACEHOLDER_HASH } from "./hash.js";
import { hasImperative, IMPERATIVE_START, splitSentences, wordCount } from "./lint.js";
import type { ScoreResult } from "./score.js";

export interface PairResult {
  fixture: string;
  recorded: string;
  outcome: "pass" | "fail";
  expected: "pass" | "fail";
  /** outcome === expected */
  ok: boolean;
  /** From expected.json when present. Says why a failing run is recorded as failing. */
  expected_note?: string;
  failures: string[];
  notes: string[];
}

export interface EvalReport {
  pairs: PairResult[];
  fixtures_without_runs: string[];
  ok: boolean;
}

export function loadFixtures(dir: string): Fixture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const r = FixtureSchema.safeParse(parseYaml(readFileSync(join(dir, f), "utf8")));
      if (!r.success) throw new Error(`${join(dir, f)}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return r.data;
    });
}

/** Split synthesis.md into sections keyed by "## " heading text. */
export function sections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = md.split(/^## /m);
  for (const p of parts.slice(1)) {
    const nl = p.indexOf("\n");
    const title = (nl === -1 ? p : p.slice(0, nl)).trim();
    out[title] = nl === -1 ? "" : p.slice(nl + 1);
  }
  return out;
}

const SCOPE_TITLES: Record<string, string> = { recommendation: "Recommendation", pruned: "Pruned, with reason" };

interface RecordedRun {
  dir: string;
  synthesis: string;
  branches: string;
  survivingBranches: string;
  score: ScoreResult | null;
  hash: string | null;
}

function loadRecorded(dir: string): RecordedRun {
  const synthesis = existsSync(join(dir, "synthesis.md")) ? readFileSync(join(dir, "synthesis.md"), "utf8") : "";
  const bdir = join(dir, "branches");
  const branchFiles = existsSync(bdir) ? readdirSync(bdir).filter((f) => f.endsWith(".yaml")) : [];
  const branchText = (files: string[]) => files.map((f) => readFileSync(join(bdir, f), "utf8")).join("\n---\n");
  const score = existsSync(join(dir, "score.json")) ? (JSON.parse(readFileSync(join(dir, "score.json"), "utf8")) as ScoreResult) : null;
  const surviving = score ? new Set(score.frames.filter((f) => f.status === "survivor").map((f) => f.frame)) : null;
  let hash: string | null = null;
  if (existsSync(join(dir, "plan.json"))) hash = (JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as { problem_hash?: string }).problem_hash ?? null;
  else {
    const m = synthesis.match(/problem_hash:\s*`?(sha256:[0-9a-f]+|sha256:pending)`?/);
    hash = m ? m[1]! : null;
  }
  return {
    dir,
    synthesis,
    branches: branchText(branchFiles),
    survivingBranches: surviving ? branchText(branchFiles.filter((f) => surviving.has(f.replace(/\.yaml$/, "")))) : branchText(branchFiles),
    score,
    hash,
  };
}

/** Markdown emphasis and code marks are stripped so "**Set x**" still reads as an imperative. */
function plain(md: string): string {
  return md.replace(/[*_`]/g, "");
}

function scopeText(run: RecordedRun, scope: string): string {
  const secs = sections(run.synthesis);
  if (scope === "all") return plain(`${run.synthesis}\n${run.survivingBranches}`);
  const title = SCOPE_TITLES[scope]!;
  return plain(secs[title] ?? "");
}

/**
 * First matching pattern's match text, or null. Case insensitive, single line: `^` is the
 * start of the scope text, so a fixture can anchor to the bold line of the recommendation.
 * An empty match is still a match (a lookahead can match zero characters).
 */
function anyMatch(text: string, patterns: string[]): string | null {
  for (const p of patterns) {
    const re = new RegExp(p, "i");
    const m = text.match(re);
    if (m !== null) return m[0];
  }
  return null;
}

export function evaluatePair(fixture: Fixture, run: RecordedRun): PairResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const expectation = existsSync(join(run.dir, "expected.json"))
    ? RecordedExpectationSchema.parse(JSON.parse(readFileSync(join(run.dir, "expected.json"), "utf8")))
    : { outcome: "pass" as const, note: undefined };
  const expected = expectation.outcome;

  const want = problemHash(fixture.prompt);
  if (run.hash === PLACEHOLDER_HASH || run.hash === null) notes.push("recorded run carries no real problem_hash; hash check skipped");
  else if (run.hash !== want) failures.push(`problem_hash: recorded ${run.hash} != fixture ${want} (paraphrase drift or wrong fixture)`);

  for (const ms of fixture.must_surface) {
    const text = scopeText(run, ms.scope);
    if (anyMatch(text, ms.any_of) === null) failures.push(`must_surface ${ms.id}${ms.trap ? ` (${ms.trap})` : ""}: ${ms.description.trim()}`);
  }
  for (const mn of fixture.must_not) {
    const text = scopeText(run, mn.scope);
    if (mn.check === "min_words_outside") {
      const stripped = text.replace(new RegExp(mn.pattern, "gi"), " ");
      const w = wordCount(stripped);
      if (w < mn.min_words) failures.push(`must_not ${mn.id}: only ${w} words outside /${mn.pattern}/ in ${mn.scope} (need ${mn.min_words})`);
    } else if (mn.check === "must_match") {
      if (anyMatch(text, mn.any_of) === null) failures.push(`must_not ${mn.id}${mn.trap ? ` (${mn.trap})` : ""}: ${mn.description.trim()}`);
    } else if (mn.check === "must_be_imperative") {
      if (!hasImperative(text)) failures.push(`must_not ${mn.id}${mn.trap ? ` (${mn.trap})` : ""}: no "do X" sentence in ${mn.scope}`);
    } else {
      const items = text.split("\n").filter((l) => /^\s*([-*]|\d+\.)\s+/.test(l)).length;
      const imperative = splitSentences(text.replace(/[*_`#]/g, "")).some((s) => IMPERATIVE_START.test(s));
      if (items > mn.max_items && !imperative) failures.push(`must_not ${mn.id}: ${items} list items and no imperative sentence in ${mn.scope}`);
    }
  }
  const secs = sections(run.synthesis);
  const prunedSec = secs["Pruned, with reason"] ?? "";
  const prunedCount = prunedSec.split("\n").filter((l) => /^- \*\*/.test(l)).length;
  const ex = fixture.expect;
  if (ex.pruned_min !== undefined && prunedCount < ex.pruned_min) failures.push(`expect pruned_min ${ex.pruned_min}: pruned block lists ${prunedCount}`);
  if (ex.pruned_traps_include_any && null === anyMatch(prunedSec, ex.pruned_traps_include_any.map((t) => `\\b${t}\\b`)))
    failures.push(`expect pruned_traps_include_any ${ex.pruned_traps_include_any.join(",")}: none named in pruned block`);
  if (ex.monoculture !== undefined || ex.scatter !== undefined) {
    if (run.score) {
      if (ex.monoculture !== undefined && run.score.run_level.monoculture !== ex.monoculture) failures.push(`expect monoculture ${ex.monoculture}`);
      if (ex.scatter !== undefined && run.score.run_level.scatter !== ex.scatter) failures.push(`expect scatter ${ex.scatter}`);
    } else {
      const rl = secs["Run level"] ?? "";
      if (ex.monoculture === false && /MONOCULTURE/.test(rl)) failures.push("expect monoculture false: run level reports monoculture");
      if (ex.scatter === false && /SCATTER/.test(rl)) failures.push("expect scatter false: run level reports scatter");
      notes.push("no score.json; monoculture/scatter read from synthesis text");
    }
  }
  const outcome = failures.length ? "fail" : "pass";
  return { fixture: fixture.id, recorded: run.dir, outcome, expected, ok: outcome === expected, expected_note: expectation.note, failures, notes };
}

export function runEval(cfg: Config, opts: { fixturesDir?: string; recordedDir?: string } = {}): EvalReport {
  const fixturesDir = opts.fixturesDir ?? join(cfg.root, "evals", "fixtures");
  const recordedDir = opts.recordedDir ?? join(cfg.root, "evals", "recorded");
  const fixtures = loadFixtures(fixturesDir);
  const recorded = existsSync(recordedDir) ? readdirSync(recordedDir).filter((d) => statSync(join(recordedDir, d)).isDirectory()).sort() : [];
  const pairs: PairResult[] = [];
  const without: string[] = [];
  for (const fx of fixtures) {
    const runs = recorded.filter((d) => d.startsWith(`${fx.id}-`) || d === fx.id);
    if (!runs.length) without.push(fx.id);
    for (const d of runs) pairs.push(evaluatePair(fx, loadRecorded(join(recordedDir, d))));
  }
  return { pairs, fixtures_without_runs: without, ok: pairs.every((p) => p.ok) };
}

export function formatEvalReport(r: EvalReport): string {
  const lines: string[] = [];
  for (const p of r.pairs) {
    const tag = p.ok ? "OK  " : "BAD ";
    const expectedTag = p.expected === "fail" ? ` (expected to fail${p.expected_note ? `: ${p.expected_note}` : ""})` : "";
    lines.push(`${tag} fixture ${p.fixture}  ${p.recorded}  -> ${p.outcome.toUpperCase()}${expectedTag}`);
    for (const f of p.failures) lines.push(`       x ${f}`);
    for (const n of p.notes) lines.push(`       . ${n}`);
  }
  for (const f of r.fixtures_without_runs) lines.push(`--   fixture ${f}  no recorded runs`);
  lines.push(r.ok ? "eval: all recorded runs match their expected outcome" : "eval: MISMATCH");
  return lines.join("\n");
}
