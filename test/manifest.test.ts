import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cfg } from "./helpers.js";

/**
 * `docs/MANIFEST.md` says how code in this repository gets written. Most of it is judgement and
 * is not enforceable. Three parts are mechanical, and pretending the rest is testable would be
 * worse than leaving it to review.
 */

const ROOT = cfg.root;

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

/**
 * Narration, not documentation. Each of these restates the line beneath it, which is the pattern
 * the manifest's "nix semantic fluff" rule names. The list is short on purpose: a heuristic that
 * tried to detect narration in general would flag the comments that earn their place.
 */
const NARRATION = [
  /^\s*\/\/\s*(initialize|initialise|declare|define)\b[^.]*$/i,
  /^\s*\/\/\s*(catch|try|else|finally)\s*(block|branch|clause)?\s*$/i,
  /^\s*\/\/\s*(loop|iterate)\s+(over|through)\b/i,
  /^\s*\/\/\s*(increment|decrement|set|assign|update)\s+(the\s+)?\w+\s*$/i,
  /^\s*\/\/\s*(return|export|import)s?\s+(the\s+)?\w+\s*$/i,
  /^\s*\/\/\s*(constructor|getter|setter|helper function)\s*$/i,
  /^\s*\/\/\s*end (of )?(function|loop|if|class)\b/i,
];

test("no source comment narrates the line beneath it", () => {
  const offenders: string[] = [];
  for (const f of [...walk(join(ROOT, "src"), [".ts"]), ...walk(join(ROOT, "test"), [".ts"])]) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (NARRATION.some((re) => re.test(line))) offenders.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, [], `docs/MANIFEST.md section 2:\n${offenders.join("\n")}`);
});

/**
 * "Dependency minimisation" is only a rule if something notices a dependency nothing imports. A
 * package that stays in the manifest after its last use is exactly the one that gets audited,
 * patched and carried for years.
 */
test("every declared dependency is imported by something", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const src = [...walk(join(ROOT, "src"), [".ts"])].map((f) => readFileSync(f, "utf8")).join("\n");
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const re = new RegExp(`from ["']${dep}(/[^"']*)?["']`);
    assert.ok(re.test(src), `package.json declares ${dep} and nothing under src/ imports it`);
  }

  const toml = readFileSync(join(ROOT, "analysis", "pyproject.toml"), "utf8");
  const block = toml.slice(toml.indexOf("dependencies = ["), toml.indexOf("]", toml.indexOf("dependencies = [")));
  const py = walk(join(ROOT, "analysis", "adhd_analysis"), [".py"]).map((f) => readFileSync(f, "utf8")).join("\n");
  // The distribution name and the import name differ for exactly these two, and hard-coding the
  // pair is honest: deriving it needs the package metadata, which is not on disk before install.
  const importName: Record<string, string> = { pyyaml: "yaml", "scikit-learn": "sklearn" };
  for (const m of block.matchAll(/"([a-zA-Z0-9_-]+)/g)) {
    const dist = m[1]!.toLowerCase();
    const mod = importName[dist] ?? dist;
    assert.match(py, new RegExp(`^\\s*(import|from) ${mod}\\b`, "m"), `pyproject declares ${dist} and nothing imports ${mod}`);
  }
});

test("the manifest exists and CLAUDE.md points at it", () => {
  assert.ok(existsSync(join(ROOT, "docs", "MANIFEST.md")), "docs/MANIFEST.md is missing");
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  assert.match(claude, /docs\/MANIFEST\.md/, "CLAUDE.md does not name the manifest, so nothing routes a contributor to it");
});
