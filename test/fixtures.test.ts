import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { assertionHistory, hasBareDotSeparator, lintFixture, lintFixtures, regressionGate } from "../src/fixtures.js";
import { loadFixtures } from "../src/eval.js";

const FIXTURES = join(cfg.root, "evals", "fixtures");
const RECORDED = join(cfg.root, "evals", "recorded");

/** A scratch copy of the fixtures and the corpus, so a test can break one and see the effect. */
function sandbox(): { fixtures: string; recorded: string } {
  const root = tmp();
  cpSync(FIXTURES, join(root, "fixtures"), { recursive: true });
  cpSync(RECORDED, join(root, "recorded"), { recursive: true });
  return { fixtures: join(root, "fixtures"), recorded: join(root, "recorded") };
}

const fx = (id: string) => loadFixtures(FIXTURES).find((f) => f.id === id)!;

/**
 * Replace one must_surface item's `any_of` list in a fixture file on disk.
 *
 * Bounded by the next `- id:` at the same indent, or the next top-level key. An earlier version
 * sliced to a hard-coded following item and produced YAML with broken indentation, which failed
 * as a parse error rather than as the assertion under test.
 */
function setAnyOf(path: string, itemId: string, patterns: string[]): void {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(`- id: ${itemId}`);
  assert.ok(start !== -1, `no item ${itemId} in ${path}`);
  const after = text.slice(start + 1);
  const rel = after.search(/\n\s+- id: |\n[a-z_]+:/);
  const end = rel === -1 ? text.length : start + 1 + rel;
  const block = text.slice(start, end);
  const replaced = block.replace(/any_of:\n(?:[ \t]+- .*\n?)+/, `any_of:\n${patterns.map((p) => `      - ${JSON.stringify(p)}`).join("\n")}\n`);
  assert.notEqual(replaced, block, `any_of not found in the ${itemId} block`);
  writeFileSync(path, text.slice(0, start) + replaced + text.slice(end));
}

test("the bare-dot detector catches the on.call defect and not an escaped or classed dot", () => {
  // `.` matches any character, so `on.call` fired on "functi(on call)s" in a control that never
  // mentions on-call. The assertion looked non-discriminating and was matching a different word.
  assert.equal(hasBareDotSeparator("on.call"), true);
  assert.equal(hasBareDotSeparator("one.way"), true);
  assert.equal(hasBareDotSeparator("\\bon[- ]?call"), false, "the fix for it must not trip the check");
  assert.equal(hasBareDotSeparator("node\\.js"), false, "an escaped dot is a literal dot");
  assert.equal(hasBareDotSeparator("on[.]call"), false, "a dot in a class is a literal dot");
  assert.equal(hasBareDotSeparator("cancel"), false);
});

test("a pattern that cannot compile is an error, because it reads to the harness as a pass", () => {
  const broken = structuredClone(fx("001"));
  broken.must_surface[0]!.any_of = ["(unclosed"];
  const issues = lintFixture(broken);
  assert.ok(issues.some((i) => i.severity === "error" && /does not compile/.test(i.message)));
  assert.ok(issues.some((i) => /assertion that cannot fail/.test(i.message)));
});

test("a pattern that matches everything is an error", () => {
  for (const p of [".*", ".+", "  "]) {
    const wide = structuredClone(fx("001"));
    wide.must_surface[0]!.any_of = [p];
    assert.ok(
      lintFixture(wide).some((i) => i.severity === "error" && /matches everything/.test(i.message)),
      `/${p}/ was not flagged`,
    );
  }
});

test("two items sharing an id is an error, because a baseline cannot tell them apart", () => {
  const dup = structuredClone(fx("001"));
  dup.must_surface[1]!.id = dup.must_surface[0]!.id;
  assert.ok(lintFixture(dup).some((i) => i.severity === "error" && /share the id/.test(i.message)));
});

test("the shipped fixtures have no lint errors, and their two warnings are real", () => {
  const r = lintFixtures(cfg);
  assert.deepEqual(r.errors, [], r.errors.map((e) => `${e.fixture}/${e.item}: ${e.message}`).join("\n"));

  // Both warnings are findings, not noise, and this pins them so a fix has to be deliberate.
  const ids = r.warnings.map((w) => `${w.fixture}/${w.item}`).sort();
  assert.deepEqual(ids, ["002/must_surface.or_so_noticed", "003/must_surface.one_way_door"]);

  // 002's prompt literally contains "or so", so any branch quoting the question satisfies an
  // assertion meant to check the imprecision is treated as evidence.
  assert.match(fx("002").prompt, /or so/);
  // 003 lists "reversib" and "irreversib" as alternatives; the first matches inside the second.
  const oneWay = fx("003").must_surface.find((m) => m.id === "one_way_door")!;
  assert.ok(oneWay.any_of.some((p) => p.includes("reversib")));
});

test("the prompt check applies to must_surface only, where its meaning holds", () => {
  // A must_not is inverted, so its pattern matching the prompt says nothing about whether the
  // assertion is trivially satisfied. An earlier version warned on those and on every pattern
  // matching the `why` text: eleven warnings over eight fixtures, all of them noise.
  const f = structuredClone(fx("001"));
  const word = f.prompt.split(/\s+/).find((w) => w.length > 5)!.replace(/[^a-z]/gi, "");
  f.must_surface[0]!.any_of = [word];
  assert.ok(lintFixture(f).some((i) => /matches the fixture's own prompt/.test(i.message)));

  const g = structuredClone(fx("001"));
  g.must_surface = [];
  for (const mn of g.must_not) if (mn.check === "must_match") mn.any_of = [word];
  assert.ok(!lintFixture(g).some((i) => /matches the fixture's own prompt/.test(i.message)));
});

test("assertion history reports which runs held each item, matching the recorded outcomes", () => {
  // Pinned against facts established by the pre-registered experiments in docs/EXPERIMENTS.md.
  const h = assertionHistory(cfg);
  const row = (f: string, i: string) => h.rows.find((r) => r.fixture === f && r.item === i)!;

  // E1a: human_cancel survived a whole new frame set but not a reseed.
  assert.deepEqual(row("001", "human_cancel").passing.sort(), ["001-altframes", "001-first-run"]);
  assert.deepEqual(row("001", "human_cancel").failing, ["001-seed2"]);
  // E1b: retry_target_questioned survived a reseed but not the frame swap.
  assert.deepEqual(row("001", "retry_target_questioned").failing, ["001-altframes"]);
  // retry_cost was LEDGER's, and LEDGER was pruned at seed 2 and not dispatched in E1b.
  assert.deepEqual(row("001", "retry_cost").passing, ["001-first-run"]);
  // The frame-set gap that 004 is recorded as failing on.
  assert.deepEqual(row("004", "false_means").passing, []);

  assert.match(h.text, /never held by any real run: 004\/false_means/);
  assert.match(h.text, /held by exactly one run out of several/);

  // Gate and decline fixtures assert routing, not artifacts, and contribute no run history.
  for (const r of h.rows) for (const run of [...r.passing, ...r.failing]) assert.ok(!run.startsWith("(no run"), run);
});

test("the shipped baseline matches what holds now", () => {
  const g = regressionGate(cfg);
  assert.deepEqual(g.regressions, [], g.regressions.map((r) => `${r.fixture}/${r.item}`).join(", "));
  assert.deepEqual(g.gains, [], "the baseline is stale; run `adhd eval --gate --update` and commit the diff");
  assert.match(g.text, /Every assertion holds on exactly the runs the baseline records/);
});

test("the gate catches an assertion that stops holding on a run it used to hold on", () => {
  // The unit `adhd eval` cannot see. A run recorded as failing stays green there however much
  // worse it gets, because it is compared against its own recorded expectation.
  const s = sandbox();
  setAnyOf(join(s.fixtures, "001-http-timeouts.yaml"), "human_cancel", ["a phrase no run has ever written"]);

  const g = regressionGate(cfg, { fixturesDir: s.fixtures, recordedDir: s.recorded });
  assert.equal(g.regressions.length, 1);
  assert.equal(g.regressions[0]!.item, "human_cancel");
  assert.deepEqual(g.regressions[0]!.now_failing.sort(), ["001-altframes", "001-first-run"]);
  assert.match(g.text, /^REGRESSION\s+001\/human_cancel/m);
});

test("a gain is reported and never fails, so adopting an improvement is a deliberate act", () => {
  // The asymmetry is the point. A tightening that breaks something fails; a loosening that
  // makes more things pass does not, because a gate that auto-adopted gains would ratify
  // exactly the fixture-loosening D6 refuses.
  const s = sandbox();
  // "e" matches every artifact ever written, so retry_cost starts holding on the two runs it
  // does not hold on today. That is exactly the loosening a gate must not silently adopt.
  setAnyOf(join(s.fixtures, "001-http-timeouts.yaml"), "retry_cost", ["e"]);

  const g = regressionGate(cfg, { fixturesDir: s.fixtures, recordedDir: s.recorded });
  assert.deepEqual(g.regressions, []);
  assert.ok(g.gains.some((x) => x.item === "retry_cost"), g.gains.map((x) => x.item).join(", "));
  assert.match(g.text, /Gains are not failures/);
});

test("--update rewrites the baseline and says why the file exists", () => {
  const s = sandbox();
  const before = readFileSync(join(cfg.root, "evals", "assertion-baseline.json"), "utf8");
  const g = regressionGate(cfg, { fixturesDir: s.fixtures, recordedDir: s.recorded, update: true });
  assert.equal(g.updated, true);
  const after = JSON.parse(readFileSync(g.baselinePath, "utf8")) as { why: string; passing: Record<string, string[]> };
  assert.match(after.why, /stays green however much worse it gets/);
  assert.ok(Object.keys(after.passing).length > 20);
  // The sandbox is unmodified, so the rewrite is a no-op on content.
  assert.equal(readFileSync(join(cfg.root, "evals", "assertion-baseline.json"), "utf8"), before);
});
