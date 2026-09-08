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
 * It reads the corpus and prints. A package that wrote back into `evals/` could move a recorded
 * figure without a diff anyone reviewed, which is the failure mode the replay baseline exists
 * to catch on the TypeScript side.
 */
test("the analysis package writes nothing", () => {
  for (const f of walk(join(ANALYSIS, "adhd_analysis"), [".py"])) {
    const body = readFileSync(f, "utf8");
    const where = relative(ROOT, f);
    assert.ok(!/\.write_text\(|\.write_bytes\(|\bshutil\b|\bos\.remove\b/.test(body), `${where} writes to disk`);
    assert.ok(!/\bopen\([^)]*["']\s*[wax]/.test(body), `${where} opens a file for writing`);
  }
});

test("CI runs the analysis tests, and does not make them depend on the Node build", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "test.yml"), "utf8");
  assert.match(wf, /working-directory: analysis/, "the analysis package is not run in CI");
  assert.match(wf, /run: pytest/, "CI does not run the Python tests");
  const job = wf.slice(wf.indexOf("  analysis:"));
  assert.ok(!/npm (ci|test|run build)/.test(job), "the analysis job depends on the Node build, which is D9's tripwire");
});
