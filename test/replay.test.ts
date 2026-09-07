import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { loadBaseline, replayAll, replayRun } from "../src/replay.js";

const CORPUS = join(cfg.root, "evals", "recorded");

/** A scratch copy of the recorded corpus, so a test that writes cannot touch the evidence. */
function corpusCopy(): string {
  const dir = join(tmp(), "recorded");
  cpSync(CORPUS, dir, { recursive: true });
  return dir;
}

test("every recorded run either renders as recorded or is in the baseline with a reason", () => {
  // The regression gate the corpus never had. A change to src/synth.ts, the scorer or the
  // cluster ranking silently makes every recorded synthesis describe a rendering that no longer
  // happens, and the eval harness cannot see it: it reads artifacts and fixture assertions, not
  // the prose a reader is shown.
  const r = replayAll(cfg);
  assert.ok(r.runs.length >= 7, "the corpus lost runs");
  assert.deepEqual(r.failed, [], `runs that could not be re-rendered at all: ${r.failed.map((x) => `${x.run} (${x.error})`).join(", ")}`);
  assert.deepEqual(
    r.drifted.map((x) => x.run),
    [],
    "a recorded synthesis drifted with no baseline entry. Read the diff, decide whether the renderer improved or a recording was edited, then add an entry saying which.",
  );
  assert.deepEqual(r.stale_baseline, [], "a baseline entry is stale: that run renders as recorded now and its entry should go");
});

test("the baseline says why for every run it excuses, and excuses nothing that is not drifting", () => {
  const baseline = loadBaseline(cfg);
  const r = replayAll(cfg);
  const actuallyDrifting = r.runs.filter((x) => x.had_recorded && !x.same && x.error === null).map((x) => x.run).sort();
  assert.deepEqual(Object.keys(baseline.drifted).sort(), actuallyDrifting, "the baseline and the corpus disagree about which runs drift");
  for (const [run, why] of Object.entries(baseline.drifted)) {
    assert.ok(why.length > 60, `${run}'s baseline entry is too short to be a reason`);
    // An entry has to name what changed. "known issue" is not a reason.
    assert.ok(/render|Close call|Folded|defend|attribut|cluster/i.test(why), `${run}'s entry does not say what changed`);
  }
  assert.match(baseline.why, /recorded synthesis is what the reader was actually shown/);
});

test("replay never touches a recording unless --write is passed", () => {
  const dir = corpusCopy();
  const target = join(dir, "002-kernel-enduser", "synthesis.md");
  const before = readFileSync(target, "utf8");
  replayAll(cfg, dir);
  assert.equal(readFileSync(target, "utf8"), before, "replay rewrote a recording it was only asked to check");

  const r = replayAll(cfg, dir, { write: true });
  assert.notEqual(readFileSync(target, "utf8"), before, "--write did not write");
  assert.match(r.text, /--write was passed/);
  // And after writing, everything matches, which is exactly why --write is not the default.
  assert.deepEqual(replayAll(cfg, dir).runs.filter((x) => !x.same && x.error === null).map((x) => x.run), []);
});

test("a hand-edited recording is caught as unexplained drift", () => {
  // The other thing this gate is for. 004-kernel-naming currently renders as recorded, so an
  // edit to it has no baseline entry to hide behind.
  const dir = corpusCopy();
  const target = join(dir, "004-kernel-naming", "synthesis.md");
  writeFileSync(target, readFileSync(target, "utf8").replace("## Pruned, with reason", "## Pruned, mostly"));
  const r = replayAll(cfg, dir);
  assert.deepEqual(r.drifted.map((x) => x.run), ["004-kernel-naming"]);
  assert.match(r.text, /not in evals\/replay-baseline\.json/);
});

test("a stale baseline entry fails as loudly as drift does", () => {
  // A baseline that forgives drift no longer happening is how the next real regression is
  // waved through, so it is an error rather than a note.
  const dir = corpusCopy();
  const drifting = join(dir, "001-first-run");
  replayRun(cfg, drifting, { write: true }); // now it matches, and its baseline entry is stale
  const r = replayAll(cfg, dir);
  assert.deepEqual(r.stale_baseline, ["001-first-run"]);
  assert.match(r.text, /baseline entry\(ies\) are stale/);
});

test("a cancelled run is detected by pass B, not by grepping its prose for the word cancel", () => {
  // Fixture 001 asks a question *about* a cancel button, so every branch says "cancel"
  // repeatedly. An earlier version of this decided partial-vs-full by searching the recorded
  // synthesis for "cancelled" and rendered the whole run as a cancellation: 229 lines against
  // 56 recorded. A heuristic over prose cannot tell a run's state from its subject.
  const full = replayRun(cfg, join(CORPUS, "001-first-run"));
  assert.equal(full.error, null);
  assert.ok(full.rendered.startsWith("# ADHD synthesis"), `rendered as ${full.rendered.split("\n")[0]}`);
  assert.ok(!full.rendered.includes("# UNSCORED"), "a completed run rendered through the partial path");
  assert.ok(Math.abs(full.rendered_lines - full.recorded_lines) < 20, "the rendering is the same shape as the recording");
});

test("negative controls are skipped: a hand-written answer is not a run", () => {
  const r = replayAll(cfg);
  for (const run of r.runs) assert.ok(!run.run.endsWith("-linear-cot"), `${run.run} has no plan.json and should not be replayed`);
  assert.ok(existsSync(join(CORPUS, "001-linear-cot")), "the controls are still in the corpus");
});
