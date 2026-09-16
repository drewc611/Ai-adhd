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
import { STAGE_AGENT, STAGE_TOOLS } from "./super/index.js";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { RecordedExpectationSchema, TRAP_IDS } from "./schema.js";
import { frameReach, recordedDraws } from "./frames.js";
import { auditFixtures } from "./eval.js";
import { readJsonIf } from "./read.js";

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
  // Maintenance agents are deliberately outside the run. They are dispatched by the scheduled
  // workflows, not by a plan, and warning on them would train a reader to ignore this check. The
  // ban that matters for them is the reverse one below: they must not be reachable from a run.
  const maintenance = new Set<string>(["adhd-trainer", "adhd-governor", "adhd-steward"]);
  // Mission agents are dispatched by SuperAgent stages rather than run phases. Unlike the two sets
  // above this one is derived rather than listed: STAGE_AGENT is what the scheduler actually hands
  // a host, so a stage kind pointing at an agent nobody wrote is an error and not a warning.
  const mission = new Set(Object.values(STAGE_AGENT).filter((a): a is string => a !== null));
  for (const [kind, agent] of Object.entries(STAGE_AGENT)) {
    if (agent && !onDisk.includes(agent)) out.push({ severity: "error", check: "plugin", message: `stage kind ${kind} dispatches to ${agent} and agents/${agent}.md does not exist` });
  }
  for (const a of onDisk) if (!dispatchable.has(a) && !maintenance.has(a) && !mission.has(a)) out.push({ severity: "warn", check: "plugin", message: `agents/${a}.md is never dispatched by any phase or stage` });

  // The D4 argument, applied to stages. A stage's tool grant is data in STAGE_TOOLS, and the agent
  // that runs it declares its own in front matter; a stage granted a tool its agent does not carry
  // reasons without it and looks like an agent that chose not to use it.
  for (const [kind, tools] of Object.entries(STAGE_TOOLS)) {
    const agent = STAGE_AGENT[kind as keyof typeof STAGE_AGENT];
    if (!agent || !onDisk.includes(agent) || !mission.has(agent)) continue;
    const front = (read(join(cfg.root, "agents", `${agent}.md`)) ?? "").split("---")[1] ?? "";
    const declared = new Set((front.match(/^\s*tools:\s*(.+)$/m)?.[1] ?? "").split(",").map((t) => t.trim()).filter(Boolean));
    for (const t of tools)
      if (!declared.has(t))
        out.push({ severity: "error", check: "tools", message: `stage kind ${kind} grants ${t} and agents/${agent}.md does not declare it` });
    for (const t of declared)
      if (!(tools as readonly string[]).includes(t))
        out.push({ severity: "error", check: "tools", message: `agents/${agent}.md declares ${t} and no stage kind grants it` });
  }
  // D42. `agents/` is read only when the plugin is installed, and a session opened straight on a
  // clone installs nothing. `.claude/agents/` is the directory such a session does read, so a
  // shipped agent missing from the mirror is an agent that does not exist as far as a dispatch is
  // concerned: the spawn is refused on the name, before the permit above is ever consulted.
  const shipped = Array.isArray(manifest["agents"]) ? (manifest["agents"] as string[]).map((a) => a.replace(/^\.\/agents\//, "")) : [];
  const mirrorDir = join(cfg.root, ".claude", "agents");
  if (!existsSync(mirrorDir))
    out.push({ severity: "error", check: "plugin", message: ".claude/agents does not exist, so a session opened on this repository resolves none of the agents a run dispatches to; run node scripts/sync-claude-agents.mjs" });
  else {
    const mirrored = readdirSync(mirrorDir).filter((f) => f.endsWith(".md"));
    for (const file of shipped) {
      if (!mirrored.includes(file))
        out.push({ severity: "error", check: "plugin", message: `.claude/agents/${file} is missing, so ${file.replace(/\.md$/, "")} resolves to no agent without the plugin installed; run node scripts/sync-claude-agents.mjs` });
      else if (read(join(mirrorDir, file)) !== read(join(cfg.root, "agents", file)))
        out.push({ severity: "error", check: "plugin", message: `.claude/agents/${file} has drifted from agents/${file}; run node scripts/sync-claude-agents.mjs` });
    }
    for (const file of mirrored)
      if (!shipped.includes(file))
        out.push({ severity: "error", check: "plugin", message: `.claude/agents/${file} is not shipped by plugin.json; a maintenance agent in the mirror is loaded by every session opened on this repository` });
  }

  for (const a of maintenance) {
    if (!onDisk.includes(a)) continue;
    const body = read(join(cfg.root, "agents", `${a}.md`)) ?? "";
    if (/^\s*tools:.*\b(Task|Agent)\b/m.test(body))
      out.push({ severity: "error", check: "plugin", message: `agents/${a}.md can spawn agents; a maintenance agent that can start a run is a path from a scheduled job into the reasoning the run is supposed to isolate` });
  }
  return out;
}

/** The four agents a run dispatches to. None of them may reach what another one wrote. */
const ISOLATED_AGENTS = ["adhd-branch", "adhd-branch-search", "adhd-critic", "adhd-deepen"] as const;

/**
 * Permits that both resolve in a Claude Code host and cannot read the run directory. This is the
 * whole list, and it is short on purpose: every other tool name is either a filesystem tool or
 * unproven to launch. `adhd-branch-search` has spawned on exactly this pair.
 */
const RESOLVING_PERMITS = ["WebSearch", "WebFetch"];

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
  for (const f of ISOLATED_AGENTS) {
    const body = read(join(cfg.root, "agents", `${f}.md`)) ?? "";
    if (!body) {
      out.push({ severity: "error", check: "tools", message: `agents/${f}.md does not exist and a run dispatches to it` });
      continue;
    }
    const declared = (/^\s*tools:\s*(.+)$/m.exec(body)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);

    // A filesystem tool would let one of these read what a sibling wrote.
    for (const forbidden of ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Task", "Agent", "NotebookEdit"])
      if (declared.includes(forbidden))
        out.push({ severity: "error", check: "tools", message: `agents/${f}.md grants ${forbidden}; an isolated agent that can read the run directory can read its siblings, which is the one thing the architecture prevents` });

    /*
     * And the defect that shipped: a permit nobody checked would resolve. `adhd-branch`,
     * `adhd-critic` and `adhd-deepen` all declared `TodoWrite, TaskList`, and this host answers
     * "unrecognized [TodoWrite]; recognized but matched no tools in this session [TaskList]" and
     * refuses the spawn. The three agents that *are* the architecture could not start, every
     * recorded run fell back to `general-purpose` — which grants everything, including Read —
     * and `doctor` printed no errors the whole time.
     *
     * The host will not launch an agent with zero tools, so isolation cannot be expressed as an
     * empty list. It is expressed as a permit that resolves and reaches nothing the run wrote,
     * which leaves exactly the web pair, plus the brief text telling the agent not to use it and
     * detector T3 catching it if it does.
     */
    if (!declared.length)
      out.push({ severity: "error", check: "tools", message: `agents/${f}.md declares no tools; the host refuses to launch an agent with none, so this agent cannot start at all` });
    for (const t of declared)
      if (!RESOLVING_PERMITS.includes(t))
        out.push({
          severity: "error",
          check: "tools",
          message: `agents/${f}.md declares ${t}, which is not a permit known to resolve. An isolated agent's tools must be a non-empty subset of ${RESOLVING_PERMITS.join(", ")}: anything else either reaches the run directory or fails to launch`,
        });
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

  // Being named is weaker than being reachable, and the difference is a whole frame. The check
  // above passes any frame appearing in some class's `alternates`, but a class whose default `n` is
  // at most the length of its primary list never draws an alternate at all — so a frame that is
  // only ever an alternate is named six times and dispatched never. `FIRST_PRINCIPLES` was in that
  // position and `--stats` could only report it as having no runs, which is what bad luck also looks
  // like. This asks the real selector instead.
  //
  // A fixture states a class and lets routing choose, so an unreachable frame cannot have one, and a
  // run that never dispatches it cannot produce evidence for or against keeping it. That is a
  // decision rather than a defect, which is why this warns and names where the decision lives.
  const reach = frameReach(cfg);
  for (const id of reach.unreachable_at_default) {
    if (!reachable.has(id)) continue; // already reported above, for a blunter reason
    const f = reach.frames.find((x) => x.frame === id)!;
    const named = Object.values(cfg.routing.classes).filter((c) => c.action === "run" && c.alternates.includes(id)).length;
    out.push({
      severity: "warn",
      check: "routing",
      message:
        `${id} is an alternate in ${named} class(es) and primary in none, so no class dispatches it at its default n` +
        (reach.proved_unreachable.includes(id) ? " — by construction, not by sampling" : ` in ${reach.seeds} seeded shuffles`) +
        (f.blocked_by.length ? `; ${f.blocked_by.join(", ")} hold${f.blocked_by.length === 1 ? "s" : ""} its axis (${f.axis}) in the primary lists` : "") +
        ". Route it or retire it: see docs/RETIREMENT.md and `adhd frames --reach`",
    });
  }
  return out;
}

/**
 * What an overlay changed, reported rather than assumed (D33).
 *
 * A merge nobody can see is the failure mode the item warned about: the loaded library is one file
 * plus another and every report downstream speaks as though it were one file. `loadConfig` already
 * refuses a merge that breaks a cross-check, so this is not validation — it is the line that tells a
 * reader of `adhd frames` or `adhd why` which definitions they are reading.
 */
function checkOverlay(cfg: Config): Finding[] {
  const o = cfg.overlay;
  if (!o) return [];
  const out: Finding[] = [
    {
      severity: "warn",
      check: "overlay",
      message:
        `${o.path} (${o.hash}) is applied: ` +
        [
          o.replaced_frames.length ? `${o.replaced_frames.length} frame(s) replaced (${o.replaced_frames.join(", ")})` : null,
          o.added_frames.length ? `${o.added_frames.length} added (${o.added_frames.join(", ")})` : null,
          o.replaced_classes.length ? `${o.replaced_classes.length} routing class(es) replaced (${o.replaced_classes.join(", ")})` : null,
          o.added_classes.length ? `${o.added_classes.length} class(es) added (${o.added_classes.join(", ")})` : null,
          o.replaced_dimensions.length ? `${o.replaced_dimensions.length} rubric dimension(s) replaced (${o.replaced_dimensions.join(", ")})` : null,
        ]
          .filter(Boolean)
          .join("; ") +
        ". Every frame_hash below is the merged definition, and a recorded run carries this overlay hash so it can be traced back.",
    },
  ];
  // A replaced frame keeps its id and changes its `frame_hash`, which is exactly what `--drift`
  // reports as "the definition has changed since". That reading is right about the definition and
  // wrong about the cause, so it is worth saying once here rather than leaving a reader to infer it.
  if (o.replaced_frames.length)
    out.push({
      severity: "warn",
      check: "overlay",
      message:
        `\`adhd frames --drift\` will report ${o.replaced_frames.join(", ")} as changed for any run recorded under a different library. ` +
        "That is the definition genuinely differing, not a rewrite of history: compare the plan's overlay hash before concluding a frame was edited.",
    });
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

  /*
   * D41. Which recordings say what actually produced them?
   *
   * `plan.json` records the agent a run intended for each branch. Every recorded run carries
   * `"agent": "adhd-branch"` and that agent could not launch in any host tried, so for all fifteen
   * the field is an intention that was not met and nothing anywhere says so. A warning rather than
   * an error because the recordings predate the file and rewriting them would destroy the evidence;
   * what it must not do is read as clean.
   */
  const undispatched = readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, "plan.json")) && !existsSync(join(dir, d, "dispatch.json")))
    .sort();
  if (undispatched.length)
    out.push({
      severity: "warn",
      check: "corpus",
      message: `${undispatched.length} recording(s) do not say which subagent type produced them, so their plan.json \`agent\` field is an intention rather than a fact: ${undispatched.join(", ")} (D41)`,
    });

  /*
   * A `replicate_of` pointing at nothing is silent otherwise: `recordedDraws` leaves the run as its
   * own draw, so the rates go back to counting it twice and the report reads the same as before the
   * field was added. That is exactly the state backlog 99 exists to prevent, so it is an error.
   */
  const draws = recordedDraws(dir);
  for (const d of readdirSync(dir).sort()) {
    if (!statSync(join(dir, d)).isDirectory()) continue;
    const e = readJsonIf(join(dir, d, "expected.json"), (v) => RecordedExpectationSchema.parse(v));
    const target = e?.replicate_of;
    if (!target) continue;
    if (!existsSync(join(dir, target)))
      out.push({ severity: "error", check: "corpus", message: `${d} declares replicate_of ${target} and no such recorded run exists, so it is counted as an independent draw` });
    else if (draws.get(d) === d)
      out.push({ severity: "error", check: "corpus", message: `${d} declares replicate_of ${target} and did not resolve to a draw; the chain is circular` });
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

/**
 * What the fixture audit already knows, said by the command people run to ask if anything is wrong.
 *
 * `adhd doctor` had eight checks and not one of them looked at a fixture assertion, so it printed
 * "Nothing disagrees" while `adhd eval --audit` was reporting that one assertion the consensus answer
 * also satisfies, one no real run has ever matched, and four that only some real runs surface. The
 * repository's regression suite is the thing it exists to defend, and the honest-status command was
 * the one place that never mentioned it.
 *
 * Warnings, not errors, and deliberately so. Every one of these is recorded and open — `003/reframe`
 * in the audit's own output, `retry_cost` in E3 — and a `sometimes` verdict is explicitly not a
 * failure. Turning a known state red would make the gate say "broken" about something the repository
 * has already written down and decided about. Silence was the defect; a red light is not the fix.
 */
function checkFixtureAssertions(cfg: Config): Finding[] {
  const { items } = auditFixtures(cfg);
  const out: Finding[] = [];
  for (const i of items) {
    const where = `${i.fixture}/${i.item}`;
    if (i.verdict === "matches a control")
      out.push({
        severity: "warn",
        check: "fixtures",
        message: `${where} is satisfied by a negative control, so it does not measure divergence (matched on "${(i.control_evidence ?? "").replace(/\s+/g, " ").slice(0, 60)}")`,
      });
    else if (i.verdict === "never matched")
      out.push({ severity: "warn", check: "fixtures", message: `${where} has never been matched by a real run; a stretch goal and an unreachable pattern look identical` });
    else if (i.verdict === "sometimes")
      out.push({ severity: "warn", check: "fixtures", message: `${where} holds in ${i.real_matched} of ${i.real_total} real runs; nothing in the dispatched frame set reliably asks it` });
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
  { name: "fixture assertions", run: checkFixtureAssertions },
  { name: "config overlay", run: checkOverlay },
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
