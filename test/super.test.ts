import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractError, RunAbort } from "../src/errors.js";
import {
  CLASS_POLICY,
  Gateway,
  GatewayRefused,
  Memory,
  Sandbox,
  SuperAgent,
  assertNoReasoning,
  contains,
  deliveryRefusal,
  operator,
  planProblems,
  template,
  type Participant,
  type Stage,
} from "../src/super/index.js";

/**
 * The SuperAgent adds four things a run does not have — memory, a mailbox, a sandbox and stages
 * that last an hour — and three of them are ways a sibling's output could reach a branch. Most of
 * this file is about that, because the rest of the machinery failing is obvious and this failing
 * is not.
 */

function box(): string {
  return mkdtempSync(join(tmpdir(), "adhd-super-"));
}

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

function finish(sa: SuperAgent, id: string, stage: string, worker: string, body: string, tokens = 100) {
  const c = sa.claim(id, worker);
  assert.ok(c, "expected a claimable stage");
  assert.equal(c.id, stage);
  writeFileSync(join(sa.root, "missions", id, c.contract.artifact), body);
  return sa.return_(id, stage, { worker, goal_hash: c.goal_hash, tokens });
}

const researchBody = `## Findings\n${words(200)}\n## Sources\nx\n## What is still unknown\ny\n`;
const deliverableBody = `## What this is\n${words(200)}\n## What it does not cover\nz\n`;

// ---------------------------------------------------------------- the orchestrator never reasons

test("assertNoReasoning catches commitment and ignores subject matter", () => {
  assert.deepEqual(assertNoReasoning("x", "Compare the two timeout strategies against the recorded runs."), []);
  assert.deepEqual(assertNoReasoning("x", "The goal mentions retries, deadlines and the on-call rotation."), []);
  for (const bad of [
    "The best approach is to cap retries at one.",
    "I recommend the shorter deadline.",
    "We should use a fixed backoff.",
    "In conclusion, the second option wins.",
  ]) {
    assert.equal(assertNoReasoning("x", bad).length, 1, bad);
  }
});

test("a brief carrying a candidate answer is a contract failure, not a warning", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    const m = sa.submit({ mission_id: "m", goal: "Pick a timeout.", mission_class: "quick" });
    sa.confirm("m");
    // The orchestrator's own channel into a brief. If this ever silently succeeded, every stage
    // downstream would reason from a premise nobody scored.
    sa.memory.write({
      scope: "m",
      kind: "note",
      text: "The best approach is a two second deadline.",
      tags: [],
      provenance: { mission_id: "m", stage_id: "seed", stage_kind: "note", run_id: null, label: null },
    });
    assert.throws(() => sa.compileBrief(sa.read("m"), m.stages[0]!), (e: unknown) => e instanceof ContractError && /candidate answer/.test((e as Error).message));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the orchestrator cannot smuggle an answer through the gateway either", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    sa.submit({ mission_id: "m", goal: "Pick a timeout.", mission_class: "quick" });
    sa.confirm("m");
    assert.throws(() => sa.notify("m", "research", "We should use the shorter deadline."), ContractError);
    sa.notify("m", "research", "The operator added a constraint: the dependency has no SLO.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ branches never see siblings

test("memory withholds every diverge-written entry from a diverge brief, in any run", () => {
  const root = box();
  try {
    const mem = new Memory(root);
    const prov = (kind: string, run: string | null) => ({ mission_id: "m", stage_id: `s_${kind}_${run}`, stage_kind: kind, run_id: run, label: null });
    mem.write({ scope: "m", kind: "finding", text: "the dependency p99 is 1.8s", tags: [], provenance: prov("research", null) });
    mem.write({ scope: "m", kind: "decision", text: "LEDGER concluded the caller pays", tags: [], provenance: prov("diverge", "run-a") });
    mem.write({ scope: "m", kind: "decision", text: "an older run concluded the same", tags: [], provenance: prov("diverge", "run-b") });

    const forDiverge = mem.forBrief({ stage_kind: "diverge", run_id: "run-a" });
    assert.deepEqual(forDiverge.entries.map((e) => e.provenance.stage_kind), ["research"]);
    assert.equal(forDiverge.withheld.length, 2, "a branch of another run is still a branch");
    assert.match(forDiverge.withheld[0]!.why, /run-a/);
    assert.match(forDiverge.withheld[1]!.why, /anchor/);

    // A synthesis stage reading the branches is the entire point of a synthesis.
    const forCreate = mem.forBrief({ stage_kind: "create", run_id: "run-a" });
    assert.equal(forCreate.entries.length, 3);
    assert.equal(forCreate.withheld.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a diverge brief states how much was withheld and never what it was", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    sa.submit({ mission_id: "m", goal: "Choose a retry policy.", mission_class: "standard" });
    sa.confirm("m");
    const secret = "MINIMALIST said cap retries at zero";
    sa.memory.write({
      scope: "m",
      kind: "decision",
      text: secret,
      tags: [],
      provenance: { mission_id: "m", stage_id: "b1", stage_kind: "diverge", run_id: null, label: "MINIMALIST" },
    });
    const decide = sa.read("m").stages.find((s) => s.kind === "diverge")!;
    const brief = sa.compileBrief(sa.read("m"), decide);
    assert.ok(!brief.includes(secret), "a sibling's conclusion reached a diverge brief");
    assert.ok(!brief.includes("MINIMALIST"), "a sibling's label is a claim about what it thought mattered");
    assert.match(brief, /1 memory entr\(ies\) were withheld/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the gateway refuses diverge to diverge in both directions and records it", () => {
  const a: Participant = { id: "b1", kind: "diverge", run_id: "r" };
  const b: Participant = { id: "b2", kind: "diverge", run_id: "r" };
  const res: Participant = { id: "research", kind: "research", run_id: null };

  assert.match(deliveryRefusal(a, b)!, /branches never see siblings/);
  // Direction does not matter: a question leaks what the asker thinks matters.
  assert.match(deliveryRefusal(b, a)!, /branches never see siblings/);
  assert.equal(deliveryRefusal(res, a), null, "a research finding is not a sibling conclusion");
  assert.equal(deliveryRefusal(operator(), a), null, "the operator must be able to redirect a branch");
  assert.match(deliveryRefusal(a, a)!, /itself/);

  const root = box();
  try {
    const g = new Gateway(root);
    assert.throws(() => g.send("m", a, b, "question", "what did you conclude?"), GatewayRefused);
    assert.equal(g.refusals("m").length, 1, "a refusal that is not recorded is a refusal nobody can audit");
    assert.equal(g.thread("m").length, 0, "the refused message was stored anyway");
    g.send("m", operator(), a, "redirect", "the constraint changed");
    assert.equal(g.inbox("m", "b1").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------- the sandbox

test("containment is resolved and separator-terminated", () => {
  assert.ok(contains("/tmp/sandbox", "/tmp/sandbox/src/a.ts"));
  assert.ok(contains("/tmp/sandbox", "/tmp/sandbox"));
  // The check standing between a stage's write and the rest of the disk. A raw prefix comparison
  // says this is inside, and it is not.
  assert.ok(!contains("/tmp/sandbox", "/tmp/sandbox-2/src/a.ts"));
  assert.ok(!contains("/tmp/sandbox", "/tmp/sandbox/../elsewhere"));
});

test("a sandbox diffs by content and promotes nothing outside the writable paths", () => {
  const home = box();
  try {
    const source = join(home, "src-tree");
    mkdirSync(join(source, "src"), { recursive: true });
    mkdirSync(join(source, "secrets"), { recursive: true });
    writeFileSync(join(source, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(source, "secrets", "key"), "original\n");

    const { sandbox } = Sandbox.create(join(home, "box"), source, { writable: ["src"], network: false, commands: ["echo hi"] });
    assert.equal(sandbox.diff().length, 0, "a fresh copy differs from its source");

    writeFileSync(join(sandbox.root, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(join(sandbox.root, "src", "b.ts"), "export const b = 3;\n");
    const changes = sandbox.diff();
    assert.deepEqual(changes.map((c) => `${c.change} ${c.path}`).sort(), ["added src/b.ts", "modified src/a.ts"]);

    const ok = sandbox.promote({ dryRun: true });
    assert.equal(ok.refused.length, 0);
    assert.equal(readFileSync(join(source, "src", "a.ts"), "utf8"), "export const a = 1;\n", "a dry run moved a file");

    writeFileSync(join(sandbox.root, "secrets", "key"), "tampered\n");
    const refused = sandbox.promote();
    assert.equal(refused.promoted.length, 0, "a refused promote moved something");
    assert.match(refused.refused.join(" "), /secrets\/key is not under any of the writable paths/);
    assert.equal(readFileSync(join(source, "secrets", "key"), "utf8"), "original\n");

    // All-or-nothing: the legal changes did not land either, because a partial promote leaves a
    // tree that matches neither the sandbox nor the source.
    assert.equal(readFileSync(join(source, "src", "a.ts"), "utf8"), "export const a = 1;\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the command allowlist matches the whole string, not a prefix", () => {
  const home = box();
  try {
    const source = join(home, "src-tree");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "x"), "1\n");
    const { sandbox } = Sandbox.create(join(home, "box"), source, { writable: [], network: false, commands: ["echo ok"] });

    assert.equal(sandbox.run("echo ok").code, 0);
    // Prefix matching on `echo ok` would let this through, and a verify stage runs what it is told.
    assert.throws(() => sandbox.run("echo ok && echo sneaky"), ContractError);
    assert.throws(() => sandbox.run("rm -rf /"), ContractError);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a sandbox refuses to be created inside its own source", () => {
  const home = box();
  try {
    const source = join(home, "tree");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "x"), "1\n");
    assert.throws(() => Sandbox.create(join(source, "inner"), source, { writable: [], network: false, commands: [] }), /would recurse/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------ the stage graph

test("every shipped template is acyclic and every dependency exists", () => {
  for (const cls of ["quick", "standard", "deep"] as const) {
    const stages = template(cls).map((t) => ({ ...t, status: "blocked" }) as unknown as Stage);
    assert.deepEqual(planProblems(stages), [], cls);
    assert.ok(stages.some((s) => s.after.length === 0), `${cls} has no stage that can start`);
  }
  assert.ok(template("deep").length > template("standard").length);
  assert.ok(template("standard").length > template("quick").length);
  assert.ok(template("standard").some((s) => s.kind === "diverge"), "a standard mission makes no isolated decision");
});

test("a cycle is reported as the cycle, not as a mission that is merely waiting", () => {
  const s = (id: string, after: string[]) =>
    ({ id, kind: "research", label: id, after, contract: { artifact: `${id}.md`, requires: [], command: null, min_words: 0 }, status: "blocked" }) as unknown as Stage;
  const problems = planProblems([s("a", ["c"]), s("b", ["a"]), s("c", ["b"])]);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /cycle and can never start: a, b, c/);
  assert.match(planProblems([s("a", ["nope"])]).join(" "), /waits on nope, which is not in the plan/);
});

// ------------------------------------------------------------------------------- the mission run

test("nothing is claimable before confirm, which is D5 one level up", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    const m = sa.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "deep" });
    assert.equal(m.state, "awaiting_confirm");
    assert.equal(sa.claim("m", "w"), null, "a deep mission started spending before anyone said go");
    sa.confirm("m");
    assert.ok(sa.claim("m", "w"), "confirm did not release the first stage");
    assert.throws(() => sa.confirm("m"), ContractError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stage advances only when its artifact meets a contract written before it ran", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    sa.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "quick" });
    sa.confirm("m");
    const c = sa.claim("m", "w")!;
    writeFileSync(join(root, "missions", "m", "research.md"), "## Findings\ntoo short\n");
    const after = sa.return_("m", "research", { worker: "w", goal_hash: c.goal_hash });
    const s = after.stages[0]!;
    assert.equal(s.status, "pending", "a stage that failed its contract was accepted");
    assert.match(s.note!, /missing "## Sources"/);
    assert.match(s.note!, /words, contract says at least 120/);
    assert.equal(after.spent_tokens, 0, "a rejected stage still charged the budget");

    finish(sa, "m", "research", "w", researchBody, 1_000);
    const done = finish(sa, "m", "create", "w", deliverableBody, 2_000);
    assert.equal(done.state, "done");
    assert.equal(done.spent_tokens, 3_000);
    assert.equal(sa.claim("m", "w"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stage returned against a different goal aborts the mission-level hash check", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    sa.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "quick" });
    sa.confirm("m");
    sa.claim("m", "w");
    writeFileSync(join(root, "missions", "m", "research.md"), researchBody);
    assert.throws(
      () => sa.return_("m", "research", { worker: "w", goal_hash: "sha256:paraphrased" }),
      (e: unknown) => e instanceof RunAbort && (e as RunAbort).code === "GOAL_HASH_MISMATCH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only the worker holding the lease may return the stage", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    sa.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "quick" });
    sa.confirm("m");
    const c = sa.claim("m", "w1")!;
    writeFileSync(join(root, "missions", "m", "research.md"), researchBody);
    assert.throws(() => sa.return_("m", "research", { worker: "w2", goal_hash: c.goal_hash }), /leased to w1/);
    assert.equal(sa.claim("m", "w2"), null, "a leased stage was handed to a second worker");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an expired lease returns the stage, and the class's attempt count is the end of it", () => {
  const root = box();
  let clock = Date.parse("2026-01-01T00:00:00Z");
  try {
    const sa = new SuperAgent({ root, now: () => new Date(clock) });
    sa.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "quick" });
    sa.confirm("m");
    const attempts = CLASS_POLICY.quick.maxAttempts;
    for (let i = 0; i < attempts; i++) {
      assert.ok(sa.claim("m", `w${i}`), `attempt ${i + 1} was not handed out`);
      clock += (CLASS_POLICY.quick.leaseSeconds + 1) * 1000;
    }
    assert.equal(sa.claim("m", "late"), null, "a stage was handed out past its attempt ceiling");
    const st = sa.status("m");
    assert.equal(st.mission.stages[0]!.status, "dead");
    assert.equal(st.mission.state, "blocked");
    assert.match(st.mission.reason!, /dead stage\(s\): research/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an exhausted budget blocks the mission instead of quietly continuing", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    sa.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "quick", budget_tokens: 500 });
    sa.confirm("m");
    finish(sa, "m", "research", "w", researchBody, 900);
    assert.equal(sa.claim("m", "w"), null, "the mission kept spending past its ceiling");
    const st = sa.status("m");
    assert.equal(st.mission.state, "blocked");
    assert.match(st.mission.reason!, /budget exhausted: 900 >= 500/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a mission survives the process that started it", () => {
  const root = box();
  try {
    const first = new SuperAgent({ root });
    first.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "quick" });
    first.confirm("m");
    finish(first, "m", "research", "w", researchBody, 100);

    // A mission that takes an hour will outlive its process, so the record is the truth.
    const second = new SuperAgent({ root });
    const st = second.status("m");
    assert.deepEqual(st.ready, ["create"]);
    assert.equal(st.mission.stages[0]!.status, "done");
    assert.ok(existsSync(join(root, "missions", "m", "journal.jsonl")));
    assert.equal(second.memory.query({ scope: "m" }).length, 1, "the finished stage recorded nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cancel drops outstanding stages rather than leaving them claimable", () => {
  const root = box();
  try {
    const sa = new SuperAgent({ root });
    sa.submit({ mission_id: "m", goal: "Do a thing.", mission_class: "standard" });
    sa.confirm("m");
    sa.claim("m", "w");
    const m = sa.cancel("m", "the constraint changed");
    assert.equal(m.state, "cancelled");
    assert.ok(m.stages.every((s) => s.status === "dropped"));
    assert.equal(sa.claim("m", "w"), null);
    assert.throws(() => sa.cancel("m"), ContractError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
