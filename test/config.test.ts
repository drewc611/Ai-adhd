import { test } from "node:test";
import assert from "node:assert/strict";
import { cfg } from "./helpers.js";
import { crossCheck, currentFrameId, frameIdHistory, knownFrameIds } from "../src/config.js";
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
  if (dd.action === "run") dd.frames = ["ACTOR_CENSUS", "SUPPLICANT", "LEDGER"]; // both on `actors`
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

// ---- renames -------------------------------------------------------------------------------
// A recorded run writes the frame ids that were current when it ran, into plan.json,
// blind-map.json, score.json, pass-b.yaml, its branch and deepen filenames and the append-only
// os.json journal. Those are the record of what ran and are never rewritten, so the library
// forwards instead. Without that a rename silently splits the corpus in two: `frames --stats`
// reported SUPPLICANT and END_USER as separate frames, one of them "not in library".

test("a frame carries every id it has been renamed from, and both directions resolve", () => {
  assert.deepEqual(frameIdHistory(cfg, "SUPPLICANT"), ["SUPPLICANT", "END_USER"]);
  assert.deepEqual(frameIdHistory(cfg, "END_USER"), ["SUPPLICANT", "END_USER"], "an old note has to still resolve");
  assert.equal(currentFrameId(cfg, "END_USER"), "SUPPLICANT");
  assert.equal(currentFrameId(cfg, "SUPPLICANT"), "SUPPLICANT");
  assert.equal(currentFrameId(cfg, "LEDGER"), "LEDGER", "a frame that was never renamed is unaffected");
});

/** A run may name a frame retired outright. That is a fact about the run, not an error. */
test("an id belonging to no frame passes through rather than throwing", () => {
  assert.equal(currentFrameId(cfg, "NEVER_EXISTED"), "NEVER_EXISTED");
  assert.deepEqual(frameIdHistory(cfg, "NEVER_EXISTED"), ["NEVER_EXISTED"]);
});

test("the known-id set is the live library plus every former id", () => {
  const known = knownFrameIds(cfg);
  for (const f of cfg.frames.frames) assert.ok(known.includes(f.id));
  assert.ok(known.includes("END_USER") && known.includes("HORIZON"), "recorded artifacts carry these and must still validate");
  assert.equal(new Set(known).size, known.length, "a duplicate here means two frames claim one id");
});

/**
 * Both of these make a recorded run ambiguous: the id would resolve to whichever frame the scan
 * reached first, silently, and the corpus would join the wrong history onto the wrong frame.
 */
test("a former id that is live, or claimed twice, is refused", () => {
  const clone = () => JSON.parse(JSON.stringify(cfg.frames)) as typeof cfg.frames;

  const live = clone();
  live.frames[0]!.former_ids = ["LEDGER"];
  assert.match(crossCheck(live, cfg.routing, cfg.rubric).join("\n"), /former_id LEDGER is also a live frame id/);

  const twice = clone();
  twice.frames[0]!.former_ids = ["OLD_NAME"];
  twice.frames[1]!.former_ids = ["OLD_NAME"];
  assert.match(crossCheck(twice, cfg.routing, cfg.rubric).join("\n"), /both claim former_id OLD_NAME/);

  const itself = clone();
  itself.frames[0]!.former_ids = [itself.frames[0]!.id];
  assert.match(crossCheck(itself, cfg.routing, cfg.rubric).join("\n"), /lists its own id as a former_id/);
});
