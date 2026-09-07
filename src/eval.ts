// The eval harness. Never calls a model. Replays recorded runs against fixture assertions.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { FixtureSchema, RecordedExpectationSchema, type Fixture } from "./schema.js";
import { problemHash, PLACEHOLDER_HASH } from "./hash.js";
import { hasImperative, IMPERATIVE_START, lintProblemInjection, splitSentences, wordCount } from "./lint.js";
import type { ScoreResult } from "./score.js";
import { compile, previewText } from "./compile.js";

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

/**
 * Fixture `any_of` entries are regular expressions on purpose: that is how an assertion says
 * what counts as surfacing something. They are repo content, held to the same trust as the code
 * beside them, and they are compiled here rather than at match time so a broken pattern fails
 * once, loudly, naming the fixture and the item, instead of silently never matching. An
 * assertion that cannot match is an assertion that cannot fail, which is worse than a missing
 * one because the harness reports it as a pass.
 */
function uncompilablePatterns(fx: Fixture): string[] {
  const problems: string[] = [];
  const check = (where: string, patterns: string[]) => {
    for (const p of patterns) {
      try {
        new RegExp(p, "i");
      } catch (e) {
        problems.push(`${where}: /${p}/ does not compile: ${(e as Error).message}`);
      }
      if (p.trim() === "" || p === ".*") problems.push(`${where}: /${p}/ matches everything, so the assertion cannot fail`);
    }
  };
  for (const ms of fx.must_surface) check(`must_surface ${ms.id}`, ms.any_of);
  for (const mn of fx.must_not) if (mn.check === "must_match") check(`must_not ${mn.id}`, mn.any_of);
  return problems;
}

export function loadFixtures(dir: string): Fixture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const r = FixtureSchema.safeParse(parseYaml(readFileSync(join(dir, f), "utf8")));
      if (!r.success) throw new Error(`${join(dir, f)}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      const bad = uncompilablePatterns(r.data);
      if (bad.length) throw new Error(`${join(dir, f)}: ${bad.join("; ")}`);
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
  control: boolean;
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
  const control = existsSync(join(dir, "expected.json"))
    ? RecordedExpectationSchema.parse(JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"))).control
    : false;
  return {
    control,
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

/**
 * A decline fixture has no run to replay. Routing refuses the class before anything is compiled,
 * so there is no synthesis, no pruned block, and nothing to record: the assertion is the decision
 * itself. That is checked against config/routing.yaml directly, which means it runs on every eval
 * without needing a recorded run to exist.
 *
 * A decline is a first-class outcome and it was the only one nothing tested. A routing edit that
 * quietly starts spending five subagents on "what is the default TCP keepalive interval" would
 * have passed the whole suite.
 */
/**
 * The problem reaches every branch verbatim, which is the design, and that is exactly why a
 * problem carrying convergence language is dangerous: one sentence compromises every branch
 * identically, and isolation cannot see it because no branch is anomalous. The defence is the
 * D5 gate, where a human reads the warning before anything is spent. This asserts the warning
 * exists, which is the only part a fixture can check without a model.
 */
function evaluateGate(cfg: Config, fixture: Fixture): PairResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const want = fixture.expect.injection_warnings_min!;
  const warnings = lintProblemInjection(fixture.prompt);
  if (warnings.length < want) failures.push(`expect at least ${want} injection warning(s) at the gate, got ${warnings.length}`);
  const r = compile(cfg, fixture.prompt, { problem_class: fixture.problem_class }, { seed: fixture.seed });
  const preview = previewText(r);
  for (const w of warnings) if (!preview.includes(w.match)) failures.push(`the gate does not show the phrase it warned about: ${w.match}`);
  if (warnings.length && !/read as instructions to the branches/.test(preview)) failures.push("the preview warns without saying what the phrases are");
  // Warn, never block. The passthrough is the design and a person may be asking about injection.
  if (r.kind === "declined") failures.push("a hostile problem must still compile: the gate warns, it does not refuse");
  else if (!preview.includes(fixture.prompt)) failures.push("the gate must show the problem verbatim, hostile or not");
  for (const w of warnings) notes.push(`gate warned: "${w.match}" (${w.why})`);
  const outcome = failures.length ? "fail" : "pass";
  return { fixture: fixture.id, recorded: "(no run: gate only)", outcome, expected: "pass", ok: outcome === "pass", failures, notes };
}

function evaluateDecline(cfg: Config, fixture: Fixture): PairResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const r = compile(cfg, fixture.prompt, { problem_class: fixture.problem_class }, { seed: fixture.seed });
  if (r.kind !== "declined") failures.push(`expect decline: routing compiled ${r.plan.branches.length} branch(es) for problem_class ${fixture.problem_class}`);
  else {
    const preview = previewText(r);
    if (!r.reason.trim()) failures.push("expect decline: the reason is empty, so the user is told no without being told why");
    for (const want of fixture.expect.reason_includes)
      if (!new RegExp(want, "i").test(r.reason)) failures.push(`expect decline reason to include /${want}/i, got: ${r.reason}`);
    if (!/nothing spent/i.test(preview)) failures.push("expect the preview to say nothing was spent");
    notes.push(`declined: ${r.reason}`);
  }
  const outcome = failures.length ? "fail" : "pass";
  return { fixture: fixture.id, recorded: "(no run: declined)", outcome, expected: "pass", ok: outcome === "pass", failures, notes };
}

export function runEval(cfg: Config, opts: { fixturesDir?: string; recordedDir?: string } = {}): EvalReport {
  const fixturesDir = opts.fixturesDir ?? join(cfg.root, "evals", "fixtures");
  const recordedDir = opts.recordedDir ?? join(cfg.root, "evals", "recorded");
  const fixtures = loadFixtures(fixturesDir);
  const recorded = existsSync(recordedDir) ? readdirSync(recordedDir).filter((d) => statSync(join(recordedDir, d)).isDirectory()).sort() : [];
  const pairs: PairResult[] = [];
  const without: string[] = [];
  for (const fx of fixtures) {
    if (fx.expect.decline) {
      pairs.push(evaluateDecline(cfg, fx));
      continue;
    }
    if (fx.expect.injection_warnings_min !== undefined && !fx.must_surface.length) {
      pairs.push(evaluateGate(cfg, fx));
      continue;
    }
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

export interface ItemAudit {
  fixture: string;
  item: string;
  kind: "must_surface" | "must_not";
  real_matched: number;
  real_total: number;
  control_matched: number;
  control_total: number;
  /** The literal text in a control that satisfied the assertion. What makes the finding actionable. */
  control_evidence: string | null;
  verdict: "discriminating" | "matches a control" | "never matched" | "no evidence yet";
}

/**
 * Fixture quality, not run quality. An assertion the consensus answer also satisfies is not
 * measuring divergence, and an assertion nothing has ever matched cannot be told apart from
 * one that is unreachable. Both are silent: the harness reports a clean pass either way.
 *
 * This exists because fixture 004's `false_means` turned out to be satisfied by a stock line
 * in the negative control, and that was noticed by hand. Noticing it by hand does not scale.
 */
export function auditFixtures(cfg: Config, opts: { fixturesDir?: string; recordedDir?: string } = {}): { items: ItemAudit[]; text: string } {
  const fixturesDir = opts.fixturesDir ?? join(cfg.root, "evals", "fixtures");
  const recordedDir = opts.recordedDir ?? join(cfg.root, "evals", "recorded");
  const fixtures = loadFixtures(fixturesDir);
  const runs = existsSync(recordedDir)
    ? readdirSync(recordedDir)
        .filter((d) => statSync(join(recordedDir, d)).isDirectory())
        .map((d) => loadRecorded(join(recordedDir, d)))
    : [];
  const items: ItemAudit[] = [];

  for (const fx of fixtures) {
    const forFixture = runs.filter((r) => r.dir.split("/").pop()!.startsWith(`${fx.id}-`));
    const real = forFixture.filter((r) => !r.control);
    const controls = forFixture.filter((r) => r.control);
    const hit = (r: RecordedRun, scope: string, patterns: string[]) => anyMatch(scopeText(r, scope), patterns);
    const hits = (r: RecordedRun, scope: string, patterns: string[]) => hit(r, scope, patterns) !== null;

    for (const ms of fx.must_surface) {
      const rm = real.filter((r) => hits(r, ms.scope, ms.any_of)).length;
      const cm = controls.filter((r) => hits(r, ms.scope, ms.any_of)).length;
      const cev = controls.map((r) => hit(r, ms.scope, ms.any_of)).find((x) => x !== null) ?? null;
      items.push({
        fixture: fx.id,
        item: ms.id,
        kind: "must_surface",
        control_evidence: cev,
        real_matched: rm,
        real_total: real.length,
        control_matched: cm,
        control_total: controls.length,
        verdict: cm > 0 ? "matches a control" : real.length === 0 ? "no evidence yet" : rm === 0 ? "never matched" : "discriminating",
      });
    }
    for (const mn of fx.must_not) {
      if (mn.check !== "must_match") continue;
      const rm = real.filter((r) => hits(r, mn.scope, mn.any_of)).length;
      const cm = controls.filter((r) => hits(r, mn.scope, mn.any_of)).length;
      const cev = controls.map((r) => hit(r, mn.scope, mn.any_of)).find((x) => x !== null) ?? null;
      items.push({
        fixture: fx.id,
        item: mn.id,
        kind: "must_not",
        control_evidence: cev,
        real_matched: rm,
        real_total: real.length,
        control_matched: cm,
        control_total: controls.length,
        verdict: real.length === 0 ? "no evidence yet" : rm === 0 ? "never matched" : "discriminating",
      });
    }
  }

  const lines = [`fixture audit over ${runs.length} recorded run(s): ${runs.filter((r) => !r.control).length} real, ${runs.filter((r) => r.control).length} control`, ""];
  lines.push(`${"fixture".padEnd(8)} ${"item".padEnd(26)} real  ctrl  verdict`);
  for (const i of items)
    lines.push(
      `${i.fixture.padEnd(8)} ${i.item.padEnd(26)} ${`${i.real_matched}/${i.real_total}`.padStart(4)}  ${`${i.control_matched}/${i.control_total}`.padStart(4)}  ${i.verdict === "matches a control" ? "!! " : i.verdict === "never matched" ? " ? " : "   "}${i.verdict}`,
    );

  const bad = items.filter((i) => i.verdict === "matches a control");
  const cold = items.filter((i) => i.verdict === "never matched");
  lines.push("");
  if (bad.length)
    lines.push(
      `${bad.length} assertion(s) the consensus answer already satisfies: ${bad.map((i) => `${i.fixture}/${i.item}`).join(", ")}.`,
      `  A control passing an assertion means that assertion does not measure divergence. Either the`,
      `  frame set has a real gap the control happens to cover, or the pattern rewards recitation.`,
      `  Decide which; do not loosen the pattern to make the report quiet.`,
      ...bad.map((i) => `    ${i.fixture}/${i.item} matched on: "${(i.control_evidence ?? "").replace(/\s+/g, " ").slice(0, 90)}"`),
    );
  if (cold.length) lines.push(`${cold.length} assertion(s) no real run has ever matched: ${cold.map((i) => `${i.fixture}/${i.item}`).join(", ")}. A stretch goal and an unreachable pattern look identical here.`);
  if (!bad.length && !cold.length) lines.push("every assertion is matched by at least one real run and by no control.");
  return { items, text: lines.join("\n") };
}
