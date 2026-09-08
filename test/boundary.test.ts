import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cfg } from "./helpers.js";

/**
 * D9's boundary, enforced rather than asserted in prose.
 *
 * `analysis/` is allowed to exist because it measures runs that already happened. The moment
 * anything under `src/` reaches for it, or anything under `analysis/` reaches for a model or
 * the network, it has become a component of the run and D2 says delete it. Both directions are
 * checked, because the failure is cheap to introduce in either.
 */

const ROOT = cfg.root;
const ANALYSIS = join(ROOT, "analysis");

function walk(dir: string, ext: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__pycache__" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (ext.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

test("the analysis package exists and is a Python package, not a stub", () => {
  assert.ok(existsSync(ANALYSIS), "analysis/ is missing; D9 and the README both describe it");
  for (const f of ["pyproject.toml", "README.md", "adhd_analysis/report.py", "tests"]) {
    assert.ok(existsSync(join(ANALYSIS, f)), `analysis/${f} is missing`);
  }
  assert.ok(walk(join(ANALYSIS, "tests"), [".py"]).length >= 2, "the analysis package ships tests");
});

test("nothing under src/ imports or shells out to the analysis package", () => {
  for (const f of walk(join(ROOT, "src"), [".ts"])) {
    const body = readFileSync(f, "utf8");
    const where = relative(ROOT, f);
    assert.ok(!/adhd_analysis/.test(body), `${where} names adhd_analysis; the run must not depend on it`);
    assert.ok(!/\banalysis\/adhd/.test(body), `${where} reaches into analysis/`);
    assert.ok(
      !/\b(python3?|pytest)\b/.test(body.replace(/^\s*(\/\/|\*).*$/gm, "")),
      `${where} looks like it runs Python; the library is pure TypeScript over YAML`,
    );
  }
});

/**
 * The other direction. A local weights file is an inference client with a different delivery
 * mechanism, so the ban is on the libraries that would load one, not on the word "API".
 */
test("nothing under analysis/ imports a model runtime or the network", () => {
  const banned = [
    "torch",
    "tensorflow",
    "transformers",
    "openai",
    "anthropic",
    "requests",
    "httpx",
    "urllib",
    "socket",
    "http.client",
  ];
  const files = walk(ANALYSIS, [".py"]);
  assert.ok(files.length >= 5, `expected the analysis modules, found ${files.length}`);
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    const where = relative(ROOT, f);
    for (const line of body.split("\n")) {
      const m = /^\s*(?:import|from)\s+([\w.]+)/.exec(line);
      if (!m) continue;
      const root = m[1]!.split(".")[0]!;
      assert.ok(
        !banned.includes(root) && !banned.includes(m[1]!),
        `${where} imports ${m[1]}, which would make the analysis package an inference client`,
      );
    }
  }
});

/**
 * The trainer writes a model file, so "writes nothing" is no longer the invariant. What still
 * holds is where it may write: never into `evals/`, `config/` or `prompts/`. A package that wrote
 * back into the recorded corpus could move a figure the repository quotes without a diff anyone
 * reviewed, which is the failure mode the replay baseline catches on the TypeScript side.
 */
test("the analysis package never writes into the corpus, the config or the prompts", () => {
  const protectedDirs = ["evals", "config", "prompts", "docs"];
  for (const f of walk(join(ANALYSIS, "adhd_analysis"), [".py"])) {
    const body = readFileSync(f, "utf8");
    const where = relative(ROOT, f);
    assert.ok(!/\bshutil\.rmtree\b|\bos\.remove\b|\bunlink\(\)/.test(body), `${where} deletes files`);
    for (const d of protectedDirs) {
      const re = new RegExp(`["'\`]${d}["'\`][^\\n]*(write_text|write_bytes|mkdir|open\\()`);
      assert.ok(!re.test(body), `${where} looks like it writes under ${d}/`);
    }
  }
});

/**
 * Writing is confined to the trainer's own output path. Anything else in the package that opened
 * a file for writing would be doing it as a side effect of a read, which is how a report ends up
 * mutating what it reports on.
 */
test("only the model file is written, and only by the trainer", () => {
  const writers = walk(join(ANALYSIS, "adhd_analysis"), [".py"]).filter((f) => {
    const body = readFileSync(f, "utf8");
    return /\.write_text\(|\.write_bytes\(|gzip\.open\([^)]*"wt"|open\([^)]*["']w/.test(body);
  });
  const names = writers.map((f) => relative(ANALYSIS, f)).sort();
  assert.deepEqual(names, ["adhd_analysis/ngram.py", "adhd_analysis/text/ngram.py", "adhd_analysis/text/train.py"].filter((n) => names.includes(n)), `unexpected writer: ${names.join(", ")}`);
});

/**
 * The maintenance agents are the scheduled jobs' hands. They sit outside a run by construction,
 * and the one thing that would undo that is a tool grant letting them start one.
 */
test("the maintenance agents cannot spawn a run", () => {
  for (const name of ["adhd-trainer", "adhd-governor"]) {
    const p = join(ROOT, "agents", `${name}.md`);
    assert.ok(existsSync(p), `agents/${name}.md is missing`);
    const front = readFileSync(p, "utf8").split("---")[1] ?? "";
    assert.match(front, /^tools:/m, `agents/${name}.md declares no tools line`);
    assert.ok(!/\b(Task|Agent)\b/.test(front), `agents/${name}.md can spawn agents`);
  }
  const governor = readFileSync(join(ROOT, "agents", "adhd-governor.md"), "utf8").split("---")[1] ?? "";
  assert.ok(!/\bBash\b/.test(governor), "the governor has Bash; a ceiling that can run the job it caps will run it");
});

test("the scheduled workflows exist and neither commits its output", () => {
  for (const name of ["train.yml", "maintenance.yml"]) {
    const wf = readFileSync(join(ROOT, ".github", "workflows", name), "utf8");
    assert.match(wf, /^on:\n(  .*\n)*  schedule:/m, `${name} is not scheduled`);
    assert.ok(!/git (commit|push)/.test(wf), `${name} pushes to the repository from an unattended job`);
    assert.ok(!/npm audit fix|--force/.test(wf), `${name} applies a dependency change unattended`);
  }
});

test("CI runs the analysis tests, and does not make them depend on the Node build", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "test.yml"), "utf8");
  assert.match(wf, /working-directory: analysis/, "the analysis package is not run in CI");
  assert.match(wf, /run: pytest/, "CI does not run the Python tests");
  const job = wf.slice(wf.indexOf("  analysis:"));
  assert.ok(!/npm (ci|test|run build)/.test(job), "the analysis job depends on the Node build, which is D9's tripwire");
});
