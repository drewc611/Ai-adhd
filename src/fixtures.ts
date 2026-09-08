// Fixture authoring safety net, assertion history, and the regression gate.
// Catalogue 27, 50 and 51. Never calls a model.
//
// A fixture assertion is a regex, and a regex can be wrong in ways the harness reports as
// success. Three shapes have actually occurred in this repository:
//
//   - `on.call` matched "functi(on call)s" in a control that never mentions on-call, so the
//     assertion looked discriminating and was matching a different word.
//   - A pattern that cannot compile never matches, and never matching reads as a clean pass on
//     a fixture nobody expected to pass.
//   - A pattern lifted from the fixture's own `why` text matches the run that inspired it and
//     nothing else, which is fitting the assertion to the data after seeing it.
//
// `adhd lint <fixture>` runs these before a fixture is recorded against. Everything here is a
// property of the fixture text, so it needs no recorded run to be useful.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { Fixture } from "./schema.js";
import { loadFixtures, runEval } from "./eval.js";

export interface LintIssue {
  fixture: string;
  item: string;
  severity: "error" | "warn";
  message: string;
}

export interface FixtureLintReport {
  issues: LintIssue[];
  errors: LintIssue[];
  warnings: LintIssue[];
  fixtures: string[];
  text: string;
}

/** Every regex a fixture carries, with the item it belongs to. */
function patternsOf(fx: Fixture): { item: string; pattern: string }[] {
  const out: { item: string; pattern: string }[] = [];
  for (const ms of fx.must_surface) for (const p of ms.any_of) out.push({ item: `must_surface.${ms.id}`, pattern: p });
  for (const mn of fx.must_not) if (mn.check === "must_match") for (const p of mn.any_of) out.push({ item: `must_not.${mn.id}`, pattern: p });
  return out;
}

/**
 * A dot between two letters, outside a character class and not escaped.
 *
 * This is the `on.call` defect. `.` matches any character, so `on.call` fires on "function
 * calls" — and a control that never says on-call passed the assertion, which made it look like
 * an assertion that does not measure divergence when it was an assertion measuring the wrong
 * word entirely.
 */
export function hasBareDotSeparator(pattern: string): boolean {
  const stripped = pattern.replace(/\\\./g, "").replace(/\[[^\]]*\]/g, "");
  return /[a-z]\.[a-z]/i.test(stripped);
}

/**
 * Does this pattern match the fixture's own prompt?
 *
 * The prompt is the one text every branch sees and most branches quote, so an assertion that
 * matches it is satisfied by echoing the question rather than by answering it — including by
 * the negative control, which is what makes it worth flagging.
 *
 * The `why` text is deliberately not checked. It describes what the assertion is for, so of
 * course the pattern matches it; an earlier version warned on that and produced eleven
 * warnings across eight fixtures, every one of them noise.
 */
function matchesOwnPrompt(fx: Fixture, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(fx.prompt);
  } catch {
    return false;
  }
}

export function lintFixture(fx: Fixture): LintIssue[] {
  const out: LintIssue[] = [];
  const add = (item: string, severity: LintIssue["severity"], message: string) => out.push({ fixture: fx.id, item, severity, message });

  const seenItemIds = new Set<string>();
  for (const id of [...fx.must_surface.map((m) => m.id), ...fx.must_not.map((m) => m.id)]) {
    if (seenItemIds.has(id)) add(id, "error", `two items share the id ${id}; a report cannot tell them apart and neither can a baseline`);
    seenItemIds.add(id);
  }

  for (const { item, pattern } of patternsOf(fx)) {
    // The prompt check applies to must_surface only. A must_not is inverted, so a pattern of
    // its matching the prompt says nothing about whether the assertion can be trivially met.
    const surfacing = item.startsWith("must_surface.");
    try {
      new RegExp(pattern, "i");
    } catch (e) {
      add(item, "error", `/${pattern}/ does not compile: ${(e as Error).message}. A pattern that cannot match is an assertion that cannot fail, which the harness reports as a pass.`);
      continue;
    }
    if (pattern.trim() === "" || pattern === ".*" || pattern === ".+")
      add(item, "error", `/${pattern}/ matches everything, so the assertion cannot fail`);
    if (hasBareDotSeparator(pattern))
      add(item, "error", `/${pattern}/ uses a bare dot between two letters. That is the on.call defect: it matched "functi(on call)s" in a control that never mentions on-call. Use [- ]? or \\\\s or escape it.`);
    if (surfacing && matchesOwnPrompt(fx, pattern))
      add(
        item,
        "warn",
        `/${pattern}/ matches the fixture's own prompt. Every branch sees the prompt and most quote it, so this can be satisfied by echoing the question rather than answering it — the negative control included.`,
      );
    if (/^[a-z]{1,3}$/i.test(pattern))
      add(item, "warn", `/${pattern}/ is ${pattern.length} characters with no boundary, so it matches inside other words. \\b would fix it if a whole word is what was meant.`);
  }

  // An item whose alternatives are all substrings of one another is one alternative wearing
  // several hats: it reads as breadth in the fixture and provides none.
  for (const ms of fx.must_surface) {
    const pats = ms.any_of.filter((p) => !/[\\[\](){}|*+?^$]/.test(p)).map((p) => p.toLowerCase());
    for (let i = 0; i < pats.length; i++)
      for (let j = 0; j < pats.length; j++)
        if (i !== j && pats[j]!.includes(pats[i]!))
          add(`must_surface.${ms.id}`, "warn", `"${pats[i]}" is a substring of "${pats[j]}", so the second alternative can never be the one that matches`);
  }

  if (!fx.must_surface.length && !fx.must_not.length && !fx.expect)
    add("(fixture)", "error", "asserts nothing: no must_surface, no must_not, no expect");
  return out;
}

export function lintFixtures(cfg: Config, opts: { fixturesDir?: string; only?: string } = {}): FixtureLintReport {
  const dir = opts.fixturesDir ?? join(cfg.root, "evals", "fixtures");
  const all = loadFixtures(dir);
  const fixtures = opts.only ? all.filter((f) => f.id === opts.only || f.name === opts.only) : all;
  const issues = fixtures.flatMap(lintFixture);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warn");

  const lines = [`fixture lint over ${fixtures.length} fixture(s)${opts.only ? ` matching ${opts.only}` : ""}`];
  if (opts.only && !fixtures.length) lines.push(`no fixture with id or name ${opts.only}. Known: ${all.map((f) => `${f.id} (${f.name})`).join(", ")}`);
  lines.push("");
  for (const i of [...errors, ...warnings]) lines.push(`${i.severity === "error" ? "ERROR" : " warn"}  ${i.fixture}/${i.item}: ${i.message}`);
  if (!issues.length) lines.push("Every pattern compiles, none matches everything, none uses a bare dot as a separator, and none is lifted from the fixture's own prose.");
  else lines.push(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
  return { issues, errors, warnings, fixtures: fixtures.map((f) => f.id), text: lines.join("\n") };
}

// ---- assertion history and the regression gate (catalogue 50, 51) --------------------------

export interface AssertionRow {
  fixture: string;
  item: string;
  /** Real runs that satisfied it, and real runs that did not. */
  passing: string[];
  failing: string[];
  /** Negative controls that satisfied it. Any is a problem: the assertion measures nothing. */
  controls_passing: string[];
}

export interface HistoryReport {
  rows: AssertionRow[];
  runs: number;
  text: string;
}

/**
 * Which runs have ever satisfied each assertion (catalogue 50).
 *
 * The eval report says whether a run passed a fixture. It does not say whether one assertion
 * has held across every run or only the one it was written against, and that is the difference
 * between a regression test and a description of a single afternoon.
 */
export function assertionHistory(cfg: Config, opts: { fixturesDir?: string; recordedDir?: string } = {}): HistoryReport {
  const report = runEval(cfg, opts);
  const rows = new Map<string, AssertionRow>();
  const key = (f: string, i: string) => `${f}/${i}`;

  const fixtures = loadFixtures(opts.fixturesDir ?? join(cfg.root, "evals", "fixtures"));
  for (const fx of fixtures)
    for (const item of [...fx.must_surface.map((m) => m.id), ...fx.must_not.map((m) => m.id)])
      rows.set(key(fx.id, item), { fixture: fx.id, item, passing: [], failing: [], controls_passing: [] });

  for (const pair of report.pairs) {
    // Gate and decline fixtures have no run; they assert routing, not artifacts.
    if (pair.recorded.startsWith("(no run")) continue;
    const run = pair.recorded.split("/").filter(Boolean).pop()!;
    const isControl = run.endsWith("-linear-cot");

    // A failure line is `must_surface <id> (T6): description` or `must_not <id>: ...`, so the
    // trap parenthetical has to come off or no id ever matches. An earlier version split on the
    // first colon and left "(T6)" attached, which made every assertion look like it held on
    // every run — including the two 001 re-runs that are recorded as failing.
    const failedItems = new Set(
      pair.failures.flatMap((f) => {
        const m = /^(?:must_surface|must_not)\s+(\S+?)(?:\s+\(T\d\))?:/.exec(f);
        return m ? [m[1]!] : [];
      }),
    );
    for (const row of rows.values())
      if (row.fixture === pair.fixture) {
        const held = !failedItems.has(row.item);
        if (isControl) {
          if (held) row.controls_passing.push(run);
        } else (held ? row.passing : row.failing).push(run);
      }
  }

  const list = [...rows.values()].sort((a, b) => a.fixture.localeCompare(b.fixture) || a.item.localeCompare(b.item));
  const lines = [`assertion history over ${report.pairs.length} fixture/run pair(s)`];
  lines.push("");
  lines.push(`${"fixture/item".padEnd(38)} ${"real".padStart(6)}  ${"ctrl".padStart(4)}  runs that held it`);
  for (const r of list)
    lines.push(
      `${`${r.fixture}/${r.item}`.padEnd(38)} ${`${r.passing.length}/${r.passing.length + r.failing.length}`.padStart(6)}  ${String(r.controls_passing.length).padStart(4)}  ${r.passing.join(", ") || "(never)"}`,
    );
  lines.push("");
  const never = list.filter((r) => r.passing.length === 0 && r.passing.length + r.failing.length > 0);
  const once = list.filter((r) => r.passing.length === 1 && r.passing.length + r.failing.length > 1);
  if (never.length) lines.push(`never held by any real run: ${never.map((r) => `${r.fixture}/${r.item}`).join(", ")}. A stretch goal and an unreachable pattern look identical here; \`adhd lint\` tells them apart.`);
  if (once.length)
    lines.push(
      `held by exactly one run out of several: ${once.map((r) => `${r.fixture}/${r.item}`).join(", ")}. An assertion that has passed once is a description of that run until a second one confirms it.`,
    );
  return { rows: list, runs: report.pairs.length, text: lines.join("\n") };
}

export interface GateReport {
  regressions: { fixture: string; item: string; was: string[]; now_failing: string[] }[];
  gains: { fixture: string; item: string; runs: string[] }[];
  baselinePath: string;
  updated: boolean;
  text: string;
}

type Baseline = { why: string; passing: Record<string, string[]> };

/**
 * Fail when an assertion that used to hold on a run stops holding on it (catalogue 51).
 *
 * `adhd eval` compares a run against its own recorded expectation, so a run recorded as failing
 * stays green forever however much worse it gets. The unit that matters is finer: this fixture
 * item, on this run. A prompt edit that quietly stops one assertion from holding is invisible
 * to the pair-level report and is exactly the change worth catching.
 *
 * `--update` rewrites the baseline. A gain is never a failure; it prints and waits to be taken.
 */
export function regressionGate(cfg: Config, opts: { fixturesDir?: string; recordedDir?: string; update?: boolean } = {}): GateReport {
  const baselinePath = join(cfg.root, "evals", "assertion-baseline.json");
  const baseline: Baseline = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline)
    : { why: "", passing: {} };

  const history = assertionHistory(cfg, opts);
  const now: Record<string, string[]> = {};
  for (const r of history.rows) now[`${r.fixture}/${r.item}`] = [...r.passing].sort();

  const regressions: GateReport["regressions"] = [];
  const gains: GateReport["gains"] = [];
  for (const [k, wasRuns] of Object.entries(baseline.passing)) {
    const nowRuns = new Set(now[k] ?? []);
    const lost = wasRuns.filter((r) => !nowRuns.has(r));
    if (lost.length) regressions.push({ fixture: k.split("/")[0]!, item: k.split("/").slice(1).join("/"), was: wasRuns, now_failing: lost });
  }
  for (const [k, nowRuns] of Object.entries(now)) {
    const wasRuns = new Set(baseline.passing[k] ?? []);
    const gained = nowRuns.filter((r) => !wasRuns.has(r));
    if (gained.length) gains.push({ fixture: k.split("/")[0]!, item: k.split("/").slice(1).join("/"), runs: gained });
  }

  if (opts.update) {
    const why =
      "Which fixture assertions held on which recorded runs, at the moment this file was written. `adhd eval --gate` fails when an assertion that used to hold on a run stops holding on it. " +
      "The pair-level eval cannot see that: a run recorded as failing stays green however much worse it gets, because it is compared against its own recorded expectation. " +
      "A gain is never a failure — it prints and waits to be taken with --update, so that adopting an improvement is a deliberate act with a diff.";
    writeFileSync(baselinePath, JSON.stringify({ why, passing: now }, null, 2) + "\n");
  }

  const lines = [`regression gate over ${history.rows.length} assertion(s), baseline ${existsSync(baselinePath) ? baselinePath : "(none yet)"}`];
  lines.push("");
  for (const r of regressions) lines.push(`REGRESSION  ${r.fixture}/${r.item} held on ${r.was.join(", ")} and no longer holds on ${r.now_failing.join(", ")}`);
  for (const g of gains) lines.push(`  gain      ${g.fixture}/${g.item} now holds on ${g.runs.join(", ")}, which the baseline does not record`);
  if (!regressions.length && !gains.length) lines.push("Every assertion holds on exactly the runs the baseline records.");
  if (opts.update) lines.push(`\nBaseline rewritten: ${baselinePath}`);
  else if (gains.length) lines.push(`\nGains are not failures. Run with --update to take them, so adopting an improvement is a deliberate act with a diff.`);
  return { regressions, gains, baselinePath, updated: Boolean(opts.update), text: lines.join("\n") };
}

/** Fixtures on disk, for a caller that wants the ids without loading the schema itself. */
export function fixtureIds(cfg: Config, fixturesDir?: string): string[] {
  const dir = fixturesDir ?? join(cfg.root, "evals", "fixtures");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort();
}
