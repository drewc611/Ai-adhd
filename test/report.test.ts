import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./helpers.js";
import { comparisonMatrix, exportRun, runTree } from "../src/report.js";

const RECORDED = join(cfg.root, "evals", "recorded");

test("the matrix reproduces the pre-registered experiment finding without anybody reading it", () => {
  // E1a and E1b: 001-seed2 and 001-altframes each hold an assertion the other misses. That took
  // a person reading two eval reports side by side. The grid says it in a line.
  const m = comparisonMatrix(cfg);
  assert.ok(m.runs.includes("001-altframes") && m.runs.includes("001-seed2"));
  assert.equal(m.cells["001/human_cancel"]!["001-altframes"], "held");
  assert.equal(m.cells["001/human_cancel"]!["001-seed2"], "missed");
  assert.equal(m.cells["001/retry_target_questioned"]!["001-altframes"], "missed");
  assert.equal(m.cells["001/retry_target_questioned"]!["001-seed2"], "held");
  assert.match(m.text, /001-altframes and 001-seed2 each hold an assertion the other misses/);
  assert.match(m.text, /A single 'this run is better' reading of any such pair is wrong/);

  // A run belonging to another fixture is absent, not failing. The two are different facts and
  // a grid that conflated them would report six phantom failures per 001 row.
  assert.equal(m.cells["001/human_cancel"]!["004-kernel-naming"], "absent");
  assert.match(m.text, /\. = that fixture has no such run/);
});

test("the matrix legend numbers every run it charts", () => {
  const m = comparisonMatrix(cfg);
  for (let i = 0; i < m.runs.length; i++) assert.match(m.text, new RegExp(`\\s${i + 1}\\s+${m.runs[i]}`));
  // An earlier version spelled run names downwards, one character per line: eighteen rows of
  // unreadable header before a single assertion.
  assert.ok(!/^\s+0\s*$/m.test(m.text));
});

test("an exported run is one document with one H1 and the pruned block above the artifacts", () => {
  const md = exportRun(cfg, join(RECORDED, "002-kernel-enduser"));
  assert.equal(md.split("\n").filter((l) => /^# /.test(l)).length, 1, "an export with two H1s does not nest");
  // The synthesis carries its own H1 and is demoted so the outline holds.
  assert.match(md, /^## ADHD synthesis$/m);
  assert.match(md, /^### Pruned, with reason$/m);
  // The part the architecture exists to deliver comes before the raw artifacts, because a
  // reader skips whatever is at the end.
  assert.ok(md.indexOf("Pruned, with reason") < md.indexOf("## Branch artifacts"));
  assert.match(md, /No model wrote this file/);
});

test("an export names a renamed frame by both ids, and carries the detector evidence", () => {
  const md = exportRun(cfg, join(RECORDED, "002-kernel-enduser"));
  // This run wrote END_USER; the library calls it SUPPLICANT and the recording is not rewritten.
  assert.match(md, /### SUPPLICANT \(recorded as END_USER\)/);
  // A pruned frame without the text that pruned it is an assertion, not evidence.
  assert.match(md, /## Detectors that fired, with the text that fired them/);
  assert.match(md, /- \*\*[A-Z_]+\*\* T\d: \S/);
  assert.match(md, /^## Problem, verbatim$/m);
  assert.match(md, /problem_hash: sha256:[0-9a-f]{64}/);
});

test("the run tree says what an absence means, which is why it is not ls -R", () => {
  const full = runTree(join(RECORDED, "002-kernel-enduser"));
  assert.ok(full.entries.some((e) => e.path === "critic/pass-b.yaml"));
  assert.ok(full.bytes > 0);
  assert.ok(!/no critic\/pass-b\.yaml/.test(full.text), "a completed run was reported as cancelled");

  // A negative control is a hand-written answer with no plan, and the tree says so rather than
  // reporting a run missing every file a run has.
  const control = runTree(join(RECORDED, "001-linear-cot"));
  assert.match(control.text, /no plan\.json: this is a hand-written negative control, not a run/);
  assert.ok(!/planned and never returned/.test(control.text));
});

test("the run tree reports a branch that returned nothing as planned-and-absent", () => {
  const t = runTree(join(RECORDED, "001-altframes"));
  const planned = (JSON.parse(readFileSync(join(RECORDED, "001-altframes", "plan.json"), "utf8")) as { branches: { frame: string; artifact_path: string }[] }).branches;
  const missing = planned.filter((b) => !t.entries.some((e) => e.path === b.artifact_path));
  if (missing.length) assert.match(t.text, /planned and never returned/);
  else assert.ok(!/planned and never returned/.test(t.text), "the tree invented a missing branch");
});
