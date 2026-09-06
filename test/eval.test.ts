import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { auditFixtures, runEval, loadFixtures } from "../src/eval.js";
import { problemHash } from "../src/hash.js";

test("the shipped negative control fails fixture 001 and is expected to", () => {
  const r = runEval(cfg);
  const pair = r.pairs.find((p) => p.recorded.endsWith("001-linear-cot"))!;
  assert.ok(pair, "negative control not found");
  assert.equal(pair.outcome, "fail");
  assert.equal(pair.expected, "fail");
  assert.ok(pair.ok);
  assert.ok(pair.failures.some((f) => /human_cancel/.test(f)));
  assert.ok(pair.failures.some((f) => /retry_target_questioned/.test(f)));
  assert.ok(pair.failures.some((f) => /retry_cost/.test(f)));
  assert.ok(pair.failures.some((f) => /pruned_min/.test(f)));
});

test("a synthesis that surfaces what the linear answer missed passes fixture 001", () => {
  const fx = loadFixtures(join(cfg.root, "evals/fixtures")).find((f) => f.id === "001")!;
  const dir = tmp();
  const rec = join(dir, "001-good");
  mkdirSync(join(rec, "branches"), { recursive: true });
  writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash(fx.prompt) }));
  writeFileSync(
    join(rec, "synthesis.md"),
    [
      "# ADHD synthesis",
      "## Recommendation",
      "**Expose cancel to the user and propagate it before any timer fires; on a stall, fail over to a different instance rather than retrying the same one, and bill the retry to the caller's token budget explicitly.**",
      "Set the first token timeout only after measuring what users actually tolerate; the human watching the spinner is the fastest controller and the one who pays for a retried long generation.",
      "## Corroborated findings",
      "- **cancel first** (frames: ACTOR_CENSUS, END_USER)",
      "## Live singletons (unverified)",
      "(none)",
      "## Pruned, with reason",
      "- **MECHANIC**: Set 15s first token, 30s inter token, 90s absolute, one retry.",
      "  - traps: T1",
      "  - detector output: T1: delete the specific details and nothing changes",
      "## Run level",
      "- clean",
      "## What this forecloses",
      "- silent retry against the same instance",
      "## Cost",
      "| 5 | 60000 | 3m |",
      `problem_hash: \`${problemHash(fx.prompt)}\``,
    ].join("\n"),
  );
  const r = runEval(cfg, { recordedDir: dir });
  const pair = r.pairs.find((p) => p.fixture === "001")!;
  assert.deepEqual(pair.failures, []);
  assert.equal(pair.outcome, "pass");
});

test("paraphrase drift in a recorded run fails the hash check", () => {
  const dir = tmp();
  const rec = join(dir, "001-drift");
  mkdirSync(rec, { recursive: true });
  writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash("What timeouts should I set on this HTTP client") }));
  writeFileSync(join(rec, "synthesis.md"), "## Recommendation\nExpose cancel.\n## Pruned, with reason\n(none)\n");
  const r = runEval(cfg, { recordedDir: dir });
  const pair = r.pairs.find((p) => p.fixture === "001")!;
  assert.ok(pair.failures.some((f) => /problem_hash/.test(f)));
});

test("a fixture pattern anchored with ^ reads the start of the scope text, and a lookahead that matches nothing still counts as a match", () => {
  const dir = tmp();
  const fixtures = join(dir, "fixtures");
  const recorded = join(dir, "recorded");
  mkdirSync(fixtures, { recursive: true });
  const prompt = "Should we rewrite it?";
  writeFileSync(
    join(fixtures, "900-anchor.yaml"),
    [
      'id: "900"',
      "name: anchor",
      "problem_class: strategy",
      "seed: 1",
      `prompt: "${prompt}"`,
      "must_surface:",
      "  - id: says_rewrite",
      "    description: mentions the rewrite",
      "    any_of: [\"rewrite\"]",
      "must_not:",
      "  - id: no_it_depends",
      "    description: the bold line does not open with it depends",
      "    check: must_match",
      "    scope: recommendation",
      "    any_of:",
      '      - "^\\\\s*(?!(it depends))\\\\S"',
      "  - id: opens_with_do",
      "    description: the bold line opens with Do",
      "    check: must_match",
      "    scope: recommendation",
      "    any_of:",
      '      - "^\\\\s*Do\\\\b"',
      "expect: {}",
    ].join("\n"),
  );
  const synth = (bold: string) =>
    ["# ADHD synthesis", "## Recommendation", "", `**${bold}**`, "", "Do nothing else.", "## Pruned, with reason", "- none", `problem_hash: \`${problemHash(prompt)}\``].join("\n");
  for (const [name, bold, want] of [
    ["hedge", "It depends on whether the rewrite is worth it.", "fail"],
    ["verdict", "Do not rewrite it this year.", "pass"],
  ] as const) {
    const rec = join(recorded, `900-${name}`);
    mkdirSync(join(rec, "branches"), { recursive: true });
    writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash(prompt) }));
    writeFileSync(join(rec, "synthesis.md"), synth(bold));
    writeFileSync(join(rec, "expected.json"), JSON.stringify({ outcome: want }));
  }
  const r = runEval(cfg, { fixturesDir: fixtures, recordedDir: recorded });
  const hedge = r.pairs.find((p) => p.recorded.endsWith("900-hedge"))!;
  const verdict = r.pairs.find((p) => p.recorded.endsWith("900-verdict"))!;
  // "Do nothing else." is on a later line; without the m flag ^ must not reach it.
  assert.deepEqual(
    hedge.failures.map((f) => f.split(":")[0]),
    ["must_not no_it_depends", "must_not opens_with_do"],
  );
  assert.deepEqual(verdict.failures, []);
  assert.equal(r.pairs.every((p) => p.ok), true);
});

test("the audit flags an assertion the negative control also satisfies, and names the text that did it", () => {
  const dir = tmp();
  const fixtures = join(dir, "fixtures");
  const recorded = join(dir, "recorded");
  mkdirSync(fixtures, { recursive: true });
  const prompt = "Where should I look?";
  writeFileSync(
    join(fixtures, "901-audit.yaml"),
    [
      'id: "901"',
      "name: audit",
      "problem_class: fuzzy_debugging",
      "seed: 1",
      `prompt: "${prompt}"`,
      "must_surface:",
      "  - id: says_cron",
      "    description: names a scheduled actor",
      "    any_of: ['cron']",
      "  - id: says_rare",
      "    description: names something only a real run reaches",
      "    any_of: ['who is hurt']",
      "  - id: says_nothing",
      "    description: nothing has ever said this",
      "    any_of: ['zqx-never-appears']",
      "must_not: []",
      "expect: {}",
    ].join("\n"),
  );
  const write = (name: string, body: string, control: boolean) => {
    const d = join(recorded, name);
    mkdirSync(join(d, "branches"), { recursive: true });
    writeFileSync(join(d, "plan.json"), JSON.stringify({ problem_hash: problemHash(prompt) }));
    writeFileSync(join(d, "synthesis.md"), `# ADHD synthesis\n## Recommendation\n\n${body}\n\n## Pruned, with reason\n\n(none)\n`);
    writeFileSync(join(d, "expected.json"), JSON.stringify({ outcome: control ? "fail" : "pass", control }));
  };
  write("901-real", "Check cron, and ask who is hurt by the tail.", false);
  write("901-linear-cot", "The usual suspects: cron, GC, cache expiry.", true);

  const a = auditFixtures(cfg, { fixturesDir: fixtures, recordedDir: recorded });
  const byId = new Map(a.items.map((i) => [i.item, i]));
  assert.equal(byId.get("says_cron")!.verdict, "matches a control", "an assertion the consensus answer satisfies is not measuring divergence");
  assert.equal(byId.get("says_cron")!.control_evidence, "cron");
  assert.equal(byId.get("says_rare")!.verdict, "discriminating");
  assert.equal(byId.get("says_nothing")!.verdict, "never matched");
  assert.match(a.text, /matched on: "cron"/);
  assert.match(a.text, /do not loosen the pattern to make the report quiet/);
});

test("a fixture pattern that cannot compile, or that matches everything, fails at load", () => {
  const dir = tmp();
  const write = (name: string, anyOf: string) =>
    writeFileSync(
      join(dir, name),
      [
        'id: "902"',
        "name: broken",
        "problem_class: naming",
        "seed: 1",
        'prompt: "x"',
        "must_surface:",
        "  - id: thing",
        "    description: a thing",
        `    any_of: [${anyOf}]`,
        "must_not: []",
        "expect: {}",
      ].join("\n"),
    );
  write("902-broken.yaml", "'(unclosed'");
  assert.throws(() => loadFixtures(dir), /does not compile/, "a broken pattern must fail at load, not silently never match");
  rmSync(join(dir, "902-broken.yaml"));
  // An assertion that matches everything cannot fail, which the harness would report as a pass.
  write("902-vacuous.yaml", "'.*'");
  assert.throws(() => loadFixtures(dir), /matches everything, so the assertion cannot fail/);
  rmSync(join(dir, "902-vacuous.yaml"));
  write("902-fine.yaml", "'who (is|gets) paged'");
  assert.equal(loadFixtures(dir).length, 1);
});
