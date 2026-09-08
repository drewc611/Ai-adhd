import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./helpers.js";

/**
 * `NOTICE` attributes the third-party code this repository depends on, and `docs/PROVENANCE.md`
 * attributes the third-party text it trains on. Both are claims about other people's work, which
 * makes a stale one worse than a missing one: an attribution file that has drifted is a specific
 * false statement rather than an absent one.
 */

const ROOT = cfg.root;
const NOTICE = readFileSync(join(ROOT, "NOTICE"), "utf8");
const PROVENANCE = readFileSync(join(ROOT, "docs", "PROVENANCE.md"), "utf8");

test("NOTICE lists every runtime dependency, with the version actually declared", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    assert.ok(NOTICE.includes(`\`${name}\``), `package.json declares ${name} and NOTICE does not list it`);
    // The table carries a resolved version, not the range. A range in the table would let a major
    // bump land with the attribution still reading as current.
    const bare = range.replace(/^[\^~>=<\s]+/, "").split(".")[0]!;
    const row = NOTICE.split("\n").find((l) => l.includes(`\`${name}\``))!;
    assert.match(row, new RegExp(`\\|\\s*${bare}\\.`), `${name}: NOTICE's version is not in the declared range ${range}`);
  }

  const toml = readFileSync(join(ROOT, "analysis", "pyproject.toml"), "utf8");
  const block = toml.slice(toml.indexOf("dependencies = ["), toml.indexOf("]", toml.indexOf("dependencies = [")));
  for (const m of block.matchAll(/"([a-zA-Z0-9_-]+)/g))
    assert.ok(NOTICE.includes(`\`${m[1]!.toLowerCase()}\``), `pyproject declares ${m[1]} and NOTICE does not list it`);
});

test("NOTICE claims the author's copyright and points at the licence", () => {
  const license = readFileSync(join(ROOT, "LICENSE"), "utf8");
  const holder = license.match(/Copyright \(c\) (\d{4}) (.+)/);
  assert.ok(holder, "LICENSE has no parseable copyright line");
  assert.ok(NOTICE.includes(`Copyright (c) ${holder[1]} ${holder[2]}`), "NOTICE and LICENSE disagree on the copyright holder");
  assert.ok(!/<.*>|YOUR NAME|placeholder/i.test(holder[2]!), `the copyright holder is a placeholder: ${holder[2]}`);
});

/**
 * The load-bearing claim. Every corpus is third-party; none is redistributed. If a corpus directory
 * or a trained model ever stopped being ignored, the licensing position in PROVENANCE.md would
 * silently become false while still reading as true.
 */
test("no corpus and no trained model is committed or published", () => {
  const ignored = readFileSync(join(ROOT, ".gitignore"), "utf8");
  for (const path of ["analysis/corpora/", "analysis/models/"])
    assert.ok(ignored.includes(path), `${path} is not gitignored, so the corpus could be committed`);

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { files: string[] };
  for (const entry of pkg.files)
    assert.ok(!/^analysis/.test(entry), `package.json publishes ${entry}, which could carry a corpus into the tarball`);

  // A source file under analysis/corpora would be committed regardless of the ignore, since a
  // gitignore does not cover a path someone force-added.
  assert.ok(!existsSync(join(ROOT, "analysis", "corpora", ".gitkeep")), "a tracked file inside the corpus directory");
});

test("PROVENANCE names every fetchable source, its licence and where it was verified", () => {
  const fetcher = readFileSync(join(ROOT, "analysis", "scripts", "fetch_corpus.py"), "utf8");
  const names = [...fetcher.matchAll(/^\s{4}"([a-z-]+)": Source\(/gm)].map((m) => m[1]!);
  assert.ok(names.length >= 3, `expected several sources, found ${names.join(", ")}`);
  for (const n of names) assert.ok(PROVENANCE.includes(`\`${n}\``), `PROVENANCE does not cover the ${n} corpus`);

  // The distinction the whole position rests on, stated rather than implied.
  assert.match(PROVENANCE, /use, not distribution/i, "PROVENANCE does not state the use-versus-distribution position");
  assert.match(PROVENANCE, /CC0/, "PROVENANCE names no licence");
  assert.match(PROVENANCE, /2026-09-08/, "PROVENANCE does not say when the licences were verified");

  // The one source that is not under a free licence has to read differently from the ones that are.
  assert.match(PROVENANCE, /derivatives restricted|derivative works are restricted/i, "PROVENANCE does not flag the restricted source");

  for (const [name, lic] of [["rust", "MIT OR Apache-2.0"], ["Kubernetes", "Apache-2.0"]] as const)
    assert.ok(new RegExp(name, "i").test(PROVENANCE) && PROVENANCE.includes(lic), `PROVENANCE loses the verified-but-unimplemented ${name} entry`);
});
