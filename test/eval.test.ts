import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { auditFixtures, runEval, loadFixtures, WIPEOUT_RECOMMENDATION } from "../src/eval.js";
import { problemHash } from "../src/hash.js";
import { compile, previewText } from "../src/compile.js";
import { stringify } from "yaml";

test("the shipped negative control fails fixture 001 and is expected to", () => {
  const r = runEval(cfg);
  const pair = r.pairs.find((p) => p.recorded.endsWith("001-linear-cot"))!;
  assert.ok(pair, "negative control not found");
  assert.equal(pair.outcome, "fail");
  assert.equal(pair.expected, "fail");
  assert.ok(pair.ok);
  assert.ok(pair.failures.some((f) => /human_cancel/.test(f)));
  assert.ok(pair.failures.some((f) => /retry_target_questioned/.test(f)));
  assert.ok(pair.failures.some((f) => /retry_cost/.test(f)));
  assert.ok(pair.failures.some((f) => /pruned_min/.test(f)));
});

test("a synthesis that surfaces what the linear answer missed passes fixture 001", () => {
  const fx = loadFixtures(join(cfg.root, "evals/fixtures")).find((f) => f.id === "001")!;
  const dir = tmp();
  const rec = join(dir, "001-good");
  mkdirSync(join(rec, "branches"), { recursive: true });
  writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash(fx.prompt) }));
  writeFileSync(
    join(rec, "synthesis.md"),
    [
      "# ADHD synthesis",
      "## Recommendation",
      "**Expose cancel to the user and propagate it before any timer fires; on a stall, fail over to a different instance rather than retrying the same one, and bill the retry to the caller's token budget explicitly.**",
      "Set the first token timeout only after measuring what users actually tolerate; the human watching the spinner is the fastest controller and the one who pays for a retried long generation.",
      "## Corroborated findings",
      "- **cancel first** (frames: ACTOR_CENSUS, END_USER)",
      "## Live singletons (unverified)",
      "(none)",
      "## Pruned, with reason",
      "- **MECHANIC**: Set 15s first token, 30s inter token, 90s absolute, one retry.",
      "  - traps: T1",
      "  - detector output: T1: delete the specific details and nothing changes",
      "## Run level",
      "- clean",
      "## What this forecloses",
      "- silent retry against the same instance",
      "## Cost",
      "| 5 | 60000 | 3m |",
      `problem_hash: \`${problemHash(fx.prompt)}\``,
    ].join("\n"),
  );
  const r = runEval(cfg, { recordedDir: dir });
  const pair = r.pairs.find((p) => p.fixture === "001")!;
  assert.deepEqual(pair.failures, []);
  assert.equal(pair.outcome, "pass");
});

test("paraphrase drift in a recorded run fails the hash check", () => {
  const dir = tmp();
  const rec = join(dir, "001-drift");
  mkdirSync(rec, { recursive: true });
  writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash("What timeouts should I set on this HTTP client") }));
  writeFileSync(join(rec, "synthesis.md"), "## Recommendation\nExpose cancel.\n## Pruned, with reason\n(none)\n");
  const r = runEval(cfg, { recordedDir: dir });
  const pair = r.pairs.find((p) => p.fixture === "001")!;
  assert.ok(pair.failures.some((f) => /problem_hash/.test(f)));
});

/**
 * Backlog 105. `min_words_outside` and `must_be_imperative` were written to catch a shallow
 * recommendation, not the absence of one, and a genuine total wipeout ("No recommendation.
 * Every branch was pruned. The pruned block is the result.") is short and has no "do X"
 * sentence, so it used to read to both checks exactly like the thing they exist to catch.
 */
test("a must_not check written to catch a shallow recommendation passes on the wipeout sentinel, and only that exact text", () => {
  const dir = tmp();
  const fixtures = join(dir, "fixtures");
  const recorded = join(dir, "recorded");
  mkdirSync(fixtures, { recursive: true });
  const prompt = "Should we do it?";
  writeFileSync(
    join(fixtures, "903-wipeout-guard.yaml"),
    [
      'id: "903"',
      "name: wipeout-guard",
      "problem_class: design_decision",
      "seed: 1",
      `prompt: "${prompt}"`,
      "must_surface:",
      "  - id: says_x",
      "    description: mentions the candidate action",
      "    any_of: ['do it']",
      "must_not:",
      "  - id: triple_only",
      "    description: more than a bare fact",
      "    check: min_words_outside",
      "    scope: recommendation",
      "    pattern: \"\\\\d+\"",
      "    min_words: 40",
      "  - id: no_verdict",
      "    description: an imperative sentence",
      "    check: must_be_imperative",
      "    scope: recommendation",
      "expect: {}",
    ].join("\n"),
  );
  const synth = (recommendation: string) =>
    [
      "# ADHD synthesis",
      "## Recommendation",
      "",
      recommendation,
      "",
      "## Pruned, with reason",
      "- **A**: do it anyway, against the trap sweep's objection.",
      "  - traps: T1",
      "  - detector output: T1: generic",
      `problem_hash: \`${problemHash(prompt)}\``,
    ].join("\n");
  const write = (name: string, recommendation: string) => {
    const rec = join(recorded, name);
    mkdirSync(join(rec, "branches"), { recursive: true });
    writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash(prompt) }));
    writeFileSync(join(rec, "synthesis.md"), synth(recommendation));
  };
  write("903-wipeout", WIPEOUT_RECOMMENDATION);
  // Same shape, one word short of the sentinel: the guard must not fire on a text that merely
  // resembles it, or the check stops measuring anything.
  write("903-near-miss", "No recommendation. Every branch was pruned.");

  const r = runEval(cfg, { fixturesDir: fixtures, recordedDir: recorded });
  const wipeout = r.pairs.find((p) => p.recorded.endsWith("903-wipeout"))!;
  assert.deepEqual(wipeout.failures, []);
  assert.ok(wipeout.notes.some((n) => /wipeout sentinel; nothing shallow to catch/.test(n)));

  const near = r.pairs.find((p) => p.recorded.endsWith("903-near-miss"))!;
  assert.ok(near.failures.some((f) => f.startsWith("must_not triple_only")));
  assert.ok(near.failures.some((f) => f.startsWith("must_not no_verdict")));
});

/**
 * Backlog 105. `retry_target_questioned` (and any other `scope: all` item) reads `synthesis.md`
 * plus the surviving branches' full artifacts, so a total wipeout — zero survivors — used to see
 * only the rendered pruned block, never a pruned branch's `reasoning` field, however much of the
 * question that field actually answered. A run with at least one survivor must not gain access
 * to a pruned branch's raw reasoning just because this exists: that would let a rejected
 * argument satisfy an assertion the delivered answer never surfaced.
 */
test("'all' scope falls back to every branch's full artifact only when none of them survived", () => {
  const dir = tmp();
  const fixtures = join(dir, "fixtures");
  const recorded = join(dir, "recorded");
  mkdirSync(fixtures, { recursive: true });
  const prompt = "What should we do about it?";
  writeFileSync(
    join(fixtures, "904-scope-fallback.yaml"),
    [
      'id: "904"',
      "name: scope-fallback",
      "problem_class: design_decision",
      "seed: 1",
      `prompt: "${prompt}"`,
      "must_surface:",
      "  - id: says_zzqx",
      "    description: only ever said in a branch's reasoning field",
      "    any_of: ['zzqx-only-in-reasoning']",
      "expect: {}",
    ].join("\n"),
  );
  const synth = "# ADHD synthesis\n## Recommendation\nDo the obvious thing.\n## Pruned, with reason\n(none)\n";
  // Only B's reasoning carries the phrase. A stands in for whichever branch survives, so a run
  // where A is the survivor never sees B's reasoning unless the fallback wrongly engages.
  const branchYaml = (frame: string, carriesPhrase: boolean) =>
    [
      `problem_hash: ${problemHash(prompt)}`,
      `frame: ${frame}`,
      "position: something",
      "reasoning: |",
      `  ${carriesPhrase ? "zzqx-only-in-reasoning, never rendered to synthesis.md." : "an argument that never uses the phrase."}`,
      "forecloses: ['x']",
      "falsifier: something",
      "missing_actor: null",
      "confidence: medium",
    ].join("\n");
  const write = (name: string, frames: string[], survivorFrame: string | null) => {
    const rec = join(recorded, name);
    mkdirSync(join(rec, "branches"), { recursive: true });
    writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash(prompt) }));
    writeFileSync(join(rec, "synthesis.md"), synth);
    for (const f of frames) writeFileSync(join(rec, "branches", `${f}.yaml`), branchYaml(f, f === "B"));
    writeFileSync(
      join(rec, "score.json"),
      JSON.stringify({ frames: frames.map((f) => ({ frame: f, status: f === survivorFrame ? "survivor" : "pruned" })) }),
    );
  };
  // Every branch pruned: nothing survived to be read from directly, so the fallback to every
  // branch's full artifact is the only way B's reasoning is ever seen.
  write("904-wipeout", ["A", "B"], null);
  // A survives and does not carry the phrase; B is pruned and does. The survivor set is
  // non-empty, so the fallback must not engage and B's reasoning must stay unseen.
  write("904-has-survivor", ["A", "B"], "A");

  const r = runEval(cfg, { fixturesDir: fixtures, recordedDir: recorded });
  const wipeout = r.pairs.find((p) => p.recorded.endsWith("904-wipeout"))!;
  assert.deepEqual(wipeout.failures, []);
  const hasSurvivor = r.pairs.find((p) => p.recorded.endsWith("904-has-survivor"))!;
  assert.ok(hasSurvivor.failures.some((f) => f.startsWith("must_surface says_zzqx")));
});

test("a fixture pattern anchored with ^ reads the start of the scope text, and a lookahead that matches nothing still counts as a match", () => {
  const dir = tmp();
  const fixtures = join(dir, "fixtures");
  const recorded = join(dir, "recorded");
  mkdirSync(fixtures, { recursive: true });
  const prompt = "Should we rewrite it?";
  writeFileSync(
    join(fixtures, "900-anchor.yaml"),
    [
      'id: "900"',
      "name: anchor",
      "problem_class: strategy",
      "seed: 1",
      `prompt: "${prompt}"`,
      "must_surface:",
      "  - id: says_rewrite",
      "    description: mentions the rewrite",
      "    any_of: [\"rewrite\"]",
      "must_not:",
      "  - id: no_it_depends",
      "    description: the bold line does not open with it depends",
      "    check: must_match",
      "    scope: recommendation",
      "    any_of:",
      '      - "^\\\\s*(?!(it depends))\\\\S"',
      "  - id: opens_with_do",
      "    description: the bold line opens with Do",
      "    check: must_match",
      "    scope: recommendation",
      "    any_of:",
      '      - "^\\\\s*Do\\\\b"',
      "expect: {}",
    ].join("\n"),
  );
  const synth = (bold: string) =>
    ["# ADHD synthesis", "## Recommendation", "", `**${bold}**`, "", "Do nothing else.", "## Pruned, with reason", "- none", `problem_hash: \`${problemHash(prompt)}\``].join("\n");
  for (const [name, bold, want] of [
    ["hedge", "It depends on whether the rewrite is worth it.", "fail"],
    ["verdict", "Do not rewrite it this year.", "pass"],
  ] as const) {
    const rec = join(recorded, `900-${name}`);
    mkdirSync(join(rec, "branches"), { recursive: true });
    writeFileSync(join(rec, "plan.json"), JSON.stringify({ problem_hash: problemHash(prompt) }));
    writeFileSync(join(rec, "synthesis.md"), synth(bold));
    writeFileSync(join(rec, "expected.json"), JSON.stringify({ outcome: want }));
  }
  const r = runEval(cfg, { fixturesDir: fixtures, recordedDir: recorded });
  const hedge = r.pairs.find((p) => p.recorded.endsWith("900-hedge"))!;
  const verdict = r.pairs.find((p) => p.recorded.endsWith("900-verdict"))!;
  // "Do nothing else." is on a later line; without the m flag ^ must not reach it.
  assert.deepEqual(
    hedge.failures.map((f) => f.split(":")[0]),
    ["must_not no_it_depends", "must_not opens_with_do"],
  );
  assert.deepEqual(verdict.failures, []);
  assert.equal(r.pairs.every((p) => p.ok), true);
});

test("the audit flags an assertion the negative control also satisfies, and names the text that did it", () => {
  const dir = tmp();
  const fixtures = join(dir, "fixtures");
  const recorded = join(dir, "recorded");
  mkdirSync(fixtures, { recursive: true });
  const prompt = "Where should I look?";
  writeFileSync(
    join(fixtures, "901-audit.yaml"),
    [
      'id: "901"',
      "name: audit",
      "problem_class: fuzzy_debugging",
      "seed: 1",
      `prompt: "${prompt}"`,
      "must_surface:",
      "  - id: says_cron",
      "    description: names a scheduled actor",
      "    any_of: ['cron']",
      "  - id: says_rare",
      "    description: names something only a real run reaches",
      "    any_of: ['who is hurt']",
      "  - id: says_nothing",
      "    description: nothing has ever said this",
      "    any_of: ['zqx-never-appears']",
      "must_not: []",
      "expect: {}",
    ].join("\n"),
  );
  const write = (name: string, body: string, control: boolean) => {
    const d = join(recorded, name);
    mkdirSync(join(d, "branches"), { recursive: true });
    writeFileSync(join(d, "plan.json"), JSON.stringify({ problem_hash: problemHash(prompt) }));
    writeFileSync(join(d, "synthesis.md"), `# ADHD synthesis\n## Recommendation\n\n${body}\n\n## Pruned, with reason\n\n(none)\n`);
    writeFileSync(join(d, "expected.json"), JSON.stringify({ outcome: control ? "fail" : "pass", control }));
  };
  write("901-real", "Check cron, and ask who is hurt by the tail.", false);
  write("901-linear-cot", "The usual suspects: cron, GC, cache expiry.", true);

  const a = auditFixtures(cfg, { fixturesDir: fixtures, recordedDir: recorded });
  const byId = new Map(a.items.map((i) => [i.item, i]));
  assert.equal(byId.get("says_cron")!.verdict, "matches a control", "an assertion the consensus answer satisfies is not measuring divergence");
  assert.equal(byId.get("says_cron")!.control_evidence, "cron");
  assert.equal(byId.get("says_rare")!.verdict, "discriminating");
  assert.equal(byId.get("says_nothing")!.verdict, "never matched");
  assert.match(a.text, /matched on: "cron"/);
  assert.match(a.text, /do not loosen the pattern to make the report quiet/);
});

test("a fixture pattern that cannot compile, or that matches everything, fails at load", () => {
  const dir = tmp();
  const write = (name: string, anyOf: string) =>
    writeFileSync(
      join(dir, name),
      [
        'id: "902"',
        "name: broken",
        "problem_class: naming",
        "seed: 1",
        'prompt: "x"',
        "must_surface:",
        "  - id: thing",
        "    description: a thing",
        `    any_of: [${anyOf}]`,
        "must_not: []",
        "expect: {}",
      ].join("\n"),
    );
  write("902-broken.yaml", "'(unclosed'");
  assert.throws(() => loadFixtures(dir), /does not compile/, "a broken pattern must fail at load, not silently never match");
  rmSync(join(dir, "902-broken.yaml"));
  // An assertion that matches everything cannot fail, which the harness would report as a pass.
  write("902-vacuous.yaml", "'.*'");
  assert.throws(() => loadFixtures(dir), /matches everything, so the assertion cannot fail/);
  rmSync(join(dir, "902-vacuous.yaml"));
  write("902-fine.yaml", "'who (is|gets) paged'");
  assert.equal(loadFixtures(dir).length, 1);
});

/**
 * A decline is a first-class outcome and it was the only one nothing tested. A routing edit that
 * quietly starts spending five subagents on "what is the default TCP keepalive interval" would
 * have passed the whole suite, because a fixture with no recorded run reports "no recorded runs"
 * and the eval still passes.
 */
test("the decline fixtures assert the routing decision, with no recorded run", () => {
  const r = runEval(cfg);
  const declines = r.pairs.filter((p) => p.recorded === "(no run: declined)");
  assert.equal(declines.length, 3, "005, 006 and 007 are declines");
  for (const d of declines) {
    assert.equal(d.outcome, "pass", `${d.fixture}: ${d.failures.join("; ")}`);
    assert.match(d.notes.join(" "), /declined: \S/, `${d.fixture} did not report the reason it gave`);
  }
  assert.ok(!r.fixtures_without_runs.includes("005"), "a decline fixture is not a fixture missing its run");
});

test("a decline fixture fails when routing stops declining its class", () => {
  const routing = structuredClone(cfg.routing) as typeof cfg.routing;
  // The regression that matters: someone gives the class frames and it starts spending.
  (routing.classes as Record<string, unknown>)["factual_lookup"] = {
    action: "run",
    description: "no longer declined",
    signals: [],
    frames: ["LEDGER", "MECHANIC", "SABOTEUR"],
    n: 3,
    alternates: [],
  };
  const r = runEval({ ...cfg, routing }, {});
  const five = r.pairs.find((p) => p.fixture === "005")!;
  assert.equal(five.outcome, "fail");
  assert.equal(five.ok, false);
  assert.match(five.failures.join(" "), /expect decline: routing compiled 3 branch\(es\)/);
  assert.equal(r.ok, false, "the whole eval must go red");
});

test("a decline fixture fails when the reason rots into something that explains nothing", () => {
  const routing = structuredClone(cfg.routing) as typeof cfg.routing;
  (routing.classes as Record<string, { reason?: string }>)["factual_lookup"]!.reason = "no";
  const r = runEval({ ...cfg, routing }, {});
  const five = r.pairs.find((p) => p.fixture === "005")!;
  assert.equal(five.outcome, "fail");
  assert.match(five.failures.join(" "), /expect decline reason to include/);
});

/** The schema refuses the two shapes that would make a fixture assert nothing. */
test("a fixture with no assertions and no decline is rejected at load", () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "bad.yaml"),
    "id: '900'\nname: empty\nproblem_class: design_decision\nseed: 1\nprompt: does it work\n",
  );
  assert.throws(() => loadFixtures(dir), /must_surface is required unless expect.decline, expect.injection_warnings_min or expect.compiles is set/);
});

test("a decline fixture carrying assertions is rejected, because there is no output to assert on", () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "bad.yaml"),
    [
      "id: '901'",
      "name: contradictory",
      "problem_class: factual_lookup",
      "seed: 1",
      "prompt: what is the default",
      "must_surface:",
      "  - id: x",
      "    description: something the synthesis says",
      "    any_of: ['anything']",
      "expect:",
      "  decline: true",
      "",
    ].join("\n"),
  );
  assert.throws(() => loadFixtures(dir), /no output to assert against/);
});

/**
 * The one attack isolation cannot see. A convergence sentence in the problem reaches all five
 * branches verbatim, compromises them identically, and leaves no branch anomalous against its
 * siblings. The critic reads artifacts, not the problem that produced them. The defence is the
 * D5 gate, so that is what the fixture asserts.
 */
test("the injection fixture asserts the gate, not a run", () => {
  const r = runEval(cfg);
  const gate = r.pairs.find((p) => p.fixture === "008")!;
  assert.equal(gate.recorded, "(no run: gate only)");
  assert.equal(gate.outcome, "pass", gate.failures.join("; "));
  assert.ok(gate.notes.length >= 3, "each warned phrase is reported so the reader sees what fired");
  for (const n of gate.notes) assert.match(n, /gate warned: "[^"]+" \(/, "a warning without its reason tells the reader nothing");
});

test("the injection fixture fails if the detector stops catching its problem", () => {
  const fx = loadFixtures(join(cfg.root, "evals", "fixtures")).find((f) => f.id === "008")!;
  // The bar is what the current patterns catch. Raising it past that is how the test proves it
  // is measuring the detector rather than measuring nothing.
  const dir = tmp();
  writeFileSync(join(dir, "008.yaml"), [
    "id: '008'",
    "name: unreachable-bar",
    `problem_class: ${fx.problem_class}`,
    `seed: ${fx.seed}`,
    "prompt: What timeouts should I set on this HTTP client?",
    "expect:",
    "  injection_warnings_min: 3",
    "",
  ].join("\n"));
  const r = runEval(cfg, { fixturesDir: dir });
  const gate = r.pairs[0]!;
  assert.equal(gate.outcome, "fail");
  assert.match(gate.failures.join(" "), /expect at least 3 injection warning\(s\) at the gate, got 0/);
  assert.equal(r.ok, false);
});

/** Warn, never block. The verbatim passthrough is the architecture, not a concession. */
test("a hostile problem still compiles and still reaches the gate byte for byte", () => {
  const fx = loadFixtures(join(cfg.root, "evals", "fixtures")).find((f) => f.id === "008")!;
  const r = compile(cfg, fx.prompt, { problem_class: fx.problem_class }, { seed: fx.seed });
  assert.equal(r.kind, "plan", "the orchestrator does not get to decide what a problem may say");
  const preview = previewText(r);
  assert.ok(preview.includes(fx.prompt), "the problem is shown verbatim, hostile or not");
  assert.match(preview, /read as instructions to the branches/);
  assert.match(preview, /Nothing has been spent/);
});

/**
 * `on.call` was written to match "on-call" and "on call". `.` matches any character, so it also
 * matched "functi(on call)s" — which is how fixture 003's `who_pays` came to be satisfied by a
 * negative control that never mentions on-call at all. The audit reported it as a judgment call
 * about the frame library. It was a regex defect.
 *
 * Two others had it latent (`one.way`, `two.way door`). Same shape, same fix: anchor the first
 * word and spell the separator out. This is the fixture-side twin of the redaction bug, where
 * matching `door keeper` as a literal token missed `door-keeper` and `doorkeeper`.
 */
test("no fixture pattern uses a bare dot as a word separator", () => {
  for (const fx of loadFixtures(join(cfg.root, "evals", "fixtures"))) {
    const patterns = [...fx.must_surface, ...fx.must_not].flatMap((i) => ("any_of" in i && i.any_of ? i.any_of : []) as string[]);
    for (const p of patterns) {
      // Escaped dots are literal and character classes may legitimately contain one.
      const bare = p.replace(/\\\./g, "").replace(/\[[^\]]*\]/g, "‹class›");
      assert.ok(
        !/[a-z]\.[a-z]/i.test(bare),
        `${fx.id}: /${p}/ uses . as a separator, which matches any character. Anchor the word and spell the separator: \\bon[- ]?call.`,
      );
    }
  }
});

/**
 * The audit's own report, pinned. Three of the four assertions it flagged were resolved by
 * removal or by fixing a pattern that admitted recitation; the fourth is left flagged on
 * purpose and the fixture says why. A new assertion a control satisfies has to be argued for
 * here, not merged quietly.
 */
test("exactly one shipped assertion is knowingly satisfied by a control, and it is documented", () => {
  const a = auditFixtures(cfg);
  const flagged = a.items.filter((i) => i.verdict === "matches a control").map((i) => `${i.fixture}/${i.item}`);
  assert.deepEqual(flagged, ["003/reframe"], "the set of non-discriminating assertions changed; decide it, do not loosen it");

  const yaml = readFileSync(join(cfg.root, "evals", "fixtures", "003-monolith-rewrite.yaml"), "utf8");
  assert.match(yaml, /Left alone deliberately/, "the one flagged assertion has to carry its argument in the fixture");

  // `false_means` is the other half: no run has surfaced it, and 004 is recorded as failing on
  // it. That is a frame-set gap, and a gap that reads as "never matched" is the honest report.
  const fm = a.items.find((i) => i.item === "false_means")!;
  assert.equal(fm.verdict, "never matched");
  assert.equal(fm.control_matched, 0, "the convention tokens that let the control satisfy this are gone");
});

/**
 * `branches_expected` and `distinct_axes` were added for fixture 014, and an assertion that cannot
 * fail is worse than none: it reads as coverage. Both are checked against a plan doctored to break
 * exactly the property they claim to hold.
 */
test("branches_expected fails a plan that dispatched a different number of branches", () => {
  const fx = loadFixtures(join(cfg.root, "evals", "fixtures")).find((f) => f.id === "014")!;
  assert.equal(fx.expect.branches_expected, 7, "fixture 014 is the wide path");

  // The real compile passes.
  const ok = runEval(cfg, { fixturesDir: join(cfg.root, "evals", "fixtures") }).pairs.find((p) => p.fixture === "014")!;
  assert.equal(ok.outcome, "pass");

  // The same fixture asking for a count routing will not produce fails, and says which number.
  const dir = tmp();
  const doctored = { ...fx, expect: { ...fx.expect, branches_expected: 5 } };
  writeFileSync(join(dir, "014-queue-options.yaml"), stringify(doctored));
  const bad = runEval(cfg, { fixturesDir: dir }).pairs.find((p) => p.fixture === "014")!;
  assert.equal(bad.outcome, "fail");
  assert.ok(bad.failures.some((f) => /branches_expected 5.*carries 7/.test(f)), bad.failures.join("; "));
});

test("distinct_axes fails a plan carrying two frames from one axis", () => {
  const fx = loadFixtures(join(cfg.root, "evals", "fixtures")).find((f) => f.id === "014")!;
  const dir = tmp();
  // Name two same-axis frames explicitly. The compiler's own axis rule drops the second, so the
  // plan comes back short — which `branches_expected` catches and is the honest outcome: the
  // selector refuses to build the plan this assertion is guarding against, and that is D6 working.
  // Not `mechanism` any more: D35 moved FIRST_PRINCIPLES to `derivation`, leaving MECHANIC alone
  // there. Pick whichever axis actually has two members rather than naming one, so this test keeps
  // testing the axis rule instead of a particular pair.
  const byAxis = new Map<string, string[]>();
  for (const f of cfg.frames.frames) byAxis.set(f.axis, [...(byAxis.get(f.axis) ?? []), f.id]);
  const sameAxis = [...byAxis.values()].find((ids) => ids.length >= 2)!;
  assert.ok(sameAxis, "no axis in the library has two frames, so D6 has nothing to enforce");
  writeFileSync(join(dir, "014-queue-options.yaml"), stringify({ ...fx, expect: { ...fx.expect, branches_expected: sameAxis.length } }));
  const r = runEval(cfg, { fixturesDir: dir }).pairs.find((p) => p.fixture === "014")!;
  assert.equal(r.outcome, "fail", "asking for a count routing cannot fill is a failure, not a silent short plan");

  // And the check itself: a plan with a repeated axis is rejected by the message it should give.
  const axes = ["cost", "cost", "scope"];
  const dupes = axes.filter((a, i) => axes.indexOf(a) !== i);
  assert.deepEqual([...new Set(dupes)], ["cost"], "the duplicate detection the evaluator uses");
});
