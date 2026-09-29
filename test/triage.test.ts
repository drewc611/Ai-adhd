import { test } from "node:test";
import assert from "node:assert/strict";
import { cfg } from "./helpers.js";
import { checkTriageArtifact, runEligibleClasses, TriageResultSchema } from "../src/triage.js";

const valid = `
\`\`\`yaml
items:
  - id: 1
    kind: quick_task
    text: call mom
    draft_problem: null
    suggested_class: null
  - id: 2
    kind: note
    text: worried about rent
    draft_problem: null
    suggested_class: null
  - id: 3
    kind: decision
    text: should I switch jobs
    draft_problem: "Whether to leave the current role for the one offered, given no stated timeline."
    suggested_class: design_decision
\`\`\`
`;

test("a valid triage artifact round-trips with no problems", () => {
  const { problems, result } = checkTriageArtifact(cfg, valid);
  assert.deepEqual(problems, []);
  assert.ok(result);
  assert.equal(result!.items.length, 3);
  assert.equal(result!.items[2]!.kind, "decision");
});

test("a decision item missing draft_problem is rejected", () => {
  const text = valid.replace('draft_problem: "Whether to leave the current role for the one offered, given no stated timeline."', "draft_problem: null");
  const { problems, result } = checkTriageArtifact(cfg, text);
  assert.ok(problems.length > 0);
  assert.equal(result, null);
});

test("a decision item missing suggested_class is rejected", () => {
  const text = valid.replace("suggested_class: design_decision", "suggested_class: null");
  const { problems, result } = checkTriageArtifact(cfg, text);
  assert.ok(problems.length > 0);
  assert.equal(result, null);
});

test("a quick_task carrying a draft_problem is rejected: nothing but a decision may draft one", () => {
  const text = valid.replace(
    "  - id: 1\n    kind: quick_task\n    text: call mom\n    draft_problem: null\n    suggested_class: null",
    '  - id: 1\n    kind: quick_task\n    text: call mom\n    draft_problem: "should I call mom"\n    suggested_class: design_decision',
  );
  const { problems } = checkTriageArtifact(cfg, text);
  assert.ok(problems.some((p) => /draft_problem/.test(p)));
});

test("a suggested_class naming a decline-only class is rejected, the same guard selectFrames uses for a real run", () => {
  const text = valid.replace("suggested_class: design_decision", "suggested_class: factual_lookup");
  const { problems, result } = checkTriageArtifact(cfg, text);
  assert.match(problems.join(";"), /decline class/);
  assert.equal(result, null);
});

test("a suggested_class naming an unknown class is rejected", () => {
  const text = valid.replace("suggested_class: design_decision", "suggested_class: not_a_real_class");
  const { problems, result } = checkTriageArtifact(cfg, text);
  assert.match(problems.join(";"), /not a routing class/);
  assert.equal(result, null);
});

test("an artifact carrying a priority or recommendation field is rejected by .strict(): there is nowhere for one to land", () => {
  for (const extra of ["priority: 1", "recommendation: switch jobs"]) {
    const text = valid.replace("    suggested_class: design_decision", `    suggested_class: design_decision\n    ${extra}`);
    const { problems, result } = checkTriageArtifact(cfg, text);
    assert.ok(problems.length > 0, extra);
    assert.equal(result, null, extra);
  }
});

test("unparseable text is a problem, not a thrown error", () => {
  const { problems, result } = checkTriageArtifact(cfg, "```yaml\nitems: [this is not: [valid\n```");
  assert.ok(problems.length > 0);
  assert.equal(result, null);
});

test("an empty items array is rejected: a dump with nothing in it is still a contract failure", () => {
  const { problems } = checkTriageArtifact(cfg, "```yaml\nitems: []\n```");
  assert.ok(problems.length > 0);
});

test("runEligibleClasses names every run class and no decline class", () => {
  const names = runEligibleClasses(cfg).map((c) => c.name);
  for (const [name, cls] of Object.entries(cfg.routing.classes)) {
    assert.equal(names.includes(name), cls.action === "run", name);
  }
  for (const c of runEligibleClasses(cfg)) assert.ok(c.description.length > 0, c.name);
});

test("TriageResultSchema rejects an unknown top-level key", () => {
  const r = TriageResultSchema.safeParse({ items: [{ id: 1, kind: "note", text: "x", draft_problem: null, suggested_class: null }], priority: [1] });
  assert.equal(r.success, false);
});
