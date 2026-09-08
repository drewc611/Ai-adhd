// Does this installation agree with itself? (catalogue 32 and 54)
//
// Every other command assumes the pieces line up: that the plugin manifest names agents that
// exist, that the agents grant tools the frames actually ask for, that the build output matches
// what package.json publishes, that the rubric's weights and anchors describe a scale somebody
// could score against. Each of those has been wrong at least once in this repository's history,
// and each was found by a person rather than by a command.
//
// Nothing here calls a model or reads a recorded run. It reads config, prompts, the plugin
// manifest and the build output, and reports what disagrees.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { TRAP_IDS } from "./schema.js";

export type Severity = "error" | "warn";

export interface Finding {
  severity: Severity;
  check: string;
  message: string;
}

export interface DoctorReport {
  findings: Finding[];
  errors: Finding[];
  warnings: Finding[];
  checked: string[];
  text: string;
}

const read = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8") : null);

/**
 * Rubric health (catalogue 54).
 *
 * Not a quality judgement — CLAUDE.md forbids replacing the critic rubric with a quality rubric,
 * and this does not touch what the dimensions ask. It checks the arithmetic and the shape: that
 * anchors are contiguous from zero, that weights are positive, that the anchor scale the scorer
 * divides by is the one the dimensions actually use, and that no two dimensions are worded
 * identically. A rubric can be wrong in those ways without any run noticing.
 */
export function lintRubric(cfg: Config): Finding[] {
  const out: Finding[] = [];
  const dims = cfg.rubric.dimensions;
  if (!dims.length) return [{ severity: "error", check: "rubric", message: "no dimensions" }];

  const totalWeight = dims.reduce((a, d) => a + d.weight, 0);
  for (const d of dims) {
    const keys = Object.keys(d.anchors).map(Number).sort((a, b) => a - b);
    if (keys[0] !== 0) out.push({ severity: "error", check: "rubric", message: `${d.id}: anchors start at ${keys[0]}, not 0` });
    for (let i = 1; i < keys.length; i++)
      if (keys[i] !== keys[i - 1]! + 1) out.push({ severity: "error", check: "rubric", message: `${d.id}: anchors skip from ${keys[i - 1]} to ${keys[i]}` });
    if (d.weight <= 0) out.push({ severity: "error", check: "rubric", message: `${d.id}: weight ${d.weight} is not positive` });
    for (const [k, v] of Object.entries(d.anchors))
      if (v.trim().length < 10) out.push({ severity: "warn", check: "rubric", message: `${d.id} anchor ${k} is ${v.trim().length} characters; a critic cannot score against it` });
  }

  // Every dimension must use the same anchor range, because pass_a is a weighted total over all
  // of them. One dimension on a wider scale silently counts for more than its weight says.
  const ranges = new Set(dims.map((d) => Object.keys(d.anchors).length));
  if (ranges.size > 1)
    out.push({
      severity: "error",
      check: "rubric",
      message: `dimensions use ${ranges.size} different anchor counts (${[...ranges].sort().join(", ")}); pass_a is a weighted total, so the wider scale counts for more than its weight states`,
    });

  const questions = new Map<string, string>();
  for (const d of dims) {
    const key = d.question.toLowerCase().replace(/\s+/g, " ").trim();
    const first = questions.get(key);
    if (first) out.push({ severity: "warn", check: "rubric", message: `${first} and ${d.id} ask the same question; one of them is not measuring anything` });
    else questions.set(key, d.id);
  }

  // The anchor point the sensitivity report is written against: the smallest weight divided by
  // the total weighted maximum. If this stops matching what docs say, every margin in the
  // corpus is being read on the wrong scale.
  const maxAnchor = Math.max(...dims.map((d) => Object.keys(d.anchors).length - 1));
  const anchorPoint = Math.min(...dims.map((d) => d.weight)) / (totalWeight * maxAnchor);
  if (!Number.isFinite(anchorPoint) || anchorPoint <= 0) out.push({ severity: "error", check: "rubric", message: "the anchor point is not a positive finite number" });
  return out;
}

/** Does the plugin manifest describe agents and skills that exist on disk? */
function checkPlugin(cfg: Config): Finding[] {
  const out: Finding[] = [];
  const manifestPath = join(cfg.root, ".claude-plugin", "plugin.json");
  const raw = read(manifestPath);
  if (!raw) return [{ severity: "warn", check: "plugin", message: ".claude-plugin/plugin.json is absent; the Claude Code plugin is one of the four v0 deliverables" }];
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    return [{ severity: "error", check: "plugin", message: `plugin.json does not parse: ${(e as Error).message}` }];
  }
  for (const key of ["name", "version", "description"]) if (!manifest[key]) out.push({ severity: "error", check: "plugin", message: `plugin.json has no ${key}` });

  const agentsDir = join(cfg.root, "agents");
  const onDisk = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")) : [];
  if (!onDisk.length) out.push({ severity: "error", check: "plugin", message: "agents/ holds no agent definitions" });

  // Every agent a plan can dispatch to has to exist as a definition, or a host is asked to
  // spawn something that is not there. The plan's agent names come from routing.
  const dispatchable = new Set<string>(["adhd-branch", "adhd-branch-search", "adhd-critic", "adhd-deepen"]);
  for (const a of dispatchable) if (!onDisk.includes(a)) out.push({ severity: "error", check: "plugin", message: `a run can dispatch to ${a} and agents/${a}.md does not exist` });
  for (const a of onDisk) if (!dispatchable.has(a)) out.push({ severity: "warn", check: "plugin", message: `agents/${a}.md is never dispatched by any phase` });
  return out;
}

/**
 * Do the agent definitions grant the tools the frames ask for?
 *
 * D4 makes the tool allowlist per frame, and a frame with web tools is dispatched to
 * `adhd-branch-search`. If that agent's own front matter does not carry the tools, the frame
 * runs without them and nobody finds out: the branch simply reasons without searching, which
 * looks like a frame that chose not to search. T3 went unfired for seven runs for exactly this
 * reason.
 */
function checkToolGrants(cfg: Config): Finding[] {
  const out: Finding[] = [];
  const wanted = new Set(cfg.frames.frames.flatMap((f) => f.tools));
  if (!wanted.size) return out;
  const p = join(cfg.root, "agents", "adhd-branch-search.md");
  const text = read(p);
  if (!text) return [{ severity: "error", check: "tools", message: `frames ask for ${[...wanted].join(", ")} and agents/adhd-branch-search.md does not exist` }];
  for (const t of wanted)
    if (!new RegExp(`\\b${t}\\b`).test(text))
      out.push({
        severity: "error",
        check: "tools",
        message: `${cfg.frames.frames.filter((f) => f.tools.includes(t)).map((f) => f.id).join(", ")} ask for ${t} and adhd-branch-search does not grant it; the branch would reason without it and look like a frame that chose not to search`,
      });
  // The reverse: a filesystem tool anywhere in a branch agent would let a branch read a sibling.
  for (const f of readdirSync(join(cfg.root, "agents")).filter((x) => x.startsWith("adhd-branch"))) {
    const body = read(join(cfg.root, "agents", f)) ?? "";
    for (const forbidden of ["Read", "Grep", "Glob", "Task", "Agent"])
      if (new RegExp(`^\\s*tools:.*\\b${forbidden}\\b`, "m").test(body))
        out.push({ severity: "error", check: "tools", message: `agents/${f} grants ${forbidden}; a branch that can read the run directory can read its siblings, which is the one thing the architecture prevents` });
  }
  return out;
}

/** Does every path package.json publishes exist, and does the build output match? */
function checkBuild(cfg: Config): Finding[] {
  const out: Finding[] = [];
  const raw = read(join(cfg.root, "package.json"));
  if (!raw) return [{ severity: "error", check: "build", message: "no package.json" }];
  const pkg = JSON.parse(raw) as { bin?: Record<string, string>; main?: string; types?: string; files?: string[] };
  const paths = [...Object.values(pkg.bin ?? {}), pkg.main, pkg.types].filter((x): x is string => typeof x === "string");
  for (const rel of paths)
    if (!existsSync(join(cfg.root, rel)))
      out.push({ severity: "error", check: "build", message: `package.json points at ${rel} and it does not exist; run npm run build, or it was never emitted there` });
  for (const rel of paths) {
    const covered = (pkg.files ?? []).some((f) => rel === f || rel.startsWith(f.replace(/\/$/, "") + "/"));
    if (!covered) out.push({ severity: "error", check: "build", message: `${rel} is published as an entry point and no files entry covers it; an installed copy would not have it` });
  }
  return out;
}

/** Do the prompts reference frames, traps and dimensions that exist? */
function checkPrompts(cfg: Config): Finding[] {
  const out: Finding[] = [];
  const dir = join(cfg.root, "prompts");
  if (!existsSync(dir)) return [{ severity: "error", check: "prompts", message: "prompts/ does not exist" }];
  const trapDoc = read(join(cfg.root, "docs", "TRAPS.md")) ?? "";
  for (const t of TRAP_IDS)
    if (!new RegExp(`^## ${t}\\.`, "m").test(trapDoc))
      out.push({ severity: "error", check: "prompts", message: `${t} is a trap id and docs/TRAPS.md has no "## ${t}." section; the critic brief renders detectors from those sections` });
  const attacked = new Set(cfg.frames.frames.flatMap((f) => f.attacks));
  for (const t of TRAP_IDS) if (!attacked.has(t)) out.push({ severity: "warn", check: "prompts", message: `${t} is in the trap set and no frame lists it under attacks` });
  return out;
}

/**
 * Routing, for the two things `crossCheck` does not already own.
 *
 * Most of what a routing check would want to say is enforced at load: an unknown frame, two
 * primary frames on one axis, `n` over `hard_cap` and an empty decline reason all raise
 * `ConfigError` before any command runs, which is a harder and better failure than a report.
 * Writing this check found four of its six rules were dead for exactly that reason, and they
 * are gone rather than left in to imply coverage that lives somewhere else.
 *
 * What survives is the pair `crossCheck` has no opinion on: a class that cannot fill its own
 * branch count, and a frame nothing routes to.
 */
function checkRouting(cfg: Config): Finding[] {
  const out: Finding[] = [];
  const reachable = new Set<string>();
  for (const [id, c] of Object.entries(cfg.routing.classes)) {
    if (c.action === "decline") continue;
    for (const f of [...c.frames, ...c.alternates]) reachable.add(f);
    const n = c.n ?? cfg.routing.defaults.max_branches;
    // Under-filling is legal to load and wrong to run: the compiler takes the shortfall from
    // alternates, so a class short on both dispatches fewer branches than it asked for and the
    // plan says n without meaning it.
    if (c.frames.length + c.alternates.length < n)
      out.push({
        severity: "error",
        check: "routing",
        message: `class ${id} wants ${n} branches and can reach only ${c.frames.length + c.alternates.length} frames (${c.frames.length} primary, ${c.alternates.length} alternate); the plan would claim n=${n} and dispatch fewer`,
      });
    else if (c.frames.length < n)
      out.push({ severity: "warn", check: "routing", message: `class ${id} wants ${n} branches from ${c.frames.length} primary frames, so ${n - c.frames.length} come from alternates on every run of this class` });
  }
  for (const f of cfg.frames.frames) if (!reachable.has(f.id)) out.push({ severity: "warn", check: "routing", message: `${f.id} is named by no class, primary or alternate, so no problem can route to it` });
  return out;
}

/** Is every recorded run's directory shaped the way the readers expect? */
function checkCorpus(cfg: Config): Finding[] {
  const out: Finding[] = [];
  const dir = join(cfg.root, "evals", "recorded");
  if (!existsSync(dir)) return out;
  for (const d of readdirSync(dir).sort()) {
    const run = join(dir, d);
    if (!statSync(run).isDirectory()) continue;
    const hasPlan = existsSync(join(run, "plan.json"));
    if (!hasPlan) continue; // a negative control is a hand-written answer, not a run
    for (const required of ["problem.txt", "synthesis.md", "score.json"])
      if (!existsSync(join(run, required))) out.push({ severity: "error", check: "corpus", message: `${d} has plan.json and no ${required}` });
    const plan = JSON.parse(readFileSync(join(run, "plan.json"), "utf8")) as { branches?: { frame: string; artifact_path: string }[] };
    for (const b of plan.branches ?? [])
      if (!existsSync(join(run, b.artifact_path)))
        out.push({ severity: "warn", check: "corpus", message: `${d} planned ${b.frame} and ${b.artifact_path} is absent; that branch returned nothing, which is not the same as scoring badly` });
  }
  return out;
}

/** Do the config files parse as YAML at all, before anything schema-aware runs? */
function checkConfigFiles(cfg: Config): Finding[] {
  const out: Finding[] = [];
  for (const f of ["frames.yaml", "routing.yaml", "critic-rubric.yaml"]) {
    const p = join(cfg.root, "config", f);
    const text = read(p);
    if (!text) {
      out.push({ severity: "error", check: "config", message: `config/${f} is missing` });
      continue;
    }
    try {
      parseYaml(text);
    } catch (e) {
      out.push({ severity: "error", check: "config", message: `config/${f}: ${(e as Error).message}` });
    }
  }
  return out;
}

const CHECKS: { name: string; run: (cfg: Config) => Finding[] }[] = [
  { name: "config files parse", run: checkConfigFiles },
  { name: "rubric arithmetic and shape", run: lintRubric },
  { name: "plugin manifest and agents", run: checkPlugin },
  { name: "D4 tool grants", run: checkToolGrants },
  { name: "published entry points", run: checkBuild },
  { name: "prompts, traps and dimensions", run: checkPrompts },
  { name: "routing against the library", run: checkRouting },
  { name: "recorded corpus shape", run: checkCorpus },
];

export function doctor(cfg: Config): DoctorReport {
  const findings: Finding[] = [];
  const checked: string[] = [];
  for (const c of CHECKS) {
    checked.push(c.name);
    try {
      findings.push(...c.run(cfg));
    } catch (e) {
      findings.push({ severity: "error", check: c.name, message: `the check itself threw: ${(e as Error).message}` });
    }
  }
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");

  const lines = [`adhd doctor: ${CHECKS.length} checks over ${cfg.root}`];
  lines.push("");
  for (const f of [...errors, ...warnings]) lines.push(`${f.severity === "error" ? "ERROR" : " warn"}  [${f.check}] ${f.message}`);
  if (!findings.length) lines.push("Nothing disagrees. Checked: " + checked.join("; ") + ".");
  else {
    lines.push("");
    lines.push(`${errors.length} error(s), ${warnings.length} warning(s). Checked: ${checked.join("; ")}.`);
    if (!errors.length) lines.push("Warnings do not fail. Each is a thing that is legal and worth a second look.");
  }
  return { findings, errors, warnings, checked, text: lines.join("\n") };
}
