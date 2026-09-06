import { test } from "node:test";
import { stringify } from "yaml";
import assert from "node:assert/strict";
import { artifact, cfg, passA, passB, yaml } from "./helpers.js";
import { validateBranchArtifact, validatePassA, validatePassB, checkBlind, redactFrameLabels } from "../src/validate.js";
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

test("checkBlind catches frame ids, frame display names, and a frame field", () => {
  const frames = cfg.frames.frames;
  assert.deepEqual(checkBlind("### Artifact A\nposition: do x", frames), []);
  assert.ok(checkBlind("### Artifact A\nframe: LEDGER", frames).length >= 2);
  // The leak that only checking ids left open: a branch naming its frame the way a brief prints it.
  const byName = checkBlind("### Artifact A\nreasoning: From inside the Door keeper stance, sort the moves.", frames);
  assert.ok(byName.some((p) => /Door keeper/.test(p)), "a display name identifies the frame as surely as its id");
  assert.ok(checkBlind("### Artifact A\nreasoning: Reading it as the Ledger, someone pays.", frames).some((p) => /Ledger/.test(p)));
});

test("a label the problem itself uses is not a leak, because every branch may echo the problem", () => {
  const frames = cfg.frames.frames;
  const text = "### Artifact A\nreasoning: The mechanic cannot see the dashboard from the bay.";
  assert.ok(checkBlind(text, frames).some((p) => /Mechanic/i.test(p)), "without the problem it reads as a label");
  assert.deepEqual(
    checkBlind(text, frames, { problem: "How should the mechanic see the dashboard?" }),
    [],
    "with the problem in hand the same word discriminates nothing",
  );
});

test("redaction strips ids and names, keeps one frame's own label, and leaves problem words alone", () => {
  const frames = cfg.frames.frames;
  const text = "LEDGER says the Door keeper is wrong, and the Horizon view agrees.";
  const all = redactFrameLabels(text, frames);
  assert.ok(!/LEDGER|Door keeper|Horizon/i.test(all), `still leaking: ${all}`);
  const kept = redactFrameLabels(text, frames, { keep: "HORIZON" });
  assert.match(kept, /Horizon view/, "the survivor keeps its own label");
  assert.ok(!/Door keeper/i.test(kept), "but not a sibling's");
  const echoed = redactFrameLabels("The ledger is already reconciled.", frames, { problem: "Is the ledger reconciled?" });
  assert.match(echoed, /ledger is already reconciled/, "a word the problem uses survives redaction");
});

test("a detector that fires on evidence too thin to be an argument rejects the pass", () => {
  const H = "sha256:" + "a".repeat(64);
  const frames = ["LEDGER", "MECHANIC"];
  const build = (evidence: string) => {
    const traps: Record<string, Record<string, { fired: boolean; evidence: string }>> = {};
    for (const f of frames) {
      traps[f] = {};
      for (const t of ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"])
        traps[f]![t] = f === "LEDGER" && t === "T1" ? { fired: true, evidence } : { fired: false, evidence: "not fired" };
    }
    return stringify({
      problem_hash: H,
      pass: "B",
      clusters: [
        { id: "a", action: "do a", members: ["LEDGER"], singleton: true, strongest_objection: null },
        { id: "b", action: "do b", members: ["MECHANIC"], singleton: true, strongest_objection: "an objection" },
      ],
      traps,
      run_level: {
        T2_no_branch_attacked_assumption: { fired: false, evidence: "one branch did" },
        T6_all_missing_actor_null: { fired: false, evidence: "all named an actor" },
      },
      lint_verdicts: [],
    });
  };
  // Thin: a verdict wearing the word "evidence". Pruning a frame on this defeats the detectors.
  assert.throws(() => validatePassB(build("yes, T1"), H, frames, 12), /fired on 2 word\(s\) of evidence/);
  // Argued: the shape every fired record in the recorded runs actually has.
  const real = "Delete the three most specific details from the prompt and this position is unchanged, because nothing in it depends on them.";
  assert.doesNotThrow(() => validatePassB(build(real), H, frames, 12));
  // The floor is opt-in: zero means the check is off, which is what an older config gets.
  assert.doesNotThrow(() => validatePassB(build("yes, T1"), H, frames, 0));
});
