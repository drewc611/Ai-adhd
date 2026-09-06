import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { artifact, cfg } from "./helpers.js";
import { lintBranch, lintRunT6, lintT3, lintT5 } from "../src/lint.js";
import { BranchArtifactSchema } from "../src/schema.js";

const H = "sha256:" + "a".repeat(64);

test("T3 fires on the recorded linear CoT reasoning once its contract fields are filled", () => {
  const raw = parse(readFileSync(join(cfg.root, "evals/recorded/001-linear-cot/branches/linear.yaml"), "utf8"));
  // The recorded artifact violates the contract (empty forecloses, null falsifier). Fill the
  // contract so the lint can be tested in isolation, keep the reasoning text.
  const a = BranchArtifactSchema.parse({ ...raw, frame: "MECHANIC", problem_hash: H, forecloses: ["x y z w"], falsifier: "some observation" });
  const hint = lintT3(a);
  assert.ok(hint, "T3 should fire: the reasoning leans on the SRE book citation");
});

test("T3 does not fire when reasoning stands without the citation", () => {
  const a = artifact("MECHANIC", H, {
    reasoning:
      "The connection is held open while the server thinks, so an idle socket costs a file descriptor and a pool slot on both ends. " +
      "A first token timeout catches a server that never started; an inter token timeout catches one that stalled mid stream. " +
      "Neither helps the human who has already given up, which is why cancel must propagate before any timer fires. " +
      "The SRE book, ch. 22, says something similar but for a different service profile.",
  });
  assert.equal(lintT3(a), null);
});

test("T5 fires on a hedged position without an imperative", () => {
  assert.ok(lintT5(artifact("LEDGER", H, { position: "It depends on whether the caller can tolerate partial output." })));
  assert.equal(lintT5(artifact("LEDGER", H, { position: "Never retry the same instance; fail over or return partial output." })), null);
  assert.equal(lintT5(artifact("LEDGER", H, { position: "Set a 15s first token timeout." })), null);
});

test("T4 fires on trivially short forecloses", () => {
  const hints = lintBranch(artifact("LEDGER", H, { forecloses: ["retries", "long waits"] }));
  assert.ok(hints.some((h) => h.trap === "T4"));
});

test("run level T6 fires only when every branch leaves missing_actor null", () => {
  const a = artifact("LEDGER", H, { missing_actor: null });
  const b = artifact("MECHANIC", H, { missing_actor: null });
  assert.ok(lintRunT6([a, b]));
  assert.equal(lintRunT6([a, artifact("SABOTEUR", H)]), null);
});
