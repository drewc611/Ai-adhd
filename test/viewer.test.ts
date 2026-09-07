import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { buildViewer, collect, DATA_MARKER } from "../src/viewer.js";
import { ConfigError } from "../src/errors.js";

const data = collect(cfg);

test("every recorded run is collected, controls included and labelled", () => {
  assert.ok(data.runs.length >= 9, `expected at least 9 runs, got ${data.runs.length}`);
  const controls = data.runs.filter((r) => r.control).map((r) => r.id);
  assert.ok(controls.length >= 4, "the negative controls have to be visible, not filtered out");
  for (const c of controls) assert.match(c, /linear-cot/);
});

test("a real run carries its problem verbatim and the hash of that exact text", () => {
  const r = data.runs.find((x) => x.id === "002-kernel-enduser")!;
  assert.match(r.problem, /p99 latency spikes/);
  assert.match(r.problem_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(r.problem_class, "fuzzy_debugging");
});

/**
 * The position came out of `explainFrame`'s terminal report at first, which clips at 300
 * characters. A page has room; the clip was an artifact of the wrong source.
 */
test("positions come from score.json rather than the clipped terminal report", () => {
  for (const r of data.runs)
    for (const f of r.frames) {
      if (!f.position) continue;
      assert.ok(!f.position.endsWith("..."), `${r.id}/${f.frame}: position is the clipped display string`);
      const scored = JSON.parse(readFileSync(join(cfg.root, "evals", "recorded", r.id, "score.json"), "utf8")) as { frames: { frame: string; position: string | null }[] };
      const want = scored.frames.find((x) => x.frame === f.frame)?.position;
      if (want) assert.equal(f.position, want);
    }
});

/**
 * Every cluster has a representative; only one holds the answer. Deciding this in the page
 * lit up three frames at once on 001. It is decided in the collector now, and it has to agree
 * with the synthesis that run actually shipped.
 */
test("the frame the viewer says holds the recommendation is the one the synthesis names", () => {
  let checked = 0;
  for (const r of data.runs) {
    if (!r.synthesis || r.control) continue;
    const held = r.synthesis.match(/^Held by: ([^.]+)\./m)?.[1];
    if (!held) {
      assert.equal(r.recommendation, null, `${r.id}: the synthesis names no holder, so the viewer must not either`);
      continue;
    }
    assert.ok(r.recommendation, `${r.id}: the synthesis has a recommendation and the viewer found none`);
    assert.ok(held.includes(r.recommendation!), `${r.id}: viewer says ${r.recommendation}, synthesis says "${held}"`);
    checked++;
  }
  assert.ok(checked >= 3, `only ${checked} runs had a recommendation to check against`);
});

test("a run-level failure has no recommendation at all, whatever its clusters look like", () => {
  for (const r of data.runs)
    if (r.run_level?.monoculture || r.run_level?.scatter)
      assert.equal(r.recommendation, null, `${r.id} failed at run level and must not name a holder`);
});

test("each frame carries its detectors with the evidence that fired them", () => {
  const endUser = data.runs.find((r) => r.id === "002-kernel-enduser")!.frames.find((f) => f.frame === "END_USER")!;
  assert.equal(endUser.status, "pruned");
  assert.deepEqual(endUser.fired.map((t) => t.trap).sort(), ["T1", "T7", "T8"]);
  for (const t of endUser.fired) assert.ok(t.evidence.split(/\s+/).length > 10, `${t.trap}: evidence too thin to have pruned anything`);
  assert.equal(endUser.dimensions.length, cfg.rubric.dimensions.length);
});

test("the eval verdict travels with the run, so a run recorded as failing says so", () => {
  const failing = data.runs.filter((r) => r.eval && r.expected && r.eval.outcome !== r.expected.outcome);
  assert.deepEqual(failing, [], "no run should disagree with its own expectation");
  const withEval = data.runs.filter((r) => r.eval);
  assert.ok(withEval.length >= 9, "every recorded run should carry its eval result");
});

test("the page is one file with no external reference, so it opens from disk", () => {
  const html = buildViewer(cfg);
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/<(script|link|img)[^>]+(src|href)=["']https?:/i.test(html), "an external reference breaks the file offline");
  assert.ok(!html.includes(DATA_MARKER), "the data placeholder was not replaced");
  assert.match(html, /id="adhd-data"/);
});

/**
 * A problem statement is untrusted by this repo's own threat model, and it is inlined into the
 * page. The block is `type="application/json"`, so a `<script>` inside it is inert text; the
 * only thing that can go wrong is a `</script>` terminating the block early, which would
 * truncate the JSON and drop the rest of the page. So the test is that the block still parses.
 */
test("a closing script tag in a run's text cannot terminate the data block early", () => {
  const root = tmp();
  const dir = join(root, "900-hostile");
  mkdirSync(dir, { recursive: true });
  const hostile = "What about </script><script>alert(1)</script> and </SCRIPT foo> here?";
  writeFileSync(join(dir, "problem.txt"), hostile);
  writeFileSync(join(dir, "score.json"), JSON.stringify({ n: 0, frames: [], clusters: [], run_level: { monoculture: false, scatter: false, notes: [] }, proceed: true }));

  const html = buildViewer(cfg, { recordedDir: root });
  const open = html.indexOf('id="adhd-data"');
  const start = html.indexOf(">", open) + 1;
  const end = html.indexOf("</script>", start);
  const parsed = JSON.parse(html.slice(start, end)) as { runs: { id: string; problem: string }[] };

  assert.equal(parsed.runs.length, 1, "the block was truncated before the run");
  assert.equal(parsed.runs[0]!.id, "900-hostile");
  assert.equal(parsed.runs[0]!.problem, hostile, "the text round-trips unchanged, escaped only for the tag");
  assert.ok(!html.slice(start, end).includes("</script"), "an unescaped closing tag would have ended the block here");
});

test("a missing recorded directory is refused with a reason", () => {
  assert.throws(() => collect(cfg, join(tmp(), "nope")), ConfigError);
});

test("a shell without the data placeholder is refused rather than silently written empty", () => {
  const shell = join(tmp(), "shell.html");
  writeFileSync(shell, "<!doctype html><body>no placeholder</body>");
  assert.throws(() => buildViewer(cfg, { shell }), /no .* placeholder/);
});

test("the shipped shell declares the theme both ways, so it is readable in either", () => {
  const shell = readFileSync(join(cfg.root, "assets", "viewer.html"), "utf8");
  assert.match(shell, /@media \(prefers-color-scheme: dark\)/);
  assert.match(shell, /:root\[data-theme="dark"\]/);
  assert.match(shell, /:root:not\(\[data-theme="light"\]\)/, "an explicit light choice has to beat the system preference");
});
