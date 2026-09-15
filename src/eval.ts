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

/**
 * A fixture whose claim is about dispatch rather than about reasoning — backlog 15 and 16.
 *
 * "The compiler should still hash and dispatch it" is a real assertion and no recorded run is needed
 * to make it, the same way fixture 008's gate assertion needs none. A one-word problem and a
 * several-thousand-word one are the two ends of the range, and the failure both guard against is the
 * same: a problem the system cannot turn into briefs is a problem the user never finds out about.
 */
function evaluateCompiles(cfg: Config, fixture: Fixture): PairResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const r = compile(cfg, fixture.prompt, { problem_class: fixture.problem_class }, { seed: fixture.seed });
  if (r.kind === "declined") {
    failures.push(`expect a compiled plan, got a decline: ${r.reason}`);
  } else {
    const briefs = r.briefs;
    if (!briefs.length) failures.push("the plan compiled zero branches");
    if (!/^sha256:[0-9a-f]{64}$/.test(r.plan.problem_hash)) failures.push(`problem_hash is not a sha256: ${r.plan.problem_hash}`);
    // The problem reaches every brief byte for byte, compared against the fenced block the renderer
    // puts it in rather than by `includes`. A substring test passes on a brief that *expanded* the
    // problem — "What should we do about Retries?" contains "Retries?" — and expansion is exactly the
    // failure a one-word problem invites, since every instinct says a terse prompt needs helping. The
    // fence is where the problem is, so the fence is what gets compared.
    // Compared with one trailing newline allowed on either side and nothing else. A YAML `|` block
    // scalar keeps a final newline, so a multi-line fixture's prompt ends with one and a single-line
    // one does not; the compiler fences exactly what it was handed either way. That is a property of
    // the fixture file rather than of the problem, and it is the only difference tolerated here —
    // trimming both sides would also forgive leading whitespace, which would not be the same problem.
    const endTrim = (t: string) => t.replace(/\n$/, "");
    const want = endTrim(fixture.prompt);
    for (const b of briefs) {
      const fenced = [...b.text.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => endTrim(m[1]!));
      if (!fenced.length) failures.push(`${b.frame}'s brief fences no problem block`);
      else if (!fenced.some((f) => f === want))
        failures.push(`${b.frame}'s brief does not carry the problem verbatim; it fenced ${JSON.stringify(fenced[0]!.slice(0, 60))}`);
    }
    const sizes = briefs.map((b) => Buffer.byteLength(b.text, "utf8"));
    const largest = Math.max(...sizes);
    if (fixture.expect.brief_bytes_max !== undefined && largest > fixture.expect.brief_bytes_max)
      failures.push(`largest brief is ${largest} bytes, over the ${fixture.expect.brief_bytes_max} this fixture allows`);
    if (fixture.expect.branches_expected !== undefined && r.plan.branches.length !== fixture.expect.branches_expected)
      failures.push(`expect branches_expected ${fixture.expect.branches_expected}: the plan carries ${r.plan.branches.length}`);
    if (fixture.expect.distinct_axes) {
      const axes = r.plan.branches.map((b) => b.axis);
      const dupes = axes.filter((a, i) => axes.indexOf(a) !== i);
      if (dupes.length) failures.push(`expect distinct_axes: ${[...new Set(dupes)].join(", ")} dispatched more than once (D6)`);
    }
    notes.push(`compiled ${briefs.length} brief(s) on ${new Set(r.plan.branches.map((b) => b.axis)).size} axes, largest ${largest} bytes, hash ${r.plan.problem_hash.slice(0, 14)}...`);
  }
  const outcome = failures.length ? "fail" : "pass";
  return { fixture: fixture.id, recorded: "(no run: compile only)", outcome, expected: "pass", ok: outcome === "pass", failures, notes };
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
    /*
     * A fixture's compile expectations do not need a run, so they are checked whenever there is no
     * run to check instead. Fixture 014 found this: it carried `branches_expected: 7` and
     * `distinct_axes`, gained pre-registered `must_surface` items under E10 before the run those
     * items are for existed, and silently stopped reporting the two compile checks it was built
     * around — "no recorded runs" reads as nothing to say, not as a check that went away. Writing
     * assertions before the run is the discipline this repo asks for, so the window between the
     * two has to stay covered.
     */
    if (fx.expect.compiles && (!fx.must_surface.length || !runs.length)) {
      pairs.push(evaluateCompiles(cfg, fx));
      if (!runs.length) continue;
    }
    if (!runs.length) {
      without.push(fx.id);
      continue;
    }
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
  verdict: "discriminating" | "sometimes" | "matches a control" | "never matched" | "no evidence yet";
}

/**
 * How many real runs an assertion needs before "some of them matched" is a rate rather than an
 * anecdote. Two is the floor at which `sometimes` can be distinguished from a single sample at all.
 */
const RATE_FLOOR = 2;

/**
 * Which of the five things this assertion is, given how it has behaved.
 *
 * `sometimes` is the one that was missing, and its absence is why this was worth changing. The
 * audit already counted `real_matched` out of `real_total`, and then the verdict threw the rate
 * away: `001/retry_cost` at 1 in 3 read as `discriminating`, the same word as `001/trap_named` at 3
 * in 3. An assertion a third of real runs satisfy and one every real run satisfies are not the same
 * assertion, and calling them the same is how "it does not pass reliably" stayed a sentence in the
 * README instead of a number in a report.
 *
 * It is deliberately not a failure. A `sometimes` item is evidence about the frame library — that
 * nothing in the dispatched set reliably asks this question — and the answer to that is a decision
 * about frames, not a looser pattern.
 *
 * `controlIsDefect` is false for a `must_not` with `check: must_match`, which is a floor stated
 * inversely: the run fails when the pattern does *not* match. `004/never_names_it` requires the
 * recommendation to commit to a name, and a competent linear answer commits to a name — a control
 * satisfying that floor is the expected result, not a sign the assertion measures nothing. The
 * first version of this function applied the control rule to both kinds and reported it as a
 * defect, which is why the parameter is here.
 */
function verdictFor(matched: number, real: number, controlMatched: number, controlIsDefect: boolean): ItemAudit["verdict"] {
  if (controlIsDefect && controlMatched > 0) return "matches a control";
  if (real === 0) return "no evidence yet";
  if (matched === 0) return "never matched";
  if (real >= RATE_FLOOR && matched < real) return "sometimes";
  return "discriminating";
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
        verdict: verdictFor(rm, real.length, cm, true),
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
        verdict: verdictFor(rm, real.length, cm, false),
      });
    }
  }

  const lines = [`fixture audit over ${runs.length} recorded run(s): ${runs.filter((r) => !r.control).length} real, ${runs.filter((r) => r.control).length} control`, ""];
  lines.push(`${"fixture".padEnd(8)} ${"item".padEnd(26)} real  ctrl  verdict`);
  for (const i of items)
    lines.push(
      `${i.fixture.padEnd(8)} ${i.item.padEnd(26)} ${`${i.real_matched}/${i.real_total}`.padStart(4)}  ${`${i.control_matched}/${i.control_total}`.padStart(4)}  ${i.verdict === "matches a control" ? "!! " : i.verdict === "never matched" ? " ? " : i.verdict === "sometimes" ? " ~ " : "   "}${i.verdict}`,
    );

  const bad = items.filter((i) => i.verdict === "matches a control");
  const cold = items.filter((i) => i.verdict === "never matched");
  const flaky = items.filter((i) => i.verdict === "sometimes");
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
  if (flaky.length)
    lines.push(
      `${flaky.length} assertion(s) only some real runs surface: ${flaky.map((i) => `${i.fixture}/${i.item} ${i.real_matched}/${i.real_total}`).join(", ")}.`,
      `  Not a failure and not a pattern to loosen. It says nothing in the dispatched frame set`,
      `  reliably asks this question, which is a fact about the frame library and is answered by a`,
      `  decision about frames. Read it against how many runs there are: a rate over two runs is`,
      `  barely a rate, and the honest response to both is more runs.`,
    );
  if (!bad.length && !cold.length && !flaky.length) lines.push("every assertion is matched by every real run and by no control.");
  return { items, text: lines.join("\n") };
}
