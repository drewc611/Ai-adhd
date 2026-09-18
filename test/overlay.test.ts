import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { cfg, tmp } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { applyOverlay, overlayHash } from "../src/overlay.js";
import { compile } from "../src/compile.js";
import { frameHash } from "../src/hash.js";
import { ConfigError } from "../src/errors.js";

/**
 * Backlog 71 / D33. `adhd init` copies the shipped config, which forks it; an overlay keeps the base
 * and carries only the differences. The merge semantics are the decision and they are "a reused id
 * replaces whole", chosen so that the definition which ran is one object from one file — because
 * `frame_hash` and `adhd frames --drift` exist to say which definition ran, and a field-wise merge
 * makes that a function of two files and an order.
 */
function root(overlay?: unknown): string {
  const dir = tmp();
  for (const d of ["config", "prompts", "docs"]) mkdirSync(join(dir, d), { recursive: true });
  cpSync(join(cfg.root, "config"), join(dir, "config"), { recursive: true });
  cpSync(join(cfg.root, "prompts"), join(dir, "prompts"), { recursive: true });
  cpSync(join(cfg.root, "docs", "TRAPS.md"), join(dir, "docs", "TRAPS.md"));
  if (overlay !== undefined) writeFileSync(join(dir, "config", "overlay.yaml"), stringify(overlay));
  return dir;
}

test("no overlay means the shipped library, and Config says so rather than leaving it unknown", () => {
  const c = loadConfig(root());
  assert.equal(c.overlay, null);
  assert.equal(c.frames.frames.length, cfg.frames.frames.length);
});

test("an overlay frame reusing an id replaces the base frame whole", () => {
  const base = cfg.frameById.get("MINIMALIST")!;
  const replacement = { ...base, stance: "Do the largest thing that could possibly work.", probes: ["What is the biggest move available?"] };
  const c = loadConfig(root({ frames: [replacement] }));

  const got = c.frameById.get("MINIMALIST")!;
  assert.equal(got.stance, replacement.stance);
  assert.deepEqual(got.probes, replacement.probes);
  // Whole replacement, not a field-wise merge: the base's probes are gone rather than appended.
  assert.equal(got.probes.length, 1, "the base probes survived, so this merged fields");
  assert.notEqual(frameHash(got), frameHash(base), "the frame_hash did not move, so a redefinition is invisible");
  assert.deepEqual(c.overlay!.replaced_frames, ["MINIMALIST"]);
  assert.deepEqual(c.overlay!.added_frames, []);
  // The library does not grow and does not reshuffle.
  assert.equal(c.frames.frames.length, cfg.frames.frames.length);
  assert.deepEqual(c.frames.frames.map((f) => f.id), cfg.frames.frames.map((f) => f.id));
});

test("an overlay frame with a new id is added after the base ones", () => {
  const base = cfg.frameById.get("LEDGER")!;
  const novel = { ...base, id: "HOUSE_STYLE", name: "House style", axis: "house", stance: "Answer the way this team answers, in the house idiom, with the house caveats attached." };
  const c = loadConfig(root({ frames: [novel] }));
  assert.deepEqual(c.overlay!.added_frames, ["HOUSE_STYLE"]);
  assert.deepEqual(c.overlay!.replaced_frames, []);
  assert.equal(c.frames.frames.length, cfg.frames.frames.length + 1);
  assert.equal(c.frames.frames.at(-1)!.id, "HOUSE_STYLE", "a new frame should not displace the base order");
});

test("a routing class is replaced whole, and a run under the overlay dispatches its frames", () => {
  const c = loadConfig(root({
    routing: { classes: { design_decision: { action: "run", description: "overlaid", signals: ["x"], frames: ["LEDGER", "SABOTEUR", "MECHANIC"], alternates: [], n: 3 } } },
  }));
  assert.deepEqual(c.overlay!.replaced_classes, ["design_decision"]);
  const r = compile(c, "What timeouts should I set on this HTTP client?", { problem_class: "design_decision" }, { seed: 1 });
  if (r.kind !== "plan") throw new Error("expected a plan");
  assert.equal(r.plan.n, 3);
  assert.deepEqual(r.plan.branches.map((b) => b.frame).sort(), ["LEDGER", "MECHANIC", "SABOTEUR"]);
  // Other classes are untouched: replacement is per id, not per file.
  assert.ok(c.routing.classes["fuzzy_debugging"], "replacing one class dropped the others");
});

test("the plan records which library produced it, so a run can be traced back", () => {
  const dir = root({ frames: [{ ...cfg.frameById.get("MINIMALIST")!, stance: "Do the largest thing that could possibly work, and say what it costs." }] });
  const c = loadConfig(dir);
  const r = compile(c, "What timeouts should I set on this HTTP client?", { problem_class: "design_decision" }, { seed: 1 });
  if (r.kind !== "plan") throw new Error("expected a plan");
  assert.ok(r.plan.overlay, "the plan does not say which library it ran under");
  assert.equal(r.plan.overlay!.hash, c.overlay!.hash);
  assert.deepEqual(r.plan.overlay!.replaced_frames, ["MINIMALIST"]);
  // And the shipped library records null rather than omitting the field, so the two are distinct.
  const plain = compile(loadConfig(root()), "What timeouts should I set on this HTTP client?", { problem_class: "design_decision" }, { seed: 1 });
  if (plain.kind !== "plan") throw new Error("expected a plan");
  assert.equal(plain.plan.overlay, null);
});

test("an overlay that touches the rubric without moving version is refused", () => {
  // Two installs writing the same `rubric_version` into score.json over different weights makes
  // every cross-install pass A total look comparable when it is not. This is the one silent failure
  // whole-replacement does not close on its own.
  const dims = cfg.rubric.dimensions.map((d) => (d.id === "committal" ? { ...d, weight: 3 } : d));
  assert.throws(
    () => loadConfig(root({ rubric: { dimensions: dims } })),
    (e: unknown) => e instanceof ConfigError && /without moving `version`/.test((e as Error).message),
  );
  // With the version moved it loads, and the dimension is replaced rather than merged.
  const c = loadConfig(root({ rubric: { version: cfg.rubric.version + 1, dimensions: dims } }));
  assert.equal(c.rubric.version, cfg.rubric.version + 1);
  assert.equal(c.rubric.dimensions.find((d) => d.id === "committal")!.weight, 3);
  assert.deepEqual(c.overlay!.replaced_dimensions, ["committal"]);
});

test("a merged library is cross-checked as a library, not as a base plus a patch", () => {
  // A routing class naming a frame the overlay did not define is the same error a hand-edited
  // config would raise, and it has to surface at load rather than at dispatch.
  assert.throws(
    () => loadConfig(root({ routing: { classes: { design_decision: { action: "run", description: "d", signals: ["x"], frames: ["NO_SUCH_FRAME"], alternates: [] } } } })),
    (e: unknown) => e instanceof ConfigError,
  );
});

test("an overlay that changes nothing is refused rather than silently ignored", () => {
  assert.throws(() => loadConfig(root({})), (e: unknown) => e instanceof ConfigError && /changes nothing/.test((e as Error).message));
});

test("the overlay hash is over its bytes, so two different overlays never collide", () => {
  const a = stringify({ frames: [{ ...cfg.frameById.get("LEDGER")!, stance: "One currency only, and name the payer before naming the option." }] });
  const b = stringify({ frames: [{ ...cfg.frameById.get("LEDGER")!, stance: "Two currencies at most, and name the payer before the option." }] });
  assert.notEqual(overlayHash(a), overlayHash(b));
  assert.equal(overlayHash(a), overlayHash(a));
});

test("applyOverlay reports what it did, because a merge nobody can see is the failure mode", () => {
  const { applied } = applyOverlay(
    { frames: cfg.frames, routing: cfg.routing, rubric: cfg.rubric },
    { frames: [{ ...cfg.frameById.get("LEDGER")!, stance: "Price it in sleep, and name who loses the sleep first." }, { ...cfg.frameById.get("LEDGER")!, id: "NEW_ONE", axis: "novel" }] },
    "/tmp/o.yaml",
    "sha256:abc",
  );
  assert.deepEqual(applied.replaced_frames, ["LEDGER"]);
  assert.deepEqual(applied.added_frames, ["NEW_ONE"]);
  assert.equal(applied.path, "/tmp/o.yaml");
});

test("an overlay that restates a definition unchanged is not reported as a replacement", () => {
  // An overlay is written by copying a list and editing one entry, so most of what it names is
  // identical to the base. Counting those as replacements makes the report say "ten dimensions
  // replaced" when one moved — the same failure the report exists to prevent, with extra words.
  const all = cfg.rubric.dimensions.map((d) => ({ ...d }));
  const c = loadConfig(root({ rubric: { version: cfg.rubric.version, dimensions: all } }));
  assert.deepEqual(c.overlay!.replaced_dimensions, [], "identical dimensions were reported as replaced");
  // And because nothing changed, the version rule does not bite either — it guards a real edit.
  assert.equal(c.rubric.version, cfg.rubric.version);

  const frames = cfg.frames.frames.map((f) => ({ ...f }));
  const c2 = loadConfig(root({ frames }));
  assert.deepEqual(c2.overlay!.replaced_frames, [], "identical frames were reported as replaced");
  assert.deepEqual(c2.overlay!.added_frames, []);
});
