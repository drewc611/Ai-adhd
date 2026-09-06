import { test } from "node:test";
import assert from "node:assert/strict";
import { cfg } from "./helpers.js";
import { compile, renderBranchBrief } from "../src/compile.js";
import { parseDecision, checkBriefIsolation } from "../src/validate.js";
import { problemHash } from "../src/hash.js";
import { ContractError } from "../src/errors.js";

const WEIRD = "  What timeouts should I set on this HTTP client?\r\n  {{not a template}} — ünïcode ✓   \n\n";

function extractProblem(brief: string): string {
  // The brief wraps the problem in the first fenced block after "The problem, verbatim:".
  const m = brief.match(/The problem, verbatim:\n\n```\n([\s\S]*?)\n```/);
  assert.ok(m, "brief has no problem block");
  return m![1]!;
}

test("verbatim passthrough: the problem block in every brief is byte-identical to the input", () => {
  const r = compile(cfg, WEIRD, { problem_class: "design_decision" }, { seed: 7 });
  assert.equal(r.kind, "plan");
  if (r.kind !== "plan") return;
  for (const b of r.briefs) assert.equal(extractProblem(b.text), WEIRD, `brief ${b.frame} drifted`);
  assert.equal(r.plan.problem_hash, problemHash(WEIRD));
});

test("paraphrase changes the hash: a trailing newline is a different problem", () => {
  assert.notEqual(problemHash("x"), problemHash("x\n"));
  assert.notEqual(problemHash("What timeouts should I set on this HTTP client?"), problemHash("What timeouts should I set on this HTTP client"));
});

test("orchestrator cannot reason: unknown keys and free text reject", () => {
  assert.throws(() => parseDecision(cfg, { problem_class: "design_decision", note: "I think 30s is right" }), ContractError);
  assert.throws(() => parseDecision(cfg, { problem_class: "use 30 second timeouts" }), ContractError);
  assert.throws(() => parseDecision(cfg, { problem_class: "design_decision", frames: ["THIRTY_SECONDS"] }), ContractError);
  assert.throws(() => parseDecision(cfg, '{"problem_class":"design_decision","reasoning":"..."}'), ContractError);
  assert.deepEqual(parseDecision(cfg, '{"problem_class":"design_decision","n":5}'), { problem_class: "design_decision", n: 5 });
});

test("briefs are isolated: no other frame id, no count, no 'so far'", () => {
  const r = compile(cfg, "Name this function.", { problem_class: "naming" }, { seed: 3 });
  if (r.kind !== "plan") throw new Error("expected plan");
  const all = cfg.frames.frames.map((f) => f.id);
  for (const b of r.briefs) assert.deepEqual(checkBriefIsolation(b.text, b.frame, all), []);
  // And the checker itself catches the things it claims to.
  const poisoned = r.briefs[0]!.text + "\nHere is what has been considered so far by the 4 other branches: LEDGER said...";
  const problems = checkBriefIsolation(poisoned, r.briefs[0]!.frame, all);
  assert.ok(problems.some((p) => /so far/.test(p)));
  assert.ok(problems.some((p) => /branch count/.test(p)));
  assert.ok(problems.some((p) => /LEDGER/.test(p)) || r.briefs[0]!.frame === "LEDGER");
});

test("a brief contains exactly its own frame's stance and no other stance", () => {
  const r = compile(cfg, "Should we shard now?", { problem_class: "strategy" }, { seed: 11 });
  if (r.kind !== "plan") throw new Error("expected plan");
  for (const b of r.briefs) {
    for (const f of cfg.frames.frames) {
      const firstSentence = f.stance.trim().split(/(?<=\.)\s/)[0]!;
      const present = b.text.includes(firstSentence);
      assert.equal(present, f.id === b.frame, `brief ${b.frame} ${present ? "contains" : "lacks"} stance of ${f.id}`);
    }
  }
});

test("frames in one run have distinct axes and n respects the class default", () => {
  const r = compile(cfg, "p", { problem_class: "design_decision" }, { seed: 5 });
  if (r.kind !== "plan") throw new Error("expected plan");
  assert.equal(r.plan.n, cfg.routing.defaults.max_branches);
  const axes = r.plan.branches.map((b) => b.axis);
  assert.equal(new Set(axes).size, axes.length);
});

test("seed reproducibility: same seed same order, different seed different order", () => {
  const a = compile(cfg, "p", { problem_class: "enumerate_options" }, { seed: 1, now: new Date(0) });
  const b = compile(cfg, "p", { problem_class: "enumerate_options" }, { seed: 1, now: new Date(0) });
  const c = compile(cfg, "p", { problem_class: "enumerate_options" }, { seed: 2, now: new Date(0) });
  if (a.kind !== "plan" || b.kind !== "plan" || c.kind !== "plan") throw new Error("expected plans");
  assert.deepEqual(a.plan.branches.map((x) => x.frame), b.plan.branches.map((x) => x.frame));
  assert.notDeepEqual(a.plan.branches.map((x) => x.frame), c.plan.branches.map((x) => x.frame));
  assert.equal(a.plan.n, 7);
});

test("hard cap and allow_wide", () => {
  assert.throws(() => compile(cfg, "p", { problem_class: "enumerate_options", n: 12 }, { seed: 1 }), /hard_cap/);
  const wide = compile(cfg, "p", { problem_class: "enumerate_options", n: 10, allow_wide: true }, { seed: 1 });
  assert.equal(wide.kind, "plan");
  if (wide.kind === "plan") assert.equal(new Set(wide.plan.branches.map((b) => b.axis)).size, 10);
});

test("decline classes produce no briefs", () => {
  const r = compile(cfg, "What is the syntax for a Python lambda?", { problem_class: "factual_lookup" });
  assert.equal(r.kind, "declined");
});

test("tool grants land in the brief and pick the agent", () => {
  const r = compile(cfg, "p", { problem_class: "strategy", frames: ["PRIOR_ART", "LEDGER", "DOOR_KEEPER"] }, { seed: 1 });
  if (r.kind !== "plan") throw new Error("expected plan");
  const pa = r.plan.branches.find((b) => b.frame === "PRIOR_ART")!;
  assert.equal(pa.agent, "adhd-branch-search");
  assert.match(r.briefs.find((b) => b.frame === "PRIOR_ART")!.text, /WebSearch and WebFetch/);
  assert.match(r.briefs.find((b) => b.frame === "LEDGER")!.text, /You have no tools/);
  const brief = renderBranchBrief(cfg, "p", "sha256:x", cfg.frameById.get("LEDGER")!);
  assert.doesNotMatch(brief, /Read|Grep|Glob/);
});
