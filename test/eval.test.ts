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
