import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

// ---- drift ---------------------------------------------------------------------------------
// Everything below exists because the PR description went thirty-one commits stale claiming a
// test count that had doubled and weak points that were closed. Docs make claims with numbers
// and names in them, and a confident sentence nobody rechecks is worse than no sentence.

test("a test count the README states is the count the suite actually has", () => {
  const claimed = README.match(/(\d+) tests over all of it/);
  assert.ok(claimed, "the layout block should say how many tests there are");
  const actual = readdirSync(join(cfg.root, "test"))
    .filter((f) => f.endsWith(".test.ts"))
    .reduce((n, f) => n + (readFileSync(join(cfg.root, "test", f), "utf8").match(/^test\(/gm) ?? []).length, 0);
  assert.equal(Number(claimed[1]), actual, "the README's test count has drifted from test/");
});

test("the layout block lists every top-level directory a reader would look for", () => {
  const block = README.match(/^## Layout\n\n```\n([\s\S]*?)```/m)?.[1];
  assert.ok(block, "the README should carry a layout block");
  const onDisk = readdirSync(cfg.root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !["node_modules", "dist", "coverage", "runs"].includes(d.name))
    .map((d) => d.name);
  for (const dir of onDisk) assert.match(block, new RegExp(`^${dir}/`, "m"), `${dir}/ exists and the layout block does not mention it`);
  for (const line of block.split("\n")) {
    const named = line.match(/^(\w[\w-]*)\//)?.[1];
    if (named) assert.ok(onDisk.includes(named), `the layout block lists ${named}/, which is not there`);
  }
});

/** A doc pointing at a command that does not exist is the worst kind of stale. */
test("every adhd command the docs name is a command the CLI has", () => {
  const cli = readFileSync(join(cfg.root, "src", "cli.ts"), "utf8");
  const commands = new Set([...cli.matchAll(/\.command\("([\w-]+)/g)].map((m) => m[1]!));
  assert.ok(commands.size >= 8, `only found ${commands.size} commands in cli.ts`);
  const docs = ["README.md", "CONTRIBUTING.md", "CLAUDE.md", join("docs", "RETIREMENT.md"), join("docs", "OS.md"), join("skills", "adhd", "SKILL.md")];
  for (const d of docs) {
    const p = join(cfg.root, d);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/\badhd ([a-z][\w-]*)/g)) {
      const verb = m[1]!;
      // `adhd os <syscall>` is the kernel's own verb set, checked by its own tests.
      if (verb === "os") continue;
      assert.ok(commands.has(verb), `${d} names \`adhd ${verb}\`, which the CLI does not have`);
    }
  }
});

test("the decision range CLAUDE.md states is the range DECISIONS.md resolves", () => {
  const claude = readFileSync(join(cfg.root, "CLAUDE.md"), "utf8");
  const decisions = readFileSync(join(cfg.root, "docs", "DECISIONS.md"), "utf8");
  const resolved = (decisions.match(/^## D(\d+)\./gm) ?? []).map((h) => Number(h.match(/\d+/)![0]));
  assert.ok(resolved.length > 0, "DECISIONS.md should carry numbered decisions");
  const highest = Math.max(...resolved);
  assert.deepEqual(resolved, Array.from({ length: highest }, (_, i) => i + 1), "the decisions are not a contiguous run from D1");
  for (const doc of [claude, README]) {
    const claim = doc.match(/D1 through D(\d+)/);
    if (claim) assert.equal(Number(claim[1]), highest, `a doc claims D1 through D${claim[1]}, but DECISIONS.md resolves up to D${highest}`);
  }
});

/**
 * The direction worth checking is the dangerous one. Whether an open item has quietly shipped
 * is not inferable from the text: a first attempt flagged item 0 for naming `adhd eval --audit`
 * as the tool that found a problem, and item 43 for proposing `--json` on every command when the
 * CLI has it on some. Two guesses, two false positives.
 *
 * What is checkable is the claim. Every item struck through carries a note saying what shipped,
 * and a note naming a command, flag or file that does not exist is a lie in the file that tells
 * you what to build next.
 */
test("every backlog item marked built names something that exists", () => {
  const backlog = readFileSync(join(cfg.root, "docs", "BACKLOG.md"), "utf8");
  const cli = readFileSync(join(cfg.root, "src", "cli.ts"), "utf8");
  const commands = new Set([...cli.matchAll(/\.command\("([\w-]+)/g)].map((m) => m[1]!));
  const flags = new Set([...cli.matchAll(/\.option\("(--[\w-]+)/g)].map((m) => m[1]!));

  const notes = [...backlog.matchAll(/^\s+\*\*(Built[^*]*)\*\*$/gm)].map((m) => m[1]!);
  assert.ok(notes.length >= 12, `expected the built items to carry notes, found ${notes.length}`);
  for (const note of notes) {
    for (const m of note.matchAll(/`adhd ([a-z][\w-]*)/g)) assert.ok(commands.has(m[1]!), `a built note names \`adhd ${m[1]}\`, which the CLI does not have`);
    for (const m of note.matchAll(/`(--[\w-]+)`/g)) assert.ok(flags.has(m[1]!), `a built note names ${m[1]}, which no command declares`);
    for (const m of note.matchAll(/`((?:docs|src|test|evals|assets|config|prompts)\/[\w./-]+)`/g))
      assert.ok(existsSync(join(cfg.root, m[1]!)), `a built note names ${m[1]}, which is not there`);
  }
});

/**
 * The other direction, which had no check and cost real work.
 *
 * The test above asks whether an item *claimed* built names something real. Nothing asked whether an
 * item still open names something that already exists — so `adhd why`, `adhd diff`, `adhd lint`, the
 * kernel's token budget, run priority, journal compaction and the TTY progress line all sat open in
 * this file after they were built. Picking twenty items to do and finding seven of them already done
 * is the cheap version of that mistake; building one of them again is the expensive version.
 *
 * Scoped to `adhd <command>` in an item's own title, which is the claim strong enough to check
 * mechanically. An item whose title names a command the CLI has is either done or badly titled, and
 * both want editing.
 */
test("no open backlog item names a command the CLI already has", () => {
  const backlog = readFileSync(join(cfg.root, "docs", "BACKLOG.md"), "utf8");
  const cli = readFileSync(join(cfg.root, "src", "cli.ts"), "utf8");
  const commands = new Set([...cli.matchAll(/\.command\("([\w-]+)/g)].map((m) => m[1]!));

  const stale: string[] = [];
  for (const line of backlog.split("\n")) {
    const item = line.match(/^(\d+)\. (.*)$/);
    if (!item || item[2]!.startsWith("~~")) continue;
    // An item *proposes* a command when its bolded title **is** that command — "**`adhd why <run>
    // <frame>`.**" — which is how every built one in this file was written. A title that merely names
    // a command is reasoning from it, not asking for it.
    //
    // I got this wrong twice before settling here, both times in the direction the check exists to
    // catch: a rule firing on something it was not about. Taking the whole line flagged item 68, whose
    // title is "Recalibrate `tokens_per_branch_estimate`" and which cites `adhd cost` as evidence on
    // the same line. Taking the bolded title flagged item 70, "Two fixture assertions that `adhd lint`
    // flags", which is about two assertions and not about the linter.
    const proposed = item[2]!.match(/^\*\*`adhd ([a-z][\w-]*)/)?.[1];
    if (proposed && commands.has(proposed)) {
      stale.push(`item ${item[1]} proposes \`adhd ${proposed}\`, which exists`);
    }
  }
  assert.deepEqual(stale, [], `the backlog is stale:\n  ${stale.join("\n  ")}`);
});

// ---- badges --------------------------------------------------------------------------------
// A badge is a claim with a number in it, rendered where it is read first and rechecked never.
// The workflow ones keep themselves honest because GitHub renders live status; the static ones
// do not, so they are checked here against the thing they describe.

const BADGES = [...README.matchAll(/<img src="([^"]+)"[^>]*alt="([^"]*)"/g)].map((m) => ({ src: m[1]!, alt: m[2]! }));

test("every workflow badge names a workflow that exists, and every branch-triggered workflow has one", () => {
  const dir = join(cfg.root, ".github", "workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  const badged = new Set(BADGES.map((b) => b.src.match(/actions\/workflows\/([^/]+)\/badge\.svg/)?.[1]).filter(Boolean) as string[]);

  for (const f of badged) assert.ok(files.includes(f), `a badge points at ${f}, which is not in .github/workflows`);

  // A workflow that only fires on a tag renders "no status" forever, which reads as broken rather
  // than as idle. So the rule is every workflow a branch or a schedule can trigger, and no other.
  const branchTriggered = files.filter((f) => {
    const body = readFileSync(join(dir, f), "utf8");
    const end = body.indexOf("\npermissions:");
    const on = body.slice(body.indexOf("\non:"), end === -1 ? undefined : end + 1);
    return /^\s*(push|pull_request|schedule):/m.test(on) && !/^\s*push:\s*\n\s*tags:/m.test(on);
  });
  assert.deepEqual([...badged].sort(), branchTriggered.sort(), "the badge row and the branch-triggered workflows disagree");
});

test("the static badges state numbers the repository actually has", () => {
  // shields encodes a badge as `/badge/<label>-<message>-<colour>` and escapes a literal hyphen
  // inside either as `--`. Splitting on the first hyphen returns "D1" from "D1--D12 resolved",
  // which is how a drifting badge passes a check that thinks it is reading the whole message.
  const value = (label: string): string => {
    const b = BADGES.find((x) => x.src.includes(`/badge/${label}-`));
    assert.ok(b, `no badge labelled ${label}`);
    const rest = b.src.split(`/badge/${label}-`)[1]!;
    const message = rest.slice(0, rest.lastIndexOf("-"));
    return decodeURIComponent(message).replace(/--/g, "-");
  };

  const tests = readdirSync(join(cfg.root, "test"))
    .filter((f) => f.endsWith(".test.ts"))
    .reduce((n, f) => n + (readFileSync(join(cfg.root, "test", f), "utf8").match(/^test\(/gm) ?? []).length, 0);
  assert.equal(Number(value("tests")), tests, "the tests badge has drifted from test/");

  const pkg = JSON.parse(readFileSync(join(cfg.root, "package.json"), "utf8")) as { license: string; engines: { node: string } };
  assert.equal(value("license"), pkg.license);
  assert.equal(value("node"), pkg.engines.node, "the node badge disagrees with engines.node");

  const decisions = readFileSync(join(cfg.root, "docs", "DECISIONS.md"), "utf8");
  const highest = Math.max(...(decisions.match(/^## D(\d+)\./gm) ?? []).map((h) => Number(h.match(/\d+/)![0])));
  assert.equal(value("decisions"), `D1-D${highest} resolved`, "the decisions badge has drifted");
});

/**
 * The one badge rule that is about honesty rather than drift. `ai-adhd` is not on npm and the MCP
 * server is not in the registry, both waiting on a token only the owner can add (D11). A version
 * badge for either renders "invalid" or "not found", which reads as a broken project rather than
 * an unpublished one, and a green one would be a claim that is not true yet.
 */
test("no badge advertises a registry the package has not been published to", () => {
  for (const b of BADGES) {
    assert.ok(!/img\.shields\.io\/npm\//.test(b.src), "an npm badge, and ai-adhd is not published (see docs/DISTRIBUTION.md)");
    assert.ok(!/img\.shields\.io\/pypi\//.test(b.src), "a PyPI badge, and adhd-analysis is not published");
    assert.ok(!/coverage/i.test(b.alt), "a coverage badge, and nothing in this repository measures coverage");
  }
});

/**
 * The README's fixture-001 table is a claim with numbers in it, and the numbers come from a report
 * the repository can run. It drifted once already: the paragraph said the seed-2 misses were
 * "properties of one sample, not of the frame library", E1b ran afterwards and showed `retry_cost`
 * missing under a different frame set too, and nothing carried the correction back to the page
 * anybody reads first.
 */
test("the README's fixture 001 rates are the rates the audit computes", async () => {
  const { auditFixtures } = await import("../src/eval.js");
  const items = auditFixtures(cfg).items.filter((i) => i.fixture === "001" && i.kind === "must_surface");
  assert.ok(items.length >= 4, "fixture 001 lost its must_surface items");

  const table = README.split("\n").filter((l) => /^\|/.test(l));
  for (const i of items) {
    const rate = `${i.real_matched}/${i.real_total}`;
    assert.ok(
      table.some((l) => l.includes(`| ${rate} |`) || l.includes(`| **${rate}** |`)),
      `the audit rates 001/${i.item} at ${rate} and no README table row states it`,
    );
  }

  // The specific sentence that was wrong. `sometimes` means the frame library is implicated, so the
  // page must not be back to explaining these away as one sample.
  if (items.some((i) => i.verdict === "sometimes"))
    assert.ok(
      !/properties of one sample, not of the frame library/.test(README),
      "an assertion only some real runs surface is being described as a property of one sample",
    );
});

/**
 * The worked example quotes real command output, which is the only thing that makes it worth
 * having and also the thing that rots. A renderer change, a reworded detector, a new frame name:
 * any of them turns a quoted block into a confident lie, and a document whose whole claim is
 * "every block here is what it printed" fails harder than one that never claimed it.
 *
 * Checked mechanically rather than by rereading: the blocks that come from files on disk are
 * compared to those files, and the hash is compared to the plan that produced it.
 */
test("the worked example still quotes what the run actually says", () => {
  const doc = readFileSync(join(cfg.root, "docs", "WORKED-EXAMPLE.md"), "utf8");
  const runDir = join(cfg.root, "evals", "recorded", "001-first-run");
  const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as { problem_hash: string };

  // The hash appears four times in the document and is the one claim everything else rests on.
  const quoted = [...doc.matchAll(/sha256:[0-9a-f]{64}/g)].map((m) => m[0]);
  assert.ok(quoted.length >= 3, "the worked example should quote the hash");
  for (const h of new Set(quoted)) assert.equal(h, plan.problem_hash, "a hash in the worked example is not this run's");

  // Each bullet of the pruned block, as the synthesis actually renders it today.
  const synth = readFileSync(join(runDir, "synthesis.md"), "utf8");
  const block = synth.slice(synth.indexOf("## Pruned, with reason"));
  const bullets = block.split("\n").filter((l) => l.startsWith("  - detector output:"));
  assert.equal(bullets.length, 2, "001-first-run prunes two frames");
  for (const b of bullets) assert.ok(doc.includes(b), `the worked example's pruned block has drifted:\n${b.slice(0, 120)}`);

  // And the brief excerpt, which is what shows a branch is handed no sibling.
  const brief = readFileSync(join(runDir, "briefs", "LEDGER.md"), "utf8");
  assert.ok(doc.includes(brief.split("\n").slice(0, 5).join("\n")), "the quoted brief opening has drifted");
});

/**
 * And the isolation claim the document makes about that brief is the one a reader is most likely
 * to take on trust, so it is checked against the brief rather than asserted in prose.
 */
test("the brief the worked example quotes really does name no sibling", () => {
  const runDir = join(cfg.root, "evals", "recorded", "001-first-run");
  const brief = readFileSync(join(runDir, "briefs", "LEDGER.md"), "utf8");
  for (const f of cfg.frames.frames) {
    if (f.id === "LEDGER") continue;
    assert.ok(!new RegExp(`\\b${f.id}\\b`).test(brief), `${f.id} appears in LEDGER's brief`);
  }
  assert.ok(!/so far/i.test(brief));
  assert.ok(!/\b(five|5) branches\b/i.test(brief), "the brief states the branch count");
});
