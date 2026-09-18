import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { artifact, cfg, tmp, yaml } from "./helpers.js";
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
 * Four shapes of garbage, and since D30 all four abort:
 *
 *   unparseable      the YAML parser throws         -> aborts, UNPARSEABLE
 *   valid, no hash   `problem_hash` absent          -> aborts, HASH_MISMATCH
 *   prose            parses as a scalar, no hash    -> aborts, HASH_MISMATCH
 *   empty            parses as null, no hash        -> aborts, HASH_MISMATCH
 *
 * **These tests used to pin the opposite for the first case, and that is the point of them.**
 * Item 37 found the unparseable artifact being *pruned* while the three that carry no hash abort,
 * and recorded the split as intentional rather than deciding it. Backlog 84 is the argument that it
 * had no defence: a document with no hash aborts because nothing shows it addressed *this* problem,
 * and an unparseable document shows strictly less than that. The lenient case was the one where less
 * is known.
 *
 * It also moved an arithmetic nobody chose to move. `monoculture_fraction` is 0.8, so one cluster of
 * four is a monoculture at n=4 and sits exactly on the threshold at n=5 — pruning a branch silently
 * changed the denominator of a run-level verdict.
 */

const PROBLEM = "What timeouts should I set on this HTTP client?";

function kernel() {
  const root = join(tmp(), "root");
  const k = new Kernel(cfg, { root, leaseSeconds: 60, now: () => new Date(Date.parse("2026-09-06T00:00:00Z")) });
  return { k, root };
}

function start_(k: Kernel) {
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

test("a branch whose YAML will not parse aborts the run, and names the parser's own error", () => {
  const { k } = kernel();
  const hash = start_(k);
  const dropped = diverge(k, hash, "position: [unclosed\n  frame: :::\n");

  const st = k.status("r1");
  assert.equal(st.state, "aborted", "an unparseable artifact no longer costs one branch");
  assert.match(st.reason!, /UNPARSEABLE/);
  assert.match(st.reason!, new RegExp(`branch ${dropped} returned text that is not valid YAML`));
  // The parser's own message still reaches the reader, down to the column. It travels on the abort
  // now rather than in the pruned block, and losing it would be the real regression here.
  assert.match(st.reason!, /line 1, column 12/);
  // And the reason says why this is an abort rather than a prune, because a reader who expected the
  // old behaviour needs the argument and not just the new verdict.
  assert.match(st.reason!, /same reason a missing problem_hash aborts/);
});

test("the abort is distinguishable from a hash mismatch, because the fixes differ", () => {
  // A missing hash means a branch answered without echoing what it was asked; an unparseable
  // artifact means nothing about the problem at all. Same outcome, different thing to go and look
  // at, so the codes stay separate.
  const a = kernel();
  diverge(a.k, start_(a.k), "position: [unclosed\n");
  assert.match(a.k.status("r1").reason!, /UNPARSEABLE/);
  assert.ok(!/HASH_MISMATCH/.test(a.k.status("r1").reason!));

  const b = kernel();
  diverge(b.k, start_(b.k), "colour: blue\ncount: 7\n");
  assert.match(b.k.status("r1").reason!, /HASH_MISMATCH/);
  assert.ok(!/UNPARSEABLE/.test(b.k.status("r1").reason!));
});

test("one malformed branch is enough; the other four are not scored on their own", () => {
  // The old behaviour scored four of five and moved the monoculture denominator with it. Now no
  // partial pack is scored at all, so `blind-map.json` is never written.
  const { k, root } = kernel();
  const hash = start_(k);
  diverge(k, hash, "position: [unclosed\n");
  assert.equal(k.status("r1").state, "aborted");
  assert.ok(!existsSync(join(root, "r1", "critic", "blind-map.json")), "a blind map was written for an aborted run");
  assert.equal(k.claim("w1"), null, "an aborted run still had claimable work");
});

test("an artifact carrying no problem_hash aborts, and says contract failure rather than drift", () => {
  for (const [name, body] of [
    ["prose with no YAML at all", "I think you should set a 30 second timeout. Hope that helps!"],
    ["valid YAML of the wrong shape", "colour: blue\ncount: 7\n"],
    ["nothing at all", ""],
  ] as const) {
    const { k } = kernel();
    const hash = start_(k);
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
  const hash = start_(k);
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

test("every branch malformed aborts on the first one, without waiting for the fifth", () => {
  const { k } = kernel();
  start_(k);
  // The run ends when the phase advances, so the fifth return is what triggers it — but the reason
  // now names one branch rather than reporting that all of them failed. ALL_INVALID is still
  // reachable, from a pack whose artifacts parse and fail the schema, which is a different failure.
  for (let i = 0; i < 5; i++) k.return_(k.claim("w1")!.id, "position: [unclosed\n", "w1");
  const st = k.status("r1");
  assert.equal(st.state, "aborted");
  assert.match(st.reason!, /UNPARSEABLE/);
  assert.ok(!/ALL_INVALID/.test(st.reason!), "the first unparseable artifact should decide it");
});
