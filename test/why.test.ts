import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cfg } from "./helpers.js";
import { explainFrame } from "../src/why.js";
import { UsageError } from "../src/errors.js";

const run = (id: string) => join(cfg.root, "evals", "recorded", id);

/** A frame that does not exist is a wrong command line, not a broken repository. */
test("an unknown frame is refused with the library listed, not explained as absent", () => {
  assert.throws(() => explainFrame(cfg, run("002-kernel-enduser"), "NOT_A_FRAME"), UsageError);
  try {
    explainFrame(cfg, run("002-kernel-enduser"), "NOT_A_FRAME");
  } catch (e) {
    assert.match((e as UsageError).message, /PARTICULARIST/);
    assert.ok(!/config invalid/.test((e as UsageError).message));
  }
});

test("frame ids are matched case insensitively", () => {
  assert.equal(explainFrame(cfg, run("002-kernel-enduser"), "supplicant").frame, "SUPPLICANT");
});

/**
 * The run on disk says END_USER: in its plan, its score, its blind map and the filename of its
 * artifact. Anyone holding a note from before the rename, or reading the run's own synthesis.md,
 * will type that. It has to resolve, and it has to report under the name the library uses now.
 */
test("a frame renamed since the run still resolves under the id the run recorded", () => {
  const byOld = explainFrame(cfg, run("002-kernel-enduser"), "END_USER");
  const byNew = explainFrame(cfg, run("002-kernel-enduser"), "SUPPLICANT");
  assert.equal(byOld.frame, "SUPPLICANT", "the report names the frame as the library names it today");
  assert.equal(byOld.dispatched, true, "the run dispatched it, under its old id");
  assert.equal(byOld.status, "pruned");
  assert.deepEqual(byOld, byNew, "both ids reach the same frame in the same run");
});

/** A frame routing never selected was not rejected, and saying "pruned: no" would imply it was. */
test("a frame the plan never selected is reported as not dispatched", () => {
  const r = explainFrame(cfg, run("002-kernel-enduser"), "NIGHT_OPERATOR");
  assert.equal(r.dispatched, false);
  assert.equal(r.status, "not dispatched");
  assert.equal(r.axis, null);
  assert.deepEqual(r.fired, []);
  assert.match(r.text, /A frame that was never asked cannot have been rejected/);
  assert.ok(!/Pass A/.test(r.text), "there is no pass A row to print");
});

test("a pruned frame prints every detector that fired, with its evidence", () => {
  const r = explainFrame(cfg, run("002-kernel-enduser"), "SUPPLICANT");
  assert.equal(r.status, "pruned");
  assert.deepEqual(r.fired.map((f) => f.trap).sort(), ["T1", "T7", "T8"]);
  for (const f of r.fired) assert.ok(f.evidence.split(/\s+/).length > 10, `${f.trap} evidence is too thin to have pruned anything`);
  assert.equal(r.standing.rank_in_cluster, null, "a pruned frame has no rank among survivors");
  assert.match(r.text, /Pruned by these detectors/);
});

/**
 * The distinction the pruned block cannot draw. A pruned member of a cluster others still hold
 * corroborated the action; a pruned frame that was the whole cluster took the action with it.
 */
test("a pruned singleton cluster says the action reached the reader only through the pruned block", () => {
  const r = explainFrame(cfg, run("002-kernel-enduser"), "SUPPLICANT");
  assert.equal(r.cluster!.members.length, 1);
  assert.match(r.text, /only member and was pruned, so the action has no holder/);
});

test("a survivor prints its blind pass A row, weakest dimension first", () => {
  const r = explainFrame(cfg, run("002-kernel-enduser"), "FRAME_BREAKER");
  assert.equal(r.status, "survivor");
  assert.equal(r.dimensions.length, cfg.rubric.dimensions.length);
  const weighted = r.dimensions.map((d) => d.score * d.weight);
  assert.deepEqual(weighted, [...weighted].sort((a, b) => a - b), "weakest contribution first");
  for (const d of r.dimensions) assert.ok(d.evidence.length > 0, `${d.dimension} has no evidence`);
});

/** The finding from D8, surfaced where a reader of one frame would look for it. */
test("a representative that won by a hair says so", () => {
  const r = explainFrame(cfg, run("002-kernel-enduser"), "FRAME_BREAKER");
  assert.equal(r.standing.representative, true);
  assert.equal(r.standing.rank_in_cluster, 1);
  const step = 1 / cfg.rubric.dimensions.reduce((s, d) => s + d.weight * cfg.rubric.scale.max, 0);
  assert.ok(r.standing.margin_to_next! <= step * 2 + 1e-9, `margin was ${r.standing.margin_to_next}`);
  assert.match(r.text, /at most two anchor points/);
  assert.match(r.text, /One dimension read the other way would have changed this/);
});

test("the frame that lost the same cluster reports the same margin from the other side", () => {
  const winner = explainFrame(cfg, run("002-kernel-enduser"), "FRAME_BREAKER");
  const loser = explainFrame(cfg, run("002-kernel-enduser"), "SABOTEUR");
  assert.equal(loser.standing.representative, false);
  assert.equal(loser.standing.rank_in_cluster, 2);
  assert.ok(Math.abs(loser.standing.margin_to_next! - winner.standing.margin_to_next!) < 1e-9);
});

test("a deepen verdict is summarised and the full text left in the artifact", () => {
  const r = explainFrame(cfg, run("002-kernel-enduser"), "FRAME_BREAKER");
  assert.equal(r.deepen!.verdict, "defend");
  assert.ok(r.deepen!.revised_position, "this run revised under objection");
  assert.match(r.text, /Full response in deepen\/FRAME_BREAKER\.yaml/);
  assert.ok(!r.text.split("\n").some((l) => l.length > 320), "no line should dump a whole artifact");
});

test("every frame in every recorded run explains without throwing", () => {
  for (const id of ["001-first-run", "002-first-run", "002-kernel-enduser", "003-kernel-strategy", "004-kernel-naming"])
    for (const f of cfg.frames.frames) {
      const r = explainFrame(cfg, run(id), f.id);
      assert.equal(r.frame, f.id);
      assert.ok(r.text.startsWith(`${f.id} in ${id}`), `${id}/${f.id} header`);
    }
});

test("no report line dumps a whole artifact, on any frame of any recorded run", () => {
  for (const id of ["001-first-run", "002-first-run", "002-kernel-enduser", "003-kernel-strategy", "004-kernel-naming"])
    for (const f of cfg.frames.frames) {
      const long = explainFrame(cfg, run(id), f.id).text.split("\n").filter((l) => l.length > 320);
      assert.deepEqual(long, [], `${id}/${f.id} printed a line of ${long[0]?.length} chars`);
    }
});
