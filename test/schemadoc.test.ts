import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./helpers.js";
import { configDoc } from "../src/schemadoc.js";
import { DimensionSchema, FrameSchema, RunClassSchema } from "../src/schema.js";

const DOC = join(cfg.root, "docs", "CONFIG.md");

test("docs/CONFIG.md is what the schemas currently produce", () => {
  // The failure this exists to prevent has happened twice already in this repository: the
  // README's layout block omitted three directories, and docs/RETIREMENT.md's standing table
  // missed a frame the tooling had put on its own list. Both were prose describing something
  // that had moved. This one is generated, so the drift is a diff rather than a discovery.
  assert.equal(readFileSync(DOC, "utf8"), configDoc(), "regenerate with `adhd schema-doc > docs/CONFIG.md`");
});

test("every field of every documented schema appears in the doc", () => {
  // A generator that silently skipped a field would be worse than a hand-written page, because
  // nobody re-reads a generated one.
  const doc = readFileSync(DOC, "utf8");
  for (const [label, schema] of [
    ["frame", FrameSchema],
    ["run class", RunClassSchema],
    ["dimension", DimensionSchema],
  ] as const)
    for (const field of Object.keys(schema.shape)) assert.match(doc, new RegExp(`\\| \`${field}\` \\|`), `${label}.${field} is not in docs/CONFIG.md`);
});

test("the doc reports defaults and optionality, not just names", () => {
  const doc = readFileSync(DOC, "utf8");
  // `tools` defaults to [] under D4: no frame gets web access unless it asks.
  assert.match(doc, /\| `tools` \| \(`WebSearch` \\\| `WebFetch`\)\[\] \| no \| \[\] \|/);
  // `stance` is the product and has a real floor, not a truthiness check.
  assert.match(doc, /\| `stance` \| string \| yes \| — \| min length 40 \|/);
  assert.match(doc, /\| `id` \| string \| yes \| — \| matches `\/\^\[A-Z\]\[A-Z_\]\*\$\/` \|/);
  // An enum array is bracketed, or `A \| B[]` reads as "A, or a list of B".
  assert.ok(!/\| `attacks` \| `T1` \\\|/.test(doc), "an enum array is rendered ambiguously");
});

test("the doc says what it cannot tell you", () => {
  // A generated reference that implied it was the whole story would be the more dangerous
  // version of a stale one: complete-looking and silent about intent.
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /Do not edit by hand/);
  assert.match(doc, /It cannot say why it exists/);
  assert.match(doc, /docs\/DECISIONS\.md/);
  // crossCheck's rules are not per-field and cannot appear in any table here.
  assert.match(doc, /two\n?primary frames sharing an axis/);
  assert.match(doc, /ConfigError/);
});
