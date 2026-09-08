import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { completions, demoScript, initConfig, verbsUsedByDemo } from "../src/scaffold.js";

const CLI = join(process.cwd(), "dist", "src", "cli.js");

/** Every verb the CLI actually registers, top level and under `os`. */
function verbs(): { top: string[]; os: string[] } {
  const help = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  const osHelp = execFileSync(process.execPath, [CLI, "os", "--help"], { encoding: "utf8" });
  const parse = (t: string) =>
    t
      .split("\n")
      .map((l) => /^\s{2}([a-z][a-z-]*)\b/.exec(l)?.[1])
      .filter((x): x is string => Boolean(x) && x !== "help");
  return { top: [...new Set(parse(help))].sort(), os: [...new Set(parse(osHelp))].sort() };
}

test("init copies the shipped library and refuses to overwrite somebody's work", () => {
  // The point is not saving typing: config/ is the product, and the shipped library is the only
  // thing in the repo with recorded runs behind it. Starting from it and editing means D6's
  // orthogonality check is meaningful from the first change, because there is something to be
  // orthogonal to.
  const dest = join(tmp(), "extended");
  const first = initConfig(cfg, dest);
  assert.ok(first.written.includes(join("config", "frames.yaml")));
  assert.ok(first.written.some((w) => w.startsWith("prompts")));
  assert.deepEqual(first.skipped, []);

  // The copy is a working repository root: it validates on its own.
  const copied = loadConfig(dest);
  assert.equal(copied.frames.frames.length, cfg.frames.frames.length);

  writeFileSync(join(dest, "config", "frames.yaml"), "# edited by hand\n");
  const second = initConfig(cfg, dest);
  assert.ok(second.skipped.includes(join("config", "frames.yaml")));
  assert.ok(!second.written.includes(join("config", "frames.yaml")), "init overwrote an edited file");
  assert.match(readFileSync(join(dest, "config", "frames.yaml"), "utf8"), /edited by hand/);

  const forced = initConfig(cfg, dest, { force: true });
  assert.ok(forced.written.includes(join("config", "frames.yaml")));
  assert.match(first.text, /D6's orthogonality check first/);
});

test("completions are generated from the real command list, so they cannot name a verb that is gone", () => {
  // Hand-written completions go stale the first time a command is added and nobody notices,
  // because nothing tests them.
  const v = verbs();
  assert.ok(v.top.length > 10, `only found ${v.top.join(", ")}`);
  for (const shell of ["bash", "zsh"]) {
    const script = completions(shell, v.top, v.os);
    for (const verb of v.top) assert.ok(script.includes(verb), `${shell} completion omits ${verb}`);
    for (const verb of v.os) assert.ok(script.includes(verb), `${shell} completion omits os ${verb}`);
  }
  assert.throws(() => completions("fish", v.top, v.os), (e: Error) => e.name === "UsageError" && /unknown shell fish/.test(e.message));
});

test("the generated completion scripts are what the CLI emits", () => {
  const v = verbs();
  for (const shell of ["bash", "zsh"]) {
    const emitted = execFileSync(process.execPath, [CLI, "completions", shell], { encoding: "utf8" });
    assert.equal(emitted.trimEnd(), completions(shell, v.top, v.os).trimEnd(), `${shell} output drifted from the generator`);
  }
});

test("the demo names only verbs the CLI has, and says why it cannot show a run", () => {
  // A demo that implied it had just reasoned would misrepresent the one design decision the
  // whole repository is built on. It stops at the D5 gate and says so.
  const script = join(cfg.root, "scripts", "demo.sh");
  assert.ok(existsSync(script), "scripts/demo.sh is missing");
  const v = verbs();
  for (const verb of verbsUsedByDemo(cfg.root)) assert.ok(v.top.includes(verb), `the demo runs \`adhd ${verb}\`, which the CLI does not have`);

  const text = readFileSync(script, "utf8");
  assert.match(text, /never calls a model/);
  assert.match(text, /Nothing has been spent/);
  assert.match(text, /No model was called/);
  assert.equal(text.trimEnd(), demoScript().trimEnd(), "scripts/demo.sh drifted from its generator");
});

test("the devcontainer builds and tests on create, and claims no inference", () => {
  const p = join(cfg.root, ".devcontainer", "devcontainer.json");
  assert.ok(existsSync(p));
  const dc = JSON.parse(readFileSync(p, "utf8")) as { postCreateCommand: string; image: string };
  assert.match(dc.postCreateCommand, /npm ci/);
  assert.match(dc.postCreateCommand, /npm test/);
  assert.match(dc.image, /node:2[0-9]/, "the image has to be a Node the package supports (engines: >=20)");
  assert.match(readFileSync(join(cfg.root, ".devcontainer", "README.md"), "utf8"), /Nothing here supplies inference/);
});

test("the library workflow gates on the checks and reports the evidence without gating on it", () => {
  // frames --orthogonality exits non-zero on a flagged pair, and the one pair it flags today is
  // one docs/RETIREMENT.md says explicitly to watch and not act on. Gating on it would fail a PR
  // for a co-clustering rate the policy refuses to act on at this sample size.
  const p = join(cfg.root, ".github", "workflows", "library.yml");
  assert.ok(existsSync(p));
  const yml = readFileSync(p, "utf8");
  // Each gate is matched as a literal, so a verb gaining a regex metacharacter cannot silently
  // turn this assertion into a looser one.
  const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const gate of ["validate", "doctor", "lint", "eval", "eval --gate"]) assert.match(yml, new RegExp(`cli\\.js ${literal(gate)}`));
  // The reports tolerate a non-zero exit; the gates do not.
  assert.match(yml, /frames --orthogonality \|\| true/);
  assert.match(yml, /eval --audit \|\| true/);
  assert.ok(!/cli\.js validate \|\| true/.test(yml), "a gate was made tolerant");
  for (const path of ["config/**", "prompts/**", "evals/fixtures/**", "agents/**"]) assert.ok(yml.includes(path), `${path} does not trigger the library workflow`);
  assert.match(yml, /permissions:\n\s+contents: read/, "the token must not take default scope");
});

test("CodeQL scans the default branch, not only a feature branch", () => {
  // It was configured against `claude/adhd-architecture-build-jlyjk2` alone, so nothing scanned
  // main: every merge landed unscanned code on the branch that ships. The scan on the PR is what
  // made it look covered.
  const yml = readFileSync(join(cfg.root, ".github", "workflows", "codeql.yml"), "utf8");
  // Comment lines are allowed between the trigger and its branch list, which an earlier version
  // of this pattern was not, so it read a real fix as still broken.
  const pushBranches = /push:\n(?:\s*#.*\n)*\s+branches:\s*\[([^\]]*)\]/.exec(yml)?.[1] ?? "";
  assert.ok(/\bmain\b/.test(pushBranches), `CodeQL push branches are [${pushBranches}] and do not include main`);
  const prBranches = /pull_request:\n(?:\s*#.*\n)*\s+branches:\s*\[([^\]]*)\]/.exec(yml)?.[1] ?? "";
  assert.ok(/\bmain\b/.test(prBranches), `CodeQL pull_request branches are [${prBranches}] and do not include main`);
});

test("every workflow declares its permissions", () => {
  // test.yml had no permissions block once, so the token took default scope. Checked for all of
  // them rather than that one, because the next workflow is the one nobody remembers.
  // Either at the top or per job. Per job is narrower and codeql.yml does it that way, which an
  // earlier version of this test called a failure.
  const dir = join(cfg.root, ".github", "workflows");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.match(text, /^\s*permissions:/m, `.github/workflows/${f} declares no permissions at any level`);
  }
});

test("the published package is enough to run the CLI, the doctor and the demo", () => {
  // Three defects found by building this: `scripts/demo.sh` was published while the corpus it
  // reads was not, the demo ran `npm run build` against a tsconfig.json that is not published,
  // and `files` omitted agents/, skills/ and .claude-plugin/ — so `adhd doctor` errored on an
  // installed copy and the Claude Code plugin, one of the four v0 deliverables, shipped as
  // nothing at all. This is the same family as the hygiene sweep's defect 55 (every entry point
  // pointed at a path the build did not emit) and 16 (the README referenced assets/ and no
  // files entry published it), and the reason it keeps happening is that development never
  // exercises the published layout.
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8", cwd: cfg.root, stdio: ["ignore", "pipe", "ignore"] })) as [{ files: { path: string }[] }];
  const published = new Set(packed[0].files.map((f) => f.path));

  // Everything the plugin manifest and the run dispatch need has to be in the tarball.
  for (const required of [".claude-plugin/plugin.json", "config/frames.yaml", "config/routing.yaml", "config/critic-rubric.yaml", "docs/TRAPS.md", "dist/src/cli.js"])
    assert.ok(published.has(required), `${required} is not published, and something at runtime reads it`);
  for (const agent of ["adhd-branch", "adhd-branch-search", "adhd-critic", "adhd-deepen"])
    assert.ok(published.has(`agents/${agent}.md`), `agents/${agent}.md is not published; a run dispatches to it`);

  // And nothing that would be a mistake to ship.
  for (const p of published) {
    assert.ok(!p.startsWith("test/"), `${p} is published`);
    assert.ok(!p.startsWith("runs/"), `${p} is published`);
    assert.ok(!/(^|\/)\.env|\.key$|id_rsa/.test(p), `${p} looks like a secret`);
  }
  // The corpus is evidence rather than runtime, and 40 MB of artifacts in every install to
  // support a demo is the wrong trade. The demo says so rather than failing four steps.
  assert.ok(![...published].some((p) => p.startsWith("evals/recorded/")), "the recorded corpus is being published");
  assert.match(readFileSync(join(cfg.root, "scripts", "demo.sh"), "utf8"), /if \[ ! -d evals\/recorded \]/);
  assert.match(readFileSync(join(cfg.root, "scripts", "demo.sh"), "utf8"), /if \[ -f tsconfig\.json \]/, "the demo rebuilds unconditionally and a published copy has no tsconfig");
});
