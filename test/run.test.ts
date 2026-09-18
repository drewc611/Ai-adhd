import { dimensionsAt } from "../src/schema.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifact, cfg, passA, passB, tmp, writeProblem, yaml } from "./helpers.js";
import { checkDispatch, computeScore, loadPlan, phaseCompile, phaseCritique, phaseDeepen, phaseSynth, renderRun } from "../src/run.js";
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
  assert.deepEqual(checkBlind(passABrief, cfg.frames.frames, { problem: PROBLEM }), [], "pass A brief leaked a frame label");
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
  clustered = [frames[0]!, frames[1]!];
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

/**
 * A representative wins its cluster by a hair. Every contested decision in the recorded corpus
 * came in at two anchor points or fewer out of 48, and one was an exact tie broken by frame id.
 * The recommendation line reads as though a decision was made, so the synthesis says otherwise.
 */
/** The two frames the pass B below groups into one cluster, so a test can score them apart. */
let clustered: [string, string] = ["", ""];

function runToSynth(scoreFor: (frame: string, dimension: string) => number): string {
  const { runDir, plan } = compileRun();
  const H = plan.problem_hash;
  const frames = plan.branches.map((b) => b.frame);
  for (const b of plan.branches) writeFileSync(join(runDir, b.artifact_path), yaml(artifact(b.frame, H)));
  phaseCritique(cfg, runDir);
  clustered = [frames[0]!, frames[1]!];
  const blindMap = JSON.parse(readFileSync(join(runDir, "critic/blind-map.json"), "utf8")) as Record<string, string>;

  const scores: Record<string, Record<string, { score: number; evidence: string }>> = {};
  for (const [letter, frame] of Object.entries(blindMap)) {
    scores[letter] = {};
    for (const d of dimensionsAt(cfg.rubric.dimensions, cfg.rubric.version)) scores[letter]![d.id] = { score: scoreFor(frame, d.id), evidence: `evidence for ${letter}.${d.id}` };
  }
  writeFileSync(join(runDir, "critic/pass-a.yaml"), yaml({ problem_hash: H, pass: "A", scores }));
  phaseCritique(cfg, runDir);
  writeFileSync(
    join(runDir, "critic/pass-b.yaml"),
    yaml(passB(H, [{ id: "shared", members: [frames[0]!, frames[1]!], action: "Expose cancel before any timer fires." }, ...frames.slice(2).map((f) => ({ id: `lone_${f}`, members: [f] }))])),
  );
  phaseCritique(cfg, runDir);
  const d = phaseDeepen(cfg, runDir);
  for (const n of d.next!) {
    const own = n.brief.match(/deepen\/([A-Z_]+)\.brief\.md$/)![1]!;
    writeFileSync(n.artifact, yaml({ problem_hash: H, frame: own, verdict: "defend", response: "The objection assumes the user waits.", revised_position: `Do the ${own} thing, with cancel first.`, revised_falsifier: null, confidence: "high" }));
  }
  phaseSynth(cfg, runDir);
  return readFileSync(join(runDir, "synthesis.md"), "utf8");
}

test("a representative that tied its runner up is not presented as a decision", () => {
  const synth = runToSynth(() => 2);
  const rec = sections(synth)["Recommendation"]!;
  assert.match(rec, /\*\*Close call\.\*\*/);
  assert.match(rec, /scored level in pass A/);
  assert.match(rec, /broken by frame id, alphabetically, not by the rubric/);
  assert.match(rec, /as well supported as this one/);
});

test("a one anchor point margin is named in the recommendation", () => {
  // The cluster's first member scores one point higher on one weight-1 dimension. That is the
  // smallest separation the rubric can express, and it decided two of the four contested
  // clusters in the recorded corpus.
  const cheapest = dimensionsAt(cfg.rubric.dimensions, cfg.rubric.version).find((d) => d.weight === 1)!.id;
  const synth = runToSynth((frame, dim) => (frame === clustered[0] && dim === cheapest ? 3 : 2));
  const rec = sections(synth)["Recommendation"]!;
  assert.match(rec, /\*\*Close call\.\*\*/);
  assert.match(rec, /A single anchor read the other way would have sent/);
});

test("a comfortable margin gets no close call note", () => {
  const synth = runToSynth((frame) => (frame === clustered[0] ? 3 : 0));
  const rec = sections(synth)["Recommendation"]!;
  assert.ok(!/Close call/.test(rec), "a wide margin should say nothing");
});

/**
 * `pass_a` is a weighted total, so two runs are only comparable if the same weights produced
 * them. The version existed in config/critic-rubric.yaml and nothing read it, which meant a
 * rubric change would have split the corpus into halves that look comparable and are not.
 * D8 recommends exactly such a change, so the stamp has to land before it, not after.
 */
test("a scored run records the rubric version that produced its numbers", () => {
  const { runDir, plan } = compileRun();
  const H = plan.problem_hash;
  const frames = plan.branches.map((b) => b.frame);
  for (const b of plan.branches) writeFileSync(join(runDir, b.artifact_path), yaml(artifact(b.frame, H)));

  phaseCritique(cfg, runDir);
  const blindMap = JSON.parse(readFileSync(join(runDir, "critic/blind-map.json"), "utf8")) as Record<string, string>;
  writeFileSync(join(runDir, "critic/pass-a.yaml"), yaml(passA(H, Object.keys(blindMap))));
  phaseCritique(cfg, runDir);
  writeFileSync(
    join(runDir, "critic/pass-b.yaml"),
    yaml(passB(H, [{ id: "together", members: frames.slice(0, 2) }, ...frames.slice(2).map((f) => ({ id: `c_${f}`, members: [f] }))])),
  );
  phaseCritique(cfg, runDir);

  const { score } = computeScore(cfg, runDir);
  assert.equal(score.rubric_version, cfg.rubric.version);
  assert.equal(JSON.parse(readFileSync(join(runDir, "score.json"), "utf8")).rubric_version, cfg.rubric.version);
});

/*
 * D41's second half. The permit was the symptom; this is the defect that let it hide.
 *
 * `plan.json` records the agent a run *intends* for each task and nothing recorded what it *got*.
 * `adhd-branch`, `adhd-critic` and `adhd-deepen` could not launch in any host tried, every dispatch
 * silently fell back, and because a subagent type selects a system prompt the critic ran the branch
 * instructions. Twelve recorded runs and two decisions were written on top of that, and all fifteen
 * `plan.json` files still say `"agent": "adhd-branch"`.
 */
test("a run with no dispatch record says so rather than reading as clean", () => {
  const d = checkDispatch(join(cfg.root, "evals", "recorded", "001-seed3"));
  assert.equal(d.recorded, false);
  assert.match(d.text, /not recorded/);
  assert.match(d.text, /intention rather than a fact/);
  assert.ok(d.missing.length >= 5, "every planned branch is unaccounted for when nothing was recorded");
});

test("a substitution is reported with the agent that actually ran and the reason", () => {
  const dir = join(tmp(), "run");
  cpSync(join(cfg.root, "evals", "recorded", "001-seed3"), dir, { recursive: true });
  writeFileSync(
    join(dir, "dispatch.json"),
    JSON.stringify({
      entries: [
        { task: "branch:ACTOR_CENSUS", planned: "adhd-branch", actual: "adhd-branch-search", note: "adhd-branch refused: unrecognized [TodoWrite]" },
        { task: "critique:pass-a", planned: "adhd-critic", actual: "adhd-branch-search", note: "adhd-critic refused the same way" },
      ],
    }),
  );
  const d = checkDispatch(dir);
  assert.equal(d.recorded, true);
  assert.equal(d.substitutions.length, 2);
  assert.match(d.text, /SUBSTITUTED critique:pass-a: planned adhd-critic, spawned adhd-branch-search/);
  assert.match(d.text, /unrecognized \[TodoWrite\]/, "the refusal text is the evidence and must survive into the report");
  assert.ok(d.missing.length > 0, "branches with no entry are still named");
});

/** A substitution is allowed. Doing it silently is what produced fifteen misleading recordings. */
test("a substitution with no reason is refused rather than recorded", () => {
  const dir = join(tmp(), "run");
  cpSync(join(cfg.root, "evals", "recorded", "001-seed3"), dir, { recursive: true });
  writeFileSync(
    join(dir, "dispatch.json"),
    JSON.stringify({ entries: [{ task: "branch:LEDGER", planned: "adhd-branch", actual: "general-purpose" }] }),
  );
  assert.throws(
    () => checkDispatch(dir),
    (e: Error) => /planned adhd-branch and spawned general-purpose with no note/.test(e.message),
  );
});

test("a run whose dispatch matches its plan says so in one line", () => {
  const dir = join(tmp(), "run");
  cpSync(join(cfg.root, "evals", "recorded", "001-seed3"), dir, { recursive: true });
  const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as { branches: { frame: string; agent: string }[] };
  writeFileSync(
    join(dir, "dispatch.json"),
    JSON.stringify({ entries: plan.branches.map((b) => ({ task: `branch:${b.frame}`, planned: b.agent, actual: b.agent })) }),
  );
  const d = checkDispatch(dir);
  assert.deepEqual(d.substitutions, []);
  assert.deepEqual(d.missing, []);
  assert.match(d.text, /every task ran on the agent the plan named/);
});

/*
 * The corpus is exempt on purpose and the exemption has to stay narrow. Appending a Dispatch
 * section to every recording would rewrite the fifteen syntheses item 4's finding rests on to suit
 * a feature added afterwards, and `adhd replay` caught that attempt. A run that records nothing
 * renders exactly as it did before.
 */
test("a recording with no dispatch record renders byte-identically to before D41", () => {
  const dir = join(cfg.root, "evals", "recorded", "001-seed3");
  const rendered = renderRun(cfg, dir);
  assert.ok(!/## Dispatch/.test(rendered), "a historical synthesis must not gain a section its run never produced");
  assert.equal(rendered, readFileSync(join(dir, "synthesis.md"), "utf8"));
});

test("a substitution reaches the synthesis, the way the pruned block does", () => {
  const dir = join(tmp(), "run");
  cpSync(join(cfg.root, "evals", "recorded", "001-seed3"), dir, { recursive: true });
  writeFileSync(
    join(dir, "dispatch.json"),
    JSON.stringify({
      entries: [{ task: "critique:pass-a", planned: "adhd-critic", actual: "adhd-branch-search", note: "adhd-critic refused: unrecognized [TodoWrite]" }],
    }),
  );
  const rendered = renderRun(cfg, dir);
  assert.match(rendered, /## Dispatch/);
  assert.match(rendered, /did not use the agents its plan named/);
  assert.match(rendered, /a subagent type selects a system/i, "the reader is told why a substitution matters, not just that one happened");
  assert.match(rendered, /adhd-critic.*adhd-branch-search/);
});
