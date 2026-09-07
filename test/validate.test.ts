import { test } from "node:test";
import { stringify } from "yaml";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { artifact, cfg, passA, passB, yaml } from "./helpers.js";
import { checkBlind, redactFrameLabels, unfence, validateBranchArtifact, validatePassA, validatePassB } from "../src/validate.js";
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
  const text = "LEDGER says the Door keeper is wrong, and the Successor view agrees.";
  const all = redactFrameLabels(text, frames);
  assert.ok(!/LEDGER|Door keeper|Successor/i.test(all), `still leaking: ${all}`);
  const kept = redactFrameLabels(text, frames, { keep: "SUCCESSOR" });
  assert.match(kept, /Successor view/, "the survivor keeps its own label");
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

test("unfence is linear on every fence CodeQL called out, and reads the shapes subagents write", () => {
  // unfence runs on the final message of every subagent, so its input is untrusted by
  // construction. Each regex spelling of this had two quantifiers that could match the same
  // character, and CodeQL named three witnesses for it. All three are checked here.
  for (const [name, hostile] of [
    ["newline run", "```\n" + "\n ".repeat(200_000)],
    ["info string", "```" + "```yml".repeat(200_000)],
    ["unclosed body", "```\n" + "```\na".repeat(200_000)],
  ] as const) {
    const started = Date.now();
    unfence(hostile);
    const ms = Date.now() - started;
    assert.ok(ms < 500, `unfence took ${ms}ms on the ${name} witness; it should be linear`);
  }
  for (const [input, want] of [
    ["```yaml\nfoo: 1\n```", "foo: 1"],
    ["```yml\nfoo: 1\n```", "foo: 1"],
    ["```\nfoo: 1\n```", "foo: 1"],
    ["```yaml   \nfoo: 1\n```", "foo: 1"],
    ["```yaml\na: 1\nb: 2\n```", "a: 1\nb: 2"],
    ["```yaml\nfoo: 1\n```\n\nSources: [one](https://example.invalid)", "foo: 1"],
    // No fence, or an unfinished one, means the message was not fenced: hand it back whole.
    ["foo: 1", "foo: 1"],
    ["```", "```"],
    ["```yaml", "```yaml"],
    ["```yaml\nno closing fence", "```yaml\nno closing fence"],
  ] as const)
    assert.equal(unfence(input), want, `unfence(${JSON.stringify(input)})`);
});

// ---- critic refusal (backlog 28) ------------------------------------------------------------

test("a critic that declines to score is reported as a refusal, not as malformed output", () => {
  // These used to be the same failure to a reader: `critic pass A: scores: Required`, a schema
  // complaint aimed at a critic that was being perfectly clear. A refusal is a judgement with a
  // reason someone should read before rerunning; malformed output is a contract violation to fix.
  const H = "sha256:" + "a".repeat(64);
  const letters = ["A", "B"];
  const dims = cfg.rubric.dimensions.map((d) => d.id);

  const explicit = `problem_hash: ${H}\npass: A\nrefused: true\nreason: two artifacts are byte-identical, so blind scoring would be scoring one text twice\n`;
  assert.throws(
    () => validatePassA(explicit, H, letters, dims),
    (e: Error) => e.name === "CriticRefusal" && /byte-identical/.test(e.message) && (e as { code?: string }).code === "CRITIC_REFUSED",
  );

  // A critic writing its own refusal has not been told a field name for it.
  const bare = `problem_hash: ${H}\npass: A\nreason: I cannot score these blind; every artifact names its own frame\n`;
  assert.throws(() => validatePassA(bare, H, letters, dims), (e: Error) => e.name === "CriticRefusal");

  // Pass B refuses through the same path.
  const passBRefusal = `problem_hash: ${H}\npass: B\nrefused: true\nreason: pass A scored a pack I was not given\n`;
  assert.throws(
    () => validatePassB(passBRefusal, H, ["LEDGER"], 0),
    (e: Error) => e.name === "CriticRefusal" && /pass B refused/.test(e.message),
  );
});

test("a half-scored pack calling itself a refusal is still a contract violation", () => {
  // The one shape that could hide a real failure behind the new path. Anything carrying the
  // fields a real pass has is validated as a real pass, whatever it calls itself.
  const H = "sha256:" + "b".repeat(64);
  const dims = cfg.rubric.dimensions.map((d) => d.id);
  const half = `problem_hash: ${H}\npass: A\nrefused: true\nreason: partway through\nscores:\n  A:\n    ${dims[0]}:\n      score: 2\n      evidence: something\n`;
  assert.throws(() => validatePassA(half, H, ["A", "B"], dims), (e: Error) => e.name === "ContractError");
});

test("a refusal never masks a hash mismatch", () => {
  // Order matters: paraphrase drift invalidates the run whatever the critic then says about it.
  const H = "sha256:" + "c".repeat(64);
  const wrongHash = `problem_hash: sha256:${"d".repeat(64)}\npass: A\nrefused: true\nreason: anything\n`;
  assert.throws(() => validatePassA(wrongHash, H, ["A"], cfg.rubric.dimensions.map((d) => d.id)), (e: Error) => e.name === "HashMismatch");
});

test("nothing in prompts/ invites the critic to refuse", () => {
  // The receiving half only. An escape hatch a critic is told about is easier to take than
  // scoring, and the critique phase is where the consensus trap gets caught. Offering one is a
  // change to the product and is backlog 69, not something to slip in beside the handler.
  for (const f of readdirSync(join(cfg.root, "prompts")).filter((x) => x.endsWith(".md"))) {
    const text = readFileSync(join(cfg.root, "prompts", f), "utf8");
    assert.ok(!/\brefus(e|al)\b/i.test(text), `prompts/${f} mentions refusing; that is a product change and needs D-level agreement first`);
  }
});
