import { test } from "node:test";
import assert from "node:assert/strict";
import { artifact, cfg, passA, passB, yaml } from "./helpers.js";
import { validateBranchArtifact, validatePassA, validatePassB, checkBlind } from "../src/validate.js";
import { HashMismatch, ContractError } from "../src/errors.js";

const H = "sha256:" + "a".repeat(64);

test("problem_hash mismatch aborts, not prunes", () => {
  assert.throws(() => validateBranchArtifact(yaml(artifact("LEDGER", "sha256:" + "b".repeat(64))), H, "LEDGER"), HashMismatch);
  assert.throws(() => validateBranchArtifact(yaml({ ...artifact("LEDGER", H), problem_hash: undefined }), H, "LEDGER"), HashMismatch);
});

test("contract violations prune: empty forecloses, null falsifier, unknown key, wrong frame", () => {
  const r1 = validateBranchArtifact(yaml(artifact("LEDGER", H, { forecloses: [] })), H, "LEDGER");
  assert.equal(r1.ok, false);
  const r2 = validateBranchArtifact(yaml({ ...artifact("LEDGER", H), falsifier: null }), H, "LEDGER");
  assert.equal(r2.ok, false);
  const r3 = validateBranchArtifact(yaml({ ...artifact("LEDGER", H), extra: "x" }), H, "LEDGER");
  assert.equal(r3.ok, false);
  const r4 = validateBranchArtifact(yaml(artifact("MECHANIC", H)), H, "LEDGER");
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.match(r4.violations[0]!, /frame field/);
});

test("fenced YAML from a chatty subagent is accepted", () => {
  const r = validateBranchArtifact("Here you go:\n```yaml\n" + yaml(artifact("LEDGER", H)) + "\n```\n", H, "LEDGER");
  assert.equal(r.ok, true);
});

test("pass A must have every letter x every dimension", () => {
  const letters = ["A", "B", "C"];
  const dims = cfg.rubric.dimensions.map((d) => d.id);
  const good = passA(H, letters);
  assert.ok(validatePassA(yaml(good), H, letters, dims));
  const missing = passA(H, letters);
  delete missing.scores["B"]![dims[0]!];
  assert.throws(() => validatePassA(yaml(missing), H, letters, dims), (e: unknown) => e instanceof ContractError && /B\..* missing/.test(e.message));
  const extraDim = passA(H, letters);
  extraDim.scores["A"]!["fluency"] = { score: 3, evidence: "reads well" };
  assert.throws(() => validatePassA(yaml(extraDim), H, letters, dims), /not a rubric dimension/);
});

test("pass B: every (branch, trap) record required; clusters partition the frames", () => {
  const frames = ["LEDGER", "MECHANIC", "SABOTEUR"];
  const good = passB(H, [{ id: "cancel", members: ["LEDGER", "MECHANIC"] }, { id: "lone", members: ["SABOTEUR"] }]);
  assert.ok(validatePassB(yaml(good), H, frames));
  const missing = passB(H, [{ id: "cancel", members: ["LEDGER", "MECHANIC"] }, { id: "lone", members: ["SABOTEUR"] }]);
  delete (missing.traps["MECHANIC"] as Record<string, unknown>)["T7"];
  assert.throws(() => validatePassB(yaml(missing), H, frames), /MECHANIC\.T7/);
  const dup = passB(H, [{ id: "a", members: ["LEDGER", "MECHANIC"] }, { id: "b", members: ["MECHANIC", "SABOTEUR"] }]);
  assert.throws(() => validatePassB(yaml(dup), H, frames), /MECHANIC is in 2 clusters/);
  const orphan = passB(H, [{ id: "a", members: ["LEDGER", "MECHANIC"] }]);
  assert.throws(() => validatePassB(yaml(orphan), H, frames), /SABOTEUR is in no cluster/);
});

test("checkBlind catches frame ids and a frame field", () => {
  const ids = cfg.frames.frames.map((f) => f.id);
  assert.deepEqual(checkBlind("### Artifact A\nposition: do x", ids), []);
  assert.ok(checkBlind("### Artifact A\nframe: LEDGER", ids).length >= 2);
});
