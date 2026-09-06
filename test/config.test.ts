import { test } from "node:test";
import assert from "node:assert/strict";
import { cfg } from "./helpers.js";
import { crossCheck } from "../src/config.js";
import { TRAP_IDS } from "../src/schema.js";

test("the shipped config loads and passes the D6 static check", () => {
  assert.equal(cfg.frames.frames.length, 13);
  assert.equal(crossCheck(cfg.frames, cfg.routing, cfg.rubric).length, 0);
});

test("every frame forbids something and attacks something", () => {
  for (const f of cfg.frames.frames) {
    assert.ok(f.forbidden.length > 0, `${f.id} forbids nothing`);
    assert.ok(f.attacks.length > 0, `${f.id} attacks nothing`);
  }
});

test("attacks union covers T1..T7", () => {
  const u = new Set(cfg.frames.frames.flatMap((f) => f.attacks));
  for (const t of TRAP_IDS.slice(0, 7)) assert.ok(u.has(t), `no frame attacks ${t}`);
});

test("crossCheck: duplicate id, shared primary axis, tool outside allowlist, quality dimension", () => {
  const frames = structuredClone(cfg.frames);
  frames.frames.push({ ...frames.frames[0]!, id: frames.frames[0]!.id }); // duplicate
  let problems = crossCheck(frames, cfg.routing, cfg.rubric);
  assert.ok(problems.some((p) => /duplicate ids/.test(p)), problems.join("\n"));

  const routing = structuredClone(cfg.routing);
  const dd = routing.classes["design_decision"]!;
  if (dd.action === "run") dd.frames = ["ACTOR_CENSUS", "END_USER", "LEDGER"]; // both on `actors`
  problems = crossCheck(cfg.frames, routing, cfg.rubric);
  assert.ok(problems.some((p) => /share an axis/.test(p)), problems.join("\n"));

  const frames2 = structuredClone(cfg.frames);
  (frames2.frames[0] as { tools: string[] }).tools = ["Read"];
  // Schema would reject "Read" before crossCheck; simulate the allowlist mismatch instead.
  const routing2 = structuredClone(cfg.routing);
  routing2.defaults.branch_tools_allowed = [];
  problems = crossCheck(cfg.frames, routing2, cfg.rubric);
  assert.ok(problems.some((p) => /not in branch_tools_allowed/.test(p)), problems.join("\n"));

  const rubric = structuredClone(cfg.rubric);
  rubric.dimensions.push({ id: "fluency", weight: 1, question: "is it fluent", anchors: { "0": "a", "1": "b", "2": "c", "3": "d" } });
  problems = crossCheck(cfg.frames, cfg.routing, rubric);
  assert.ok(problems.some((p) => /fluency: is in not_scored/.test(p)), problems.join("\n"));
});

test("no frame stance smuggles a sibling reference", () => {
  for (const f of cfg.frames.frames) {
    assert.ok(!/\bso far\b/i.test(f.stance), `${f.id} stance says "so far"`);
    assert.ok(!/\bother (branches|frames)\b/i.test(f.stance), `${f.id} stance mentions other branches`);
  }
});
