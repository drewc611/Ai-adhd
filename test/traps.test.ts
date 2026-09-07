import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { artifact, cfg, tmp } from "./helpers.js";
import { trapsReport } from "../src/traps.js";

const HASH = "sha256:" + "a".repeat(64);
const FRAMES = cfg.frames.frames.map((f) => f.id);

function write(body: unknown, name = "a.yaml"): string {
  const p = join(tmp(), name);
  writeFileSync(p, typeof body === "string" ? body : stringify(body));
  return p;
}

test("a valid artifact passes with the frame and confidence named", () => {
  const r = trapsReport(write(artifact("LEDGER", HASH)));
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /contract: ok \(frame LEDGER, confidence medium\)/);
});

/** A contract violation removes the artifact before the critic sees it, so it must be loud. */
test("a missing required field is reported as a violation, with the field named", () => {
  const { falsifier: _f, ...missing } = artifact("LEDGER", HASH);
  const r = trapsReport(write(missing));
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /contract: VIOLATED \(would be pruned\)/);
  assert.match(r.text, /falsifier/);
});

test("an empty forecloses list is a violation, not a lint", () => {
  const r = trapsReport(write(artifact("LEDGER", HASH, { forecloses: [] })));
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /forecloses/);
});

/**
 * FrameIdSchema only checks the shape, because it also validates config/frames.yaml and cannot
 * refer to it. Membership has to come from the caller, and before it did, `adhd traps` reported
 * "contract: ok (frame NOT_A_FRAME)" on an artifact no run would accept.
 */
test("a frame id that is not in the library is a violation when the library is given", () => {
  const p = write({ ...artifact("LEDGER", HASH), frame: "NOT_A_FRAME" });
  const r = trapsReport(p, { frames: FRAMES });
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /NOT_A_FRAME is not in the frame library/);
  assert.match(r.text, /LEDGER/, "the known ids are listed");
});

test("without a library the shape is all that can be checked, and the report says so", () => {
  const r = trapsReport(write({ ...artifact("LEDGER", HASH), frame: "NOT_A_FRAME" }));
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /no library to check membership against/);
});

test("a real frame id passes the membership check", () => {
  const r = trapsReport(write(artifact("DOOR_KEEPER", HASH)), { frames: FRAMES });
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /contract: ok \(frame DOOR_KEEPER/);
});

test("a file that is not an artifact at all is a violation rather than a crash", () => {
  const r = trapsReport(write("just some prose, no fields at all\n"));
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /VIOLATED/);
});

/** Subagents return YAML inside a code fence, so the same unfencing the run uses applies here. */
test("an artifact wrapped in a code fence is read", () => {
  const p = write("```yaml\n" + stringify(artifact("MECHANIC", HASH)) + "```\n");
  const r = trapsReport(p);
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /frame MECHANIC/);
});

test("a hash mismatch is reported as an abort, and only when a hash was given", () => {
  const p = write(artifact("LEDGER", HASH));
  assert.equal(trapsReport(p).exitCode, 0, "no expected hash means nothing to check");
  assert.ok(!/problem_hash/.test(trapsReport(p).text));

  const ok = trapsReport(p, { expectHash: HASH });
  assert.equal(ok.exitCode, 0);
  assert.match(ok.text, /problem_hash: matches/);

  const bad = trapsReport(p, { expectHash: "sha256:" + "b".repeat(64) });
  assert.equal(bad.exitCode, 1);
  assert.match(bad.text, /MISMATCH/);
  assert.match(bad.text, /Run would abort/);
});

test("a clean artifact says which traps were mechanically checked and which were not", () => {
  const r = trapsReport(write(artifact("LEDGER", HASH)));
  assert.match(r.text, /lints: none fired \(T3, T4, T5 checked\)/);
  assert.match(r.text, /T1, T2, T6, T7, T8 need the critic/);
});

/** A lint is a hint for the critic, not a prune. Exiting non-zero on one would overstate it. */
test("a fired lint is reported without failing the artifact", () => {
  const r = trapsReport(
    write(
      artifact("LEDGER", HASH, {
        reasoning: "According to Martin Fowler and the well known industry consensus, best practice is to use a circuit breaker. Studies show this is standard.",
      }),
    ),
  );
  assert.match(r.text, /^lint T\d:/m);
  assert.equal(r.exitCode, 0, "a lint is a hint for the critic, not a contract violation");
});

test("a null missing_actor is noted, because run level T6 fires when every branch does it", () => {
  const r = trapsReport(write(artifact("LEDGER", HASH, { missing_actor: null })));
  assert.equal(r.exitCode, 0);
  assert.match(r.text, /missing_actor is null/);
  assert.match(r.text, /run level T6/);
});

test("every recorded branch artifact still satisfies the contract it was written under", () => {
  const bad: string[] = [];
  for (const id of ["001-first-run", "002-first-run", "002-kernel-enduser", "003-kernel-strategy", "004-kernel-naming"]) {
    const dir = join(cfg.root, "evals", "recorded", id, "branches");
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".yaml")) continue;
      const r = trapsReport(join(dir, f), { frames: FRAMES });
      // 002-first-run recorded one artifact that violates the contract on purpose; the run
      // pruned it and said so. Anything else failing here means a schema change broke history.
      if (r.exitCode !== 0) bad.push(`${id}/${f}`);
    }
  }
  assert.deepEqual(bad, [], "recorded artifacts that no longer parse");
});
