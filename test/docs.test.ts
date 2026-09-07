import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./helpers.js";

const README = readFileSync(join(cfg.root, "README.md"), "utf8");

/**
 * The README's diagrams name frames, phases and states. Those drift: a frame gets retired, a
 * kernel state gets renamed, and the diagram keeps saying the old thing while looking correct.
 * These check the claims against the code and config rather than against a reading of the page.
 *
 * Full mermaid parsing needs a browser for layout, so it is not done here. The diagrams were
 * validated by rendering them; this guards what a renderer would not catch anyway.
 */
function mermaidBlocks(md: string): string[] {
  const out: string[] = [];
  const re = /^```mermaid\n([\s\S]*?)^```$/gm;
  for (let m = re.exec(md); m; m = re.exec(md)) out.push(m[1]!);
  return out;
}

test("every mermaid fence in the README is closed and declares a diagram type", () => {
  const opens = (README.match(/^```mermaid$/gm) ?? []).length;
  const blocks = mermaidBlocks(README);
  assert.equal(blocks.length, opens, "an unclosed mermaid fence would swallow the rest of the page");
  assert.ok(blocks.length >= 4, `expected at least 4 diagrams, found ${blocks.length}`);
  for (const b of blocks) {
    const first = b.split("\n").find((l) => l.trim())!.trim();
    assert.match(first, /^(flowchart|graph|stateDiagram-v2|sequenceDiagram|classDiagram)\b/, `unknown diagram type: ${first}`);
  }
});

test("every frame id a diagram names is in the library", () => {
  const known = new Set(cfg.frames.frames.map((f) => f.id));
  for (const b of mermaidBlocks(README))
    for (const id of b.match(/\b[A-Z][A-Z_]{3,}\b/g) ?? []) {
      // Caps words that are not frames: the project name, a synthesis label, and emphasis in
      // a subgraph title. Everything else in caps inside a diagram should be a frame id.
      if (["ADHD", "UNSCORED", "ONE"].includes(id)) continue;
      assert.ok(known.has(id), `diagram names ${id}, which is not in config/frames.yaml`);
    }
});

test("the kernel states a diagram names are states the kernel actually reaches", () => {
  const os = readFileSync(join(cfg.root, "src", "os.ts"), "utf8");
  const state = mermaidBlocks(README).find((b) => b.trimStart().startsWith("stateDiagram"));
  assert.ok(state, "the operating system section should carry a state diagram");
  const named = new Set<string>();
  for (const m of state!.matchAll(/^\s*(\w+)\s*-->\s*(\w+)/gm)) {
    named.add(m[1]!);
    named.add(m[2]!);
  }
  named.delete("running"); // a composite the diagram introduces to group the working phases
  for (const s of named) {
    if (s === "state") continue;
    assert.ok(new RegExp(`["']${s}["']`).test(os), `the diagram names state ${s}, which does not appear in src/os.ts`);
  }
});

test("the trap count in the diagrams matches the taxonomy", () => {
  const traps = (readFileSync(join(cfg.root, "docs", "TRAPS.md"), "utf8").match(/^##\s+T\d/gm) ?? []).length;
  assert.equal(traps, 8, "docs/TRAPS.md no longer defines 8 traps");
  for (const b of mermaidBlocks(README))
    for (const m of b.matchAll(/all (\d+) trap detectors|any of the (\d+)\s*<br\/>\s*detectors/g))
      assert.equal(Number(m[1] ?? m[2]), traps, "a diagram states a trap count the taxonomy does not");
});

test("every image the README references exists in the repo", () => {
  const refs = [...README.matchAll(/(?:src=|]\()["']?(assets\/[^"')\s]+)/g)].map((m) => m[1]!);
  assert.ok(refs.length > 0, "the README should carry the project mark");
  for (const r of refs) assert.ok(existsSync(join(cfg.root, r)), `README references ${r}, which is missing`);
});

test("the mark and the banner are valid standalone SVGs with a title for screen readers", () => {
  for (const f of ["assets/mark.svg", "assets/banner.svg"]) {
    const svg = readFileSync(join(cfg.root, f), "utf8");
    assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${f}: no namespace, so it will not render as an <img>`);
    assert.match(svg, /<title[^>]*>[^<]+<\/title>/, `${f}: no title`);
    assert.match(svg, /viewBox="[\d.\s-]+"/, `${f}: no viewBox, so it will not scale`);
    assert.ok(!/<script/i.test(svg), `${f}: GitHub strips scripted SVG`);
    // The banner embeds a copy of the mark's geometry. If one moves, the other has to.
    if (f === "assets/banner.svg") {
      const mark = readFileSync(join(cfg.root, "assets", "mark.svg"), "utf8");
      const ray = mark.match(/M88\.1 116\.9 L188\.4 82\.4/);
      assert.ok(ray, "the mark's geometry changed; update the copy inside the banner");
      assert.ok(svg.includes(ray![0]), "the banner's copy of the mark has drifted from assets/mark.svg");
    }
  }
});

/**
 * The README is published with the package, so an asset it references has to be published too.
 * Without this, `npm i adhd` gets a README with a broken image, which is the same defect class
 * as the entry points that pointed at a directory the build does not emit.
 */
test("assets the README references are carried by a package.json files entry", () => {
  const pkg = JSON.parse(readFileSync(join(cfg.root, "package.json"), "utf8")) as { files: string[] };
  const refs = [...README.matchAll(/(?:src=|]\()["']?(assets\/[^"')\s]+)/g)].map((m) => m[1]!);
  for (const r of refs) {
    const covered = pkg.files.some((f) => r === f || r.startsWith(f.replace(/\/$/, "") + "/"));
    assert.ok(covered, `${r} is in the README but no files entry publishes it`);
  }
});
