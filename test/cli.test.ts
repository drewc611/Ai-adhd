import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { artifact, cfg, tmp, writeProblem } from "./helpers.js";

const CLI = join(cfg.root, "dist", "src", "cli.js");
const HASH = "sha256:" + "a".repeat(64);

/**
 * The CLI is a shipped deliverable and its exit codes are a contract: a script driving a run
 * branches on them. Nothing tested them, so they were only ever right by inspection. These run
 * the real built binary.
 */
function run(args: string[], opts: { cwd?: string } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: opts.cwd ?? cfg.root });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

test("no arguments prints help and does not pretend to have succeeded", () => {
  const r = run([]);
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /adhd/);
});

test("an unknown command fails rather than doing nothing quietly", () => {
  const r = run(["not-a-command"]);
  assert.notEqual(r.code, 0);
});

test("validate exits 0 and names what it loaded", () => {
  const r = run(["validate"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /13 frames/);
  assert.match(r.out, /rubric dimensions/);
});

test("a bad root is a config error, exit 4, with the reason on stderr", () => {
  const r = run(["--root", join(tmp(), "not-a-repo"), "validate"]);
  assert.equal(r.code, 4, `stdout: ${r.out} stderr: ${r.err}`);
  assert.match(r.err, /config invalid/);
  assert.equal(r.out, "", "the reason belongs on stderr, not stdout");
});

test("frames lists the library, and --json emits parseable JSON", () => {
  assert.match(run(["frames"]).out, /PARTICULARIST/);
  const parsed = JSON.parse(run(["frames", "--json"]).out) as { id: string }[];
  assert.equal(parsed.length, 13);
  assert.ok(parsed.every((f) => typeof f.id === "string"));
});

/** The D6 check is meant to be usable as a gate, so a flagged pair has to be a non-zero exit. */
test("frames --orthogonality exits 0 when nothing is flagged", () => {
  const r = run(["frames", "--orthogonality"]);
  assert.equal(r.code, 0, "no pair is currently flagged; a flagged pair must exit 1");
  assert.match(r.out, /co-clustered/);
});

test("traps exits 1 on a contract violation and 0 on a clean artifact", () => {
  const dir = tmp();
  const good = join(dir, "good.yaml");
  writeFileSync(good, stringify(artifact("LEDGER", HASH)));
  assert.equal(run(["traps", good]).code, 0);

  const bad = join(dir, "bad.yaml");
  const { falsifier: _f, ...missing } = artifact("LEDGER", HASH);
  writeFileSync(bad, stringify(missing));
  const r = run(["traps", bad]);
  assert.equal(r.code, 1);
  assert.match(r.out, /VIOLATED/);
});

test("traps --hash exits 1 on a mismatch", () => {
  const p = join(tmp(), "a.yaml");
  writeFileSync(p, stringify(artifact("LEDGER", HASH)));
  assert.equal(run(["traps", p, "--hash", HASH]).code, 0);
  assert.equal(run(["traps", p, "--hash", "sha256:" + "b".repeat(64)]).code, 1);
});

test("traps on a missing file fails instead of reporting a clean artifact", () => {
  const r = run(["traps", join(tmp(), "nope.yaml")]);
  assert.notEqual(r.code, 0);
  assert.ok(!/contract: ok/.test(r.out));
});

test("eval replays the corpus and exits 0 when every run matches its expectation", () => {
  const r = run(["eval"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /all recorded runs match their expected outcome/);
});

test("learn runs both reports when neither flag is given", () => {
  const r = run(["learn"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /weight sensitivity/);
  assert.match(r.out, /dimension correlation/);
});

/**
 * A wrong flag is not a broken repository. These printed "config invalid:" and exited 4, at a
 * reader whose config was fine.
 */
test("a command line mistake is a usage error, exit 5, and says so", () => {
  const r = run(["learn", "--agreement", "/dev/null"]);
  assert.equal(r.code, 5);
  assert.match(r.err, /^usage: /);
  assert.match(r.err, /needs --run/);
  assert.ok(!/config invalid/.test(r.err), "the config is fine; the flags are not");
});

test("why refuses an unknown frame with the library listed", () => {
  const r = run(["why", join(cfg.root, "evals", "recorded", "001-first-run"), "NOT_A_FRAME"]);
  assert.equal(r.code, 5);
  assert.match(r.err, /usage: unknown frame/);
  assert.match(r.err, /LEDGER/);
});

/** A driver script branches on these, so each has to mean one thing. */
test("the five failure exits are distinct", () => {
  const codes = new Map<string, number | null>();
  codes.set("config", run(["--root", join(tmp(), "nope"), "validate"]).code);
  codes.set("usage", run(["why", join(cfg.root, "evals", "recorded", "001-first-run"), "NOPE"]).code);
  const bad = join(tmp(), "bad.yaml");
  const { falsifier: _f, ...missing } = artifact("LEDGER", HASH);
  writeFileSync(bad, stringify(missing));
  codes.set("contract", run(["traps", bad]).code);
  assert.deepEqual([...codes.entries()], [["config", 4], ["usage", 5], ["contract", 1]]);
  // 3 is a run abort, covered by its own test below; 0 is success.
});

test("why explains a real frame and exits 0", () => {
  const r = run(["why", join(cfg.root, "evals", "recorded", "002-kernel-enduser"), "END_USER"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Pruned by these detectors/);
});

test("run compile writes a plan and reports where it put it", () => {
  const dir = tmp();
  const problemPath = writeProblem(join(dir, "in"), "What timeouts should I set on this HTTP client?");
  const r = run(["run", "--phase", "compile", "--problem", problemPath, "--decision", '{"problem_class":"design_decision"}', "--runs-dir", join(dir, "runs"), "--seed", "1"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /brief/i);
});

/** A run aborts on a hash mismatch. That is exit 3, and a driver script must be able to tell. */
test("a run abort exits 3, distinct from a config error and a contract failure", () => {
  const dir = tmp();
  const problemPath = writeProblem(join(dir, "in"), "What timeouts should I set on this HTTP client?");
  const runsDir = join(dir, "runs");
  const compiled = run(["run", "--phase", "compile", "--problem", problemPath, "--decision", '{"problem_class":"design_decision"}', "--runs-dir", runsDir, "--seed", "1"]);
  assert.equal(compiled.code, 0, compiled.err);
  const runDir = compiled.out.match(/\S*runs\/[^\s:]+/)?.[0];
  assert.ok(runDir, `no run directory in: ${compiled.out}`);

  const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as { branches: { frame: string; artifact_path: string }[] };
  for (const b of plan.branches) writeFileSync(join(runDir, b.artifact_path), stringify(artifact(b.frame, "sha256:" + "9".repeat(64))));

  const r = run(["run", "--phase", "critique", "--run", runDir]);
  assert.equal(r.code, 3, `expected a run abort, got ${r.code}: ${r.out}${r.err}`);
  assert.match(r.err, /ABORT/);
});
