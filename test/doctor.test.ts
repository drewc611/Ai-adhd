import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { doctor, lintRubric, type Finding } from "../src/doctor.js";

/**
 * A copy of the repository's own config, prompts, agents and manifest, in a scratch directory,
 * so a test can break one thing and see whether the check notices. A check nobody has watched
 * fail is decoration, and this file exists to keep `adhd doctor` from becoming that.
 */
function sandbox(): string {
  const root = join(tmp(), "repo");
  mkdirSync(root, { recursive: true });
  for (const d of ["config", "prompts", "agents", "docs", ".claude-plugin"]) cpSync(join(cfg.root, d), join(root, d), { recursive: true });
  // A minimal package.json whose entry points exist, so the build check starts clean.
  mkdirSync(join(root, "dist", "src"), { recursive: true });
  writeFileSync(join(root, "dist", "src", "cli.js"), "");
  writeFileSync(join(root, "dist", "src", "index.js"), "");
  writeFileSync(join(root, "dist", "src", "index.d.ts"), "");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "adhd", bin: { adhd: "dist/src/cli.js" }, main: "dist/src/index.js", types: "dist/src/index.d.ts", files: ["dist/src", "config", "prompts", "docs"] }, null, 2),
  );
  return root;
}

const run = (root: string) => doctor(loadConfig(root));
const errorsFrom = (f: Finding[], check: string) => f.filter((x) => x.check === check && x.severity === "error");

function editYaml(root: string, file: string, from: string, to: string): void {
  const p = join(root, "config", file);
  const text = readFileSync(p, "utf8");
  assert.ok(text.includes(from), `the fixture edit did not match: ${from}`);
  writeFileSync(p, text.replace(from, to));
}

test("the repository passes its own doctor", () => {
  const r = doctor(cfg);
  assert.deepEqual(r.errors, [], r.errors.map((e) => `[${e.check}] ${e.message}`).join("\n"));
  assert.equal(r.checked.length, 8);
});

test("an unbuilt entry point is an error, and so is one no files entry publishes", () => {
  // This is defect 55 from the hygiene sweep, turned into a check. `bin`, `main` and both npm
  // scripts once pointed at dist/cli.js while the build emitted dist/src/, so `npm i -g adhd
  // && adhd` would have failed. It survived because development runs the built path directly.
  const root = sandbox();
  rmSync(join(root, "dist", "src", "cli.js"));
  assert.ok(errorsFrom(run(root).findings, "build").some((e) => /dist\/src\/cli\.js.*does not exist/.test(e.message)));

  const root2 = sandbox();
  const pkg = JSON.parse(readFileSync(join(root2, "package.json"), "utf8")) as { files: string[] };
  pkg.files = pkg.files.filter((f) => f !== "dist/src");
  writeFileSync(join(root2, "package.json"), JSON.stringify(pkg));
  assert.ok(errorsFrom(run(root2).findings, "build").some((e) => /no files entry covers it/.test(e.message)));
});

test("a branch agent granted a filesystem tool is an error, because it could read its siblings", () => {
  // The one thing the architecture exists to prevent. A branch with Read, Grep or Glob can find
  // the other branches' artifacts in the run directory, and then the isolation is a claim rather
  // than a mechanism.
  const root = sandbox();
  const p = join(root, "agents", "adhd-branch.md");
  writeFileSync(join(root, "agents", "adhd-branch.md"), readFileSync(p, "utf8").replace(/^tools:.*$/m, "tools: Read, Grep"));
  const e = errorsFrom(run(root).findings, "tools");
  assert.ok(e.some((x) => /grants Read/.test(x.message)), e.map((x) => x.message).join("; "));
});

test("a frame asking for a tool its agent does not grant is an error", () => {
  // T3 went unfired for seven runs because no frame that could trigger it had the tools. A
  // frame that asks and silently does not get them looks exactly like a frame that chose not to
  // search, and nothing else in the repository can tell those apart.
  const root = sandbox();
  const p = join(root, "agents", "adhd-branch-search.md");
  writeFileSync(p, readFileSync(p, "utf8").replace(/WebSearch/g, "SomethingElse"));
  const e = errorsFrom(run(root).findings, "tools");
  assert.ok(e.some((x) => /ask for WebSearch and adhd-branch-search does not grant it/.test(x.message)), e.map((x) => x.message).join("; "));
});

test("routing rules that crossCheck already owns are not duplicated here", () => {
  // Writing checkRouting found four of its six rules were dead: an unknown frame, two primary
  // frames on one axis, n over hard_cap and an empty decline reason all raise ConfigError at
  // load, which is a harder failure than a report. They were removed rather than left in to
  // imply coverage that lives somewhere else. This pins that, so a future loosening of
  // crossCheck fails here instead of quietly leaving the case uncovered by anything.
  const root = sandbox();
  editYaml(root, "routing.yaml", "PARTICULARIST", "NOT_A_FRAME");
  assert.throws(() => loadConfig(root), (e: Error) => e.name === "ConfigError" && /unknown frame NOT_A_FRAME/.test(e.message));

  const axisRoot = sandbox();
  const byAxis = new Map<string, string[]>();
  for (const f of cfg.frames.frames) byAxis.set(f.axis, [...(byAxis.get(f.axis) ?? []), f.id]);
  const pair = [...byAxis.values()].find((v) => v.length >= 2)!;
  assert.ok(pair, "the library has no axis with two frames, so this asserts nothing");
  const p = join(axisRoot, "config", "routing.yaml");
  const line = readFileSync(p, "utf8").split("\n").find((l) => /^\s+frames: \[/.test(l))!;
  writeFileSync(p, readFileSync(p, "utf8").replace(line, line.replace(/\[.*\]/, `[${pair[0]}, ${pair[1]}]`)));
  assert.throws(() => loadConfig(axisRoot), (e: Error) => e.name === "ConfigError" && /share an axis/.test(e.message));
});

test("a class that cannot fill its own branch count is an error nothing else catches", () => {
  // This one loads cleanly. The compiler takes the shortfall from alternates, so a class short
  // on both dispatches fewer branches than the plan claims.
  const root = sandbox();
  const p = join(root, "config", "routing.yaml");
  // Both lists have to shrink: the compiler fills from alternates, so a class short only on its
  // primary list is a warning, and an error only when the two together cannot reach n.
  const lines = readFileSync(p, "utf8").split("\n");
  const at = lines.findIndex((l) => /^\s+frames: \[/.test(l));
  lines[at] = lines[at]!.replace(/\[.*\]/, "[FRAME_BREAKER]");
  // The alternates list wraps across two lines in the shipped file.
  lines[at + 1] = lines[at + 1]!.replace(/\[.*$/, "[ACTOR_CENSUS]");
  if (/^\s+SUPPLICANT/.test(lines[at + 2] ?? "")) lines[at + 2] = "";
  writeFileSync(p, lines.join("\n"));
  const e = errorsFrom(run(root).findings, "routing");
  assert.ok(e.some((x) => /can reach only 2 frames/.test(x.message)), e.map((x) => x.message).join("; ") || "no routing error raised");

  // Short on primaries alone is a warning, not an error: it loads, it runs, and every run of
  // that class silently takes frames from the alternate list.
  const warnRoot = sandbox();
  const wp = join(warnRoot, "config", "routing.yaml");
  const wlines = readFileSync(wp, "utf8").split("\n");
  const wat = wlines.findIndex((l) => /^\s+frames: \[/.test(l));
  wlines[wat] = wlines[wat]!.replace(/\[.*\]/, "[FRAME_BREAKER]");
  writeFileSync(wp, wlines.join("\n"));
  const w = run(warnRoot).findings.filter((x) => x.check === "routing");
  assert.deepEqual(errorsFrom(w, "routing"), []);
  assert.ok(w.some((x) => x.severity === "warn" && /come from alternates on every run/.test(x.message)), w.map((x) => x.message).join("; "));
});

test("the rubric linter catches a broken scale rather than a disliked question", () => {
  // Deliberately not a quality judgement: CLAUDE.md forbids replacing the critic rubric with one,
  // and this checks arithmetic and shape only.
  const gap = structuredClone(cfg);
  const dim = gap.rubric.dimensions[0]!;
  delete (dim.anchors as Record<string, string>)["1"];
  assert.ok(lintRubric(gap).some((f) => /anchors skip from 0 to 2/.test(f.message)));

  const wide = structuredClone(cfg);
  (wide.rubric.dimensions[0]!.anchors as Record<string, string>)["9"] = "an anchor nobody else has";
  assert.ok(
    lintRubric(wide).some((f) => /pass_a is a weighted total, so the wider scale counts for more/.test(f.message)),
    "a dimension on a wider scale counts for more than its weight says and nothing else notices",
  );

  const zero = structuredClone(cfg);
  zero.rubric.dimensions[1]!.weight = 0;
  assert.ok(lintRubric(zero).some((f) => /weight 0 is not positive/.test(f.message)));

  const dup = structuredClone(cfg);
  dup.rubric.dimensions[1]!.question = dup.rubric.dimensions[0]!.question;
  assert.ok(lintRubric(dup).some((f) => /ask the same question/.test(f.message) && f.severity === "warn"));

  // And the shipped rubric passes all of it.
  assert.deepEqual(lintRubric(cfg).filter((f) => f.severity === "error"), []);
});

test("a trap with no section in docs/TRAPS.md is an error, because the critic brief renders from those sections", () => {
  const root = sandbox();
  const p = join(root, "docs", "TRAPS.md");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^## T4\./m, "## T4x."));
  const e = errorsFrom(run(root).findings, "prompts");
  assert.ok(e.some((x) => /T4 is a trap id and docs\/TRAPS\.md has no/.test(x.message)), e.map((x) => x.message).join("; "));
});

test("a recorded run with a plan and no score is an error; a branch that returned nothing is a warning", () => {
  const root = sandbox();
  const runDir = join(root, "evals", "recorded", "999-broken");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "plan.json"), JSON.stringify({ branches: [{ frame: "LEDGER", artifact_path: "branches/LEDGER.yaml" }] }));
  const f = run(root).findings;
  assert.ok(errorsFrom(f, "corpus").some((x) => /999-broken has plan\.json and no score\.json/.test(x.message)));
  assert.ok(f.some((x) => x.severity === "warn" && /returned nothing, which is not the same as scoring badly/.test(x.message)));
});

test("doctor exits on errors and not on warnings, and a check that throws is reported rather than swallowed", () => {
  const clean = doctor(cfg);
  assert.equal(clean.errors.length, 0);
  assert.match(clean.text, /Nothing disagrees|warning\(s\)/);

  // A root with no config at all: every file-reading check has to survive it and say so.
  const bare = join(tmp(), "bare");
  mkdirSync(bare, { recursive: true });
  const broken = structuredClone(cfg);
  (broken as { root: string }).root = bare;
  const r = doctor(broken);
  assert.ok(r.errors.length > 0);
  assert.ok(!r.findings.some((x) => /the check itself threw/.test(x.message)), r.findings.filter((x) => /threw/.test(x.message)).map((x) => x.message).join("; "));
});
