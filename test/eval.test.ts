import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { runEval, loadFixtures } from "../src/eval.js";
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
