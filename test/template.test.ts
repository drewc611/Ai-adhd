import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/template.js";

test("values are inserted without rescanning: {{ inside a value survives", () => {
  const out = render("A {{x}} B", { x: "keep {{y}} literal" });
  assert.equal(out, "A keep {{y}} literal B");
});

test("each and if", () => {
  const out = render("{{#each items}}- {{this}}\n{{/each}}{{#if none}}none{{/if}}{{#if some}}some{{/if}}", { items: ["a", "b"], none: [], some: "x" });
  assert.equal(out, "- a\n- b\nsome");
});

test("dotted lookup and each over objects", () => {
  const out = render("{{a.b}}|{{#each rows}}{{name}}:{{n}};{{/each}}", { a: { b: "ok" }, rows: [{ name: "x", n: 1 }, { name: "y", n: 2 }] });
  assert.equal(out, "ok|x:1;y:2;");
});

test("unbalanced blocks throw", () => {
  assert.throws(() => render("{{#each x}}", {}));
  assert.throws(() => render("{{/if}}", {}));
});
