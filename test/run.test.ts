import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifact, cfg, passA, passB, tmp, writeProblem, yaml } from "./helpers.js";
import { phaseCompile, phaseCritique, phaseDeepen, phaseSynth, loadPlan } from "../src/run.js";
import { checkBlind } from "../src/validate.js";
import { HashMismatch, RunAbort } from "../src/errors.js";
import { sections } from "../src/eval.js";

const PROBLEM = "What timeouts should I set on this HTTP client?";

function compileRun(problem = PROBLEM, cls = "design_decision") {
  const dir = tmp();
  const problemPath = writeProblem(join(dir, "in"), problem);
  const r = phaseCompile(cfg, { problemPath, decision: { problem_class: cls }, runsDir: join(dir, "runs"), seed: 1, runId: "t" });
  assert.equal(r.exitCode, 0);
  return { runDir: r.runDir!, plan: loadPlan(r.runDir!) };
}

test("compile writes problem.txt byte-identical and a plan with distinct axes", () => {
  const { runDir, plan } = compileRun(PROBLEM + "\n  ");
  assert.equal(readFileSync(join(runDir, "problem.txt"), "utf8"), PROBLEM + "\n  ");
  assert.equal(plan.n, 5);
  assert.equal(new Set(plan.branches.map((b) => b.axis)).size, 5);
  for (const b of plan.branches) assert.ok(existsSync(join(runDir, b.brief_path)), `${b.brief_path} missing`);
});

test("full run: critique is blind in pass A, deepen briefs isolate survivors, synthesis always has the pruned block", () => {
  const { runDir, plan } = compileRun();
  const H = plan.problem_hash;
  const frames = plan.branches.map((b) => b.frame);
  // Host writes branch artifacts. One is a consensus answer, one violates the contract.
  for (const b of plan.branches) {
    const over: Record<string, unknown> = {};
    if (b.frame === frames[0]) over.position = "Set 15s first token, 30s inter token, 90s absolute, one retry.";
    if (b.frame === frames[1]) over.forecloses = [];
    writeFileSync(join(runDir, b.artifact_path), yaml(artifact(b.frame, H, over)));
  }

  // critique, state 1: pass A brief
  let r = phaseCritique(cfg, runDir);
  assert.equal(r.exitCode, 0);
  const passABrief = readFileSync(join(runDir, "critic/pass-a.brief.md"), "utf8");
  assert.deepEqual(checkBlind(passABrief, cfg.frames.frames.map((f) => f.id)), [], "pass A brief leaked a frame id");
  const blindMap = JSON.parse(readFileSync(join(runDir, "critic/blind-map.json"), "utf8")) as Record<string, string>;
  const letters = Object.keys(blindMap);
  assert.equal(letters.length, 4, "the contract-violating branch is not sent to the critic");
  assert.ok(!Object.values(blindMap).includes(frames[1]!));

  // host writes pass A
  writeFileSync(join(runDir, "critic/pass-a.yaml"), yaml(passA(H, letters)));
  r = phaseCritique(cfg, runDir);
  assert.match(r.text, /pass B brief written/);
  const passBBrief = readFileSync(join(runDir, "critic/pass-b.brief.md"), "utf8");
  assert.match(passBBrief, /T1 Consensus trap\. Detector:/, "detectors are pulled from TRAPS.md");
  for (const L of letters) assert.match(passBBrief, new RegExp(`${blindMap[L]} \\(was ${L}\\)`));

  // host writes pass B: frames[0] is T1, the rest cluster into two findings
  const valid = frames.filter((f) => f !== frames[1]);
  const pb = passB(
    H,
    [
      { id: "cancel_first", members: [valid[1]!, valid[2]!], action: "Expose cancel and propagate it before any timer fires." },
      { id: "consensus", members: [valid[0]!] },
      { id: "lone", members: [valid[3]!], action: "Fail over instead of retrying the same instance.", objection: `${valid[1]} and ${valid[0]} both argue the opposite; so does MECHANIC.` },
    ],
    { [valid[0]!]: { T1: "delete the specific details and the numbers do not change" } },
  );
  writeFileSync(join(runDir, "critic/pass-b.yaml"), yaml(pb));
  r = phaseCritique(cfg, runDir);
  assert.match(r.text, /critique complete/);

  // deepen
  r = phaseDeepen(cfg, runDir);
  assert.equal(r.exitCode, 0, r.text);
  assert.equal(r.next!.length, 2, "one deepen brief per surviving cluster");
  for (const n of r.next!) {
    const brief = readFileSync(n.brief, "utf8");
    const own = n.brief.match(/deepen\/([A-Z_]+)\.brief\.md$/)![1]!;
    for (const f of cfg.frames.frames.map((x) => x.id)) if (f !== own) assert.ok(!new RegExp(`\\b${f}\\b`).test(brief), `deepen brief for ${own} mentions ${f}`);
    if (own === valid[3]) assert.match(brief, /another line of reasoning and another line of reasoning both argue/, "critic-named frames are redacted from the objection");
    writeFileSync(n.artifact, yaml({ problem_hash: H, frame: own, verdict: "defend", response: "The objection assumes the user waits. Users leave.", revised_position: `Do the ${own} thing, with cancel first.`, revised_falsifier: null, confidence: "high" }));
  }

  // synth
  r = phaseSynth(cfg, runDir);
  const synth = readFileSync(join(runDir, "synthesis.md"), "utf8");
  const secs = sections(synth);
  assert.ok("Pruned, with reason" in secs);
  assert.match(secs["Pruned, with reason"]!, new RegExp(`\\*\\*${frames[0]}\\*\\*[\\s\\S]*traps: T1`));
  assert.match(secs["Pruned, with reason"]!, new RegExp(`\\*\\*${frames[1]}\\*\\*[\\s\\S]*contract:`));
  assert.match(secs["Recommendation"]!, /cancel first/);
  assert.match(secs["Live singletons \\(unverified\\)"] ?? secs["Live singletons (unverified)"]!, new RegExp(valid[3]!));
  assert.match(secs["Corroborated findings"]!, /Expose cancel/);
  assert.ok(existsSync(join(runDir, "score.json")));
});

test("hash mismatch in any artifact aborts the run", () => {
  const { runDir, plan } = compileRun();
  for (const b of plan.branches) writeFileSync(join(runDir, b.artifact_path), yaml(artifact(b.frame, plan.problem_hash)));
  const victim = plan.branches[2]!;
  writeFileSync(join(runDir, victim.artifact_path), yaml(artifact(victim.frame, "sha256:" + "0".repeat(64))));
  assert.throws(() => phaseCritique(cfg, runDir), HashMismatch);
});

test("critique refuses to run with artifacts missing; partial synth takes what exists", () => {
  const { runDir, plan } = compileRun();
  const [first, second] = plan.branches;
  writeFileSync(join(runDir, first!.artifact_path), yaml(artifact(first!.frame, plan.problem_hash)));
  writeFileSync(join(runDir, second!.artifact_path), yaml(artifact(second!.frame, plan.problem_hash, { position: "It depends on the caller." })));
  assert.throws(() => phaseCritique(cfg, runDir), (e: unknown) => e instanceof RunAbort && e.code === "MISSING_ARTIFACTS");
  const r = phaseSynth(cfg, runDir, { partial: true });
  assert.match(r.text, /UNSCORED, divergence only/);
  assert.match(r.text, /branches returned: 2 of 5/);
  assert.match(r.text, /T5:/, "lint hints appear in the partial output");
  for (const b of plan.branches.slice(2)) assert.match(r.text, new RegExp(`- ${b.frame}`));
  assert.doesNotMatch(r.text, /## Recommendation/);
});

test("deepen is refused on monoculture and synth still renders with the run level note", () => {
  const { runDir, plan } = compileRun();
  const H = plan.problem_hash;
  const frames = plan.branches.map((b) => b.frame);
  for (const b of plan.branches) writeFileSync(join(runDir, b.artifact_path), yaml(artifact(b.frame, H)));
  phaseCritique(cfg, runDir);
  const letters = Object.keys(JSON.parse(readFileSync(join(runDir, "critic/blind-map.json"), "utf8")));
  writeFileSync(join(runDir, "critic/pass-a.yaml"), yaml(passA(H, letters)));
  phaseCritique(cfg, runDir);
  writeFileSync(join(runDir, "critic/pass-b.yaml"), yaml(passB(H, [{ id: "all", members: frames }])));
  const r = phaseDeepen(cfg, runDir);
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /MONOCULTURE/);
  const s = phaseSynth(cfg, runDir);
  assert.match(s.text, /MONOCULTURE/);
  assert.match(s.text, /No recommendation/);
});

test("decline writes nothing", () => {
  const dir = tmp();
  const problemPath = writeProblem(join(dir, "in"), "what is 2+2");
  const r = phaseCompile(cfg, { problemPath, decision: { problem_class: "factual_lookup" }, runsDir: join(dir, "runs") });
  assert.equal(r.exitCode, 2);
  assert.ok(!existsSync(join(dir, "runs")));
});
