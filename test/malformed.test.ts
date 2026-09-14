import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { artifact, cfg, passA, passB, tmp, yaml } from "./helpers.js";
import { Kernel } from "../src/os.js";

/**
 * A worker that returns malformed YAML on purpose (backlog 37).
 *
 * The claim under test is not that garbage is rejected — anything rejects garbage — but that
 * what the user is handed afterwards is more useful than a silent repair would have been. A
 * repair here would be easy and is the wrong thing: a branch whose artifact will not parse has
 * no position, and inventing one, or quietly scoring four branches while the plan says five,
 * hands the reader a run that looks clean and is not.
 *
 * Four shapes of garbage, because they take four different paths through `validateBranchArtifact`
 * and only one of them is the parse failure the item names:
 *
 *   unparseable      the YAML parser throws                  -> pruned, run continues
 *   valid, no hash   parses, `problem_hash` absent           -> aborts
 *   prose            parses as a scalar, no hash             -> aborts
 *   empty            parses as null, no hash                 -> aborts
 *
 * The asymmetry is real and deliberate on the abort side: a document that carries no hash
 * cannot be shown to have addressed this problem, and D2's isolation is worth nothing if a
 * branch that saw something else can contribute. It is recorded here rather than argued for,
 * because the tests below pin what happens and `docs/BACKLOG.md` carries the open question of
 * whether the parse failure should abort too.
 */

const PROBLEM = "What timeouts should I set on this HTTP client?";

function kernel() {
  const root = join(tmp(), "root");
  const k = new Kernel(cfg, { root, leaseSeconds: 60, now: () => new Date(Date.parse("2026-09-06T00:00:00Z")) });
  return { k, root };
}

function start(k: Kernel) {
  k.submit(PROBLEM, { problem_class: "design_decision" }, { seed: 1, runId: "r1", confirmed: true });
  return k.status("r1").problem_hash;
}

/** Return all five branches, substituting `body` for the third. Returns the frame it replaced. */
function diverge(k: Kernel, hash: string, body: string): string {
  let replaced = "";
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w1")!;
    if (i === 2) {
      replaced = t.label;
      k.return_(t.id, body, "w1");
    } else k.return_(t.id, yaml(artifact(t.label, hash)), "w1");
  }
  return replaced;
}

test("a branch whose YAML will not parse is pruned, and the run continues with four", () => {
  const { k, root } = kernel();
  const hash = start(k);
  const dropped = diverge(k, hash, "position: [unclosed\n  frame: :::\n");

  const st = k.status("r1");
  assert.equal(st.state, "critique_a", "one unparseable branch does not end the run");

  // The scored set is four, and the map says which four. A silent repair would have kept five
  // letters and scored something no branch wrote.
  const blind = JSON.parse(readFileSync(join(root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  assert.equal(Object.keys(blind).length, 4);
  assert.ok(!Object.values(blind).includes(dropped), "the malformed branch is not scored under a letter");

  // And the reason is on disk in machine-readable form, not only in prose.
  const violations = JSON.parse(readFileSync(join(root, "r1", "critic", "violations.json"), "utf8")) as { frame: string; violations: string[] }[];
  assert.deepEqual(violations.map((v) => v.frame), [dropped]);
  assert.match(violations[0]!.violations[0]!, /not valid YAML/);
});

test("the pruned block hands the user the parser's own error, not a summary of it", () => {
  const { k, root } = kernel();
  const hash = start(k);
  const dropped = diverge(k, hash, "position: [unclosed\n  frame: :::\n");

  const blind = JSON.parse(readFileSync(join(root, "r1", "critic", "blind-map.json"), "utf8")) as Record<string, string>;
  const letters = Object.keys(blind);
  const frames = Object.values(blind);
  const ta = k.claim("w1")!;
  k.return_(ta.id, yaml(passA(hash, letters)), "w1");
  const tb = k.claim("w1")!;
  k.return_(tb.id, yaml(passB(hash, [
    { id: "cancel", members: frames.slice(0, 2), action: "Expose cancel first." },
    ...frames.slice(2).map((f) => ({ id: `lone_${f}`, members: [f] })),
  ])), "w1");
  for (let i = 0; i < 10; i++) {
    const td = k.claim("w1");
    if (!td) break;
    k.return_(td.id, yaml({ problem_hash: hash, frame: td.label, verdict: "defend", response: "Users cancel rather than wait.", revised_position: `Do the ${td.label} thing.`, revised_falsifier: null, confidence: "high" }), "w1");
  }
  assert.equal(k.status("r1").state, "done");

  const synth = k.result("r1").synthesis!;
  const pruned = synth.slice(synth.indexOf("## Pruned, with reason"));
  assert.ok(pruned.includes(`**${dropped}**`), "the pruned frame is named");
  assert.match(pruned, /no valid artifact/);
  assert.match(pruned, /contract: not valid YAML/);
  // The parser's line and column reach the user. This is the difference between a report that
  // can be acted on and one that says "a branch failed": the reader can open the artifact and
  // look at that character.
  assert.match(pruned, /line 1, column 12/);
  // And the run still reports what it forecloses, from the four that survived.
  assert.match(synth, /## What this forecloses/);
});

test("an artifact carrying no problem_hash aborts, and says contract failure rather than drift", () => {
  for (const [name, body] of [
    ["prose with no YAML at all", "I think you should set a 30 second timeout. Hope that helps!"],
    ["valid YAML of the wrong shape", "colour: blue\ncount: 7\n"],
    ["nothing at all", ""],
  ] as const) {
    const { k } = kernel();
    const hash = start(k);
    diverge(k, hash, body);
    const st = k.status("r1");
    assert.equal(st.state, "aborted", name);
    assert.match(st.reason!, /HASH_MISMATCH/, name);
    // The accusation has to be the one the evidence supports. An empty artifact did not
    // paraphrase the problem; it never echoed a hash, which is a different failure with a
    // different fix, and sending the reader after a compiler bug wastes the report.
    assert.match(st.reason!, /problem_hash missing/, name);
    assert.match(st.reason!, /not paraphrase drift/, name);
    assert.ok(!/Paraphrase drift\./.test(st.reason!), name);
  }
});

test("a branch that echoes a different hash still reports paraphrase drift", () => {
  const { k } = kernel();
  const hash = start(k);
  // The frame has to be the one the task asked for — the misdirection guard in `return_` rejects
  // an artifact declaring another frame before any of this is reached, which is its job — so the
  // only thing wrong with this artifact is the hash it echoed.
  for (let i = 0; i < 5; i++) {
    const t = k.claim("w1")!;
    k.return_(t.id, yaml(artifact(t.label, i === 2 ? "sha256:" + "0".repeat(64) : hash)), "w1");
  }
  const st = k.status("r1");
  assert.equal(st.state, "aborted");
  assert.match(st.reason!, /Paraphrase drift/, "the specific accusation survives for the case that earns it");
  assert.ok(!/problem_hash missing/.test(st.reason!));
});

test("every branch malformed is an abort, not an empty run that reports nothing pruned", () => {
  const { k } = kernel();
  start(k);
  for (let i = 0; i < 5; i++) k.return_(k.claim("w1")!.id, "position: [unclosed\n", "w1");
  const st = k.status("r1");
  assert.equal(st.state, "aborted");
  assert.match(st.reason!, /ALL_INVALID/);
  assert.match(st.reason!, /Every branch violated the contract/);
});
