import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  FramesFileSchema,
  RoutingFileSchema,
  RubricFileSchema,
  TRAP_IDS,
  type Frame,
  type FramesFile,
  type RoutingFile,
  type RubricFile,
} from "./schema.js";
import { ConfigError } from "./errors.js";

export interface Prompts {
  orchestrator: string;
  branch: string;
  criticPassA: string;
  criticPassB: string;
  deepen: string;
  synthesis: string;
  synthesisPartial: string;
}

export interface Config {
  root: string;
  frames: FramesFile;
  frameById: Map<string, Frame>;
  routing: RoutingFile;
  rubric: RubricFile;
  prompts: Prompts;
  trapsDoc: string;
}

/** Repo root: dist/src/config.js -> ../../ . Override with ADHD_ROOT or an explicit argument. */
export function resolveRoot(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.ADHD_ROOT) return resolve(process.env.ADHD_ROOT);
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function formatZod(err: z.ZodError, file: string): string[] {
  return err.issues.map((i) => `${file}: ${i.path.join(".") || "<root>"}: ${i.message}`);
}

function loadYaml<T>(path: string, schema: z.ZodType<T>, problems: string[]): T | undefined {
  if (!existsSync(path)) {
    problems.push(`${path}: missing`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    problems.push(`${path}: not valid YAML: ${(e as Error).message}`);
    return undefined;
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    problems.push(...formatZod(r.error, path));
    return undefined;
  }
  return r.data;
}

function readText(path: string, problems: string[]): string {
  if (!existsSync(path)) {
    problems.push(`${path}: missing`);
    return "";
  }
  return readFileSync(path, "utf8");
}

/**
 * The D6 static check plus cross file referential integrity. Runs on every load. A frame
 * library that fails here never reaches the compiler.
 */
/**
 * Every id a frame has ever had, current first. Takes a current id or a former one, so a caller
 * reading a recorded run does not have to know which era it came from.
 *
 * Renaming a frame is a D6 change and rare, so this is a linear scan over thirteen frames rather
 * than a cached map. Building the map per call would cost more than the scan.
 */
export function frameIdHistory(cfg: Config, id: string): string[] {
  const f = cfg.frames.frames.find((x) => x.id === id || x.former_ids.includes(id));
  return f ? [f.id, ...f.former_ids] : [id];
}

/**
 * Every frame id the repository will recognise: the live library plus every id it has been
 * renamed from. `adhd traps` on a recorded artifact has to accept the id that artifact was
 * written under, or a rename would make five runs of history fail their own contract check.
 */
export function knownFrameIds(cfg: Config): string[] {
  return cfg.frames.frames.flatMap((f) => [f.id, ...f.former_ids]);
}

/** The id a recorded run's frame goes by today. Unknown ids pass through unchanged: a run may
 *  name a frame that has since been retired outright, and that is a real fact about the run. */
export function currentFrameId(cfg: Config, id: string): string {
  return frameIdHistory(cfg, id)[0]!;
}

export function crossCheck(frames: FramesFile, routing: RoutingFile, rubric: RubricFile): string[] {
  const problems: string[] = [];
  const ids = frames.frames.map((f) => f.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`frames: duplicate ids ${[...new Set(dup)].join(", ")}`);
  const byId = new Map(frames.frames.map((f) => [f.id, f]));

  // A former id that is also a live id, or that two frames both claim, makes a recorded run
  // ambiguous. Both would resolve silently to whichever frame the scan reached first.
  const live = new Set(ids);
  const seenFormer = new Map<string, string>();
  for (const f of frames.frames)
    for (const old of f.former_ids) {
      if (live.has(old)) problems.push(`frames.${f.id}: former_id ${old} is also a live frame id`);
      if (old === f.id) problems.push(`frames.${f.id}: lists its own id as a former_id`);
      const claimed = seenFormer.get(old);
      if (claimed) problems.push(`frames: ${claimed} and ${f.id} both claim former_id ${old}`);
      else seenFormer.set(old, f.id);
    }

  // D6: the union of attacks covers T1..T7. T8 is the critic's counterweight.
  const attacked = new Set(frames.frames.flatMap((f) => f.attacks));
  for (const t of TRAP_IDS.slice(0, 7)) if (!attacked.has(t)) problems.push(`frames: no frame attacks ${t}`);

  // D4: tool grants inside the allowlist.
  const allowed = new Set(routing.defaults.branch_tools_allowed);
  for (const f of frames.frames)
    for (const t of f.tools) if (!allowed.has(t)) problems.push(`frames.${f.id}: tool ${t} not in branch_tools_allowed`);

  const d = routing.defaults;
  if (d.min_branches > d.max_branches) problems.push("routing.defaults: min_branches > max_branches");
  if (d.max_branches > d.hard_cap) problems.push("routing.defaults: max_branches > hard_cap");
  if (d.hard_cap > ids.length) problems.push(`routing.defaults: hard_cap ${d.hard_cap} exceeds library size ${ids.length}`);

  for (const [name, cls] of Object.entries(routing.classes)) {
    if (cls.action !== "run") continue;
    for (const fid of [...cls.frames, ...cls.alternates])
      if (!byId.has(fid)) problems.push(`routing.classes.${name}: unknown frame ${fid}`);
    const primaryAxes = cls.frames.map((fid) => byId.get(fid)?.axis).filter(Boolean);
    const dupAxes = primaryAxes.filter((a, i) => primaryAxes.indexOf(a) !== i);
    if (dupAxes.length)
      problems.push(`routing.classes.${name}: primary frames share an axis (${[...new Set(dupAxes)].join(", ")}). D6.`);
    const overlap = cls.frames.filter((f) => cls.alternates.includes(f));
    if (overlap.length) problems.push(`routing.classes.${name}: ${overlap.join(", ")} listed in both frames and alternates`);
    if (cls.n !== undefined && cls.n > d.hard_cap) problems.push(`routing.classes.${name}: n ${cls.n} > hard_cap`);
    if (cls.n !== undefined && cls.n > cls.frames.length + cls.alternates.length)
      problems.push(`routing.classes.${name}: n ${cls.n} exceeds available frames`);
  }
  if (!Object.values(routing.classes).some((c) => c.action === "decline"))
    problems.push("routing: no decline class. D5 requires a refusal path.");

  const dimIds = rubric.dimensions.map((x) => x.id);
  const dupDim = dimIds.filter((x, i) => dimIds.indexOf(x) !== i);
  if (dupDim.length) problems.push(`rubric: duplicate dimensions ${dupDim.join(", ")}`);
  for (const dim of rubric.dimensions) {
    for (let s = rubric.scale.min; s <= rubric.scale.max; s++)
      if (!(String(s) in dim.anchors)) problems.push(`rubric.${dim.id}: missing anchor for ${s}`);
  }
  // A quality rubric is the thing we refuse to become.
  const banned = new Set(rubric.not_scored.map((s) => s.toLowerCase()));
  for (const dim of rubric.dimensions) if (banned.has(dim.id)) problems.push(`rubric.${dim.id}: is in not_scored`);
  return problems;
}

export function loadConfig(rootArg?: string): Config {
  const root = resolveRoot(rootArg);
  const problems: string[] = [];
  const frames = loadYaml(join(root, "config", "frames.yaml"), FramesFileSchema, problems);
  const routing = loadYaml(join(root, "config", "routing.yaml"), RoutingFileSchema, problems);
  const rubric = loadYaml(join(root, "config", "critic-rubric.yaml"), RubricFileSchema, problems);
  const p = join(root, "prompts");
  const prompts: Prompts = {
    orchestrator: readText(join(p, "orchestrator.md"), problems),
    branch: readText(join(p, "branch.md"), problems),
    criticPassA: readText(join(p, "critic-pass-a.md"), problems),
    criticPassB: readText(join(p, "critic-pass-b.md"), problems),
    deepen: readText(join(p, "deepen.md"), problems),
    synthesis: readText(join(p, "synthesis.md"), problems),
    synthesisPartial: readText(join(p, "synthesis-partial.md"), problems),
  };
  const trapsDoc = readText(join(root, "docs", "TRAPS.md"), problems);
  if (frames && routing && rubric) problems.push(...crossCheck(frames, routing, rubric));
  if (problems.length) throw new ConfigError(problems);
  return {
    root,
    frames: frames!,
    frameById: new Map(frames!.frames.map((f) => [f.id, f])),
    routing: routing!,
    rubric: rubric!,
    prompts,
    trapsDoc,
  };
}
