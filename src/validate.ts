import { z } from "zod";
import { parse as parseYaml } from "yaml";
import {
  BranchArtifactSchema,
  DeepenArtifactSchema,
  PassASchema,
  PassBSchema,
  TRAP_IDS,
  type BranchArtifact,
  type DeepenArtifact,
  type PassA,
  type PassB,
} from "./schema.js";
import type { Config } from "./config.js";
import { ContractError, HashMismatch } from "./errors.js";

// ---- the routing decision --------------------------------------------------------------

export interface Decision {
  problem_class: string;
  n?: number;
  frames?: string[];
  allow_wide?: boolean;
  seed?: number;
}

/**
 * The only object the orchestrator may emit. Every field is enum valued or numeric. Unknown
 * keys reject. This is the mechanical form of "the orchestrator never reasons": there is no
 * slot for reasoning, so a candidate answer has nowhere to land.
 */
export function decisionSchema(cfg: Config) {
  const classes = Object.keys(cfg.routing.classes) as [string, ...string[]];
  const frameIds = cfg.frames.frames.map((f) => f.id) as [string, ...string[]];
  const size = cfg.frames.frames.length;
  return z
    .object({
      problem_class: z.enum(classes),
      n: z.number().int().min(cfg.routing.defaults.min_branches).max(size).optional(),
      frames: z.array(z.enum(frameIds)).min(1).optional(),
      allow_wide: z.boolean().optional(),
      seed: z.number().int().min(0).optional(),
    })
    .strict();
}

export function parseDecision(cfg: Config, raw: unknown): Decision {
  const input = typeof raw === "string" ? safeJson(raw) : raw;
  const r = decisionSchema(cfg).safeParse(input);
  if (!r.success) {
    throw new ContractError(
      "routing decision",
      r.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).concat([
        "the orchestrator emits enum values only; any free text is rejected",
      ]),
    );
  }
  return r.data;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new ContractError("routing decision", [`not JSON: ${(e as Error).message}`]);
  }
}

// ---- brief isolation --------------------------------------------------------------------

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|several|other|multiple|many";
const COUNT_RE = new RegExp(`\\b(\\d+|${NUMBER_WORDS})\\s+(other\\s+)?(branches|frames|perspectives|subagents|angles|lenses)\\b`, "i");
const SO_FAR_RE = /\bso far\b/i;
const SIBLING_RE = /\b(sibling|other branch|another branch|the other (frame|branch)|previously considered|already considered|has been considered)\b/i;

/**
 * Fails if a brief carries anything a branch must not know: another frame's id, a branch
 * count, or the phrase "so far". Used in tests and at compile time.
 */
/** A frame's identifying labels: the id the schema uses and the name a brief prints. */
export interface FrameLabel {
  id: string;
  name: string;
}

interface LabelToken {
  frame: string;
  token: string;
  kind: "id" | "name";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (t: string) => new RegExp(`\\b${escapeRe(t)}\\b`, "i");

function tokensFor(frames: FrameLabel[]): LabelToken[] {
  return frames.flatMap((f) => [
    { frame: f.id, token: f.id, kind: "id" as const },
    { frame: f.id, token: f.name, kind: "name" as const },
  ]);
}

/**
 * A label the problem statement itself uses cannot identify which frame produced a text,
 * because every branch is free to echo the problem. Exempting those is what stops a problem
 * about a mechanic's dashboard from aborting a run whose blindness is intact.
 */
function discriminating(tokens: LabelToken[], problem: string): LabelToken[] {
  return tokens.filter((t) => !(problem && wordRe(t.token).test(problem)));
}

/** Strip every identifying label but `keep`'s. Over-redaction is the safe direction here. */
export function redactFrameLabels(
  text: string,
  frames: FrameLabel[],
  opts: { keep?: string; problem?: string; replacement?: string } = {},
): string {
  const replacement = opts.replacement ?? "[frame]";
  let out = text;
  for (const t of discriminating(tokensFor(frames), opts.problem ?? "")) {
    if (t.frame === opts.keep) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(t.token)}\\b`, "gi"), replacement);
  }
  return out;
}

export function checkBriefIsolation(brief: string, ownFrameId: string, frames: FrameLabel[], opts: { problem?: string } = {}): string[] {
  const problems: string[] = [];
  for (const t of discriminating(tokensFor(frames), opts.problem ?? "")) {
    if (t.frame === ownFrameId) continue;
    if (wordRe(t.token).test(brief)) problems.push(`brief for ${ownFrameId} mentions frame ${t.kind} ${t.token}`);
  }
  if (SO_FAR_RE.test(brief)) problems.push(`brief for ${ownFrameId} contains "so far"`);
  const c = brief.match(COUNT_RE);
  if (c) problems.push(`brief for ${ownFrameId} contains a branch count: "${c[0]}"`);
  const s = brief.match(SIBLING_RE);
  if (s) problems.push(`brief for ${ownFrameId} refers to siblings: "${s[0]}"`);
  return problems;
}

/**
 * Pass A is blind: no label that identifies a frame may appear in the brief. Ids and display
 * names both count. A branch writes "from inside the Door keeper stance" far more naturally
 * than it writes DOOR_KEEPER, and checking only ids left that leak open.
 */
export function checkBlind(passABrief: string, frames: FrameLabel[], opts: { problem?: string } = {}): string[] {
  const problems: string[] = [];
  for (const t of discriminating(tokensFor(frames), opts.problem ?? ""))
    if (wordRe(t.token).test(passABrief)) problems.push(`pass A brief leaks frame ${t.kind} ${t.token}`);
  if (/^\s*frame:\s*\S/m.test(passABrief)) problems.push("pass A brief contains a `frame:` field");
  return problems;
}

// ---- artifacts --------------------------------------------------------------------------

export type BranchValidation =
  | { ok: true; artifact: BranchArtifact }
  | { ok: false; frame: string; violations: string[]; raw: unknown };

/**
 * Subagents sometimes wrap the YAML in a fence, and sometimes add prose after it (a sources
 * line, a sign off). The artifact is the first fenced block if there is one, else the text.
 * Every reader of a subagent's final message goes through here so they agree on what it said.
 */
export function unfence(text: string): string {
  const fenced = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)\n```/);
  return fenced ? fenced[1]! : text;
}

function parseYamlLoose(text: string): unknown {
  return parseYaml(unfence(text));
}

/**
 * Hash mismatch throws: the run is over (hard rule). Anything else is a contract violation
 * that prunes the branch and is reported in the pruned block.
 */
export function validateBranchArtifact(text: string, expectedHash: string, expectedFrame: string): BranchValidation {
  let raw: unknown;
  try {
    raw = parseYamlLoose(text);
  } catch (e) {
    return { ok: false, frame: expectedFrame, violations: [`not valid YAML: ${(e as Error).message}`], raw: text };
  }
  const got = (raw as { problem_hash?: unknown } | null)?.problem_hash;
  if (typeof got !== "string" || got !== expectedHash) {
    throw new HashMismatch(expectedHash, String(got), `branch ${expectedFrame}`);
  }
  const r = BranchArtifactSchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      frame: expectedFrame,
      violations: r.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
      raw,
    };
  }
  if (r.data.frame !== expectedFrame) {
    return { ok: false, frame: expectedFrame, violations: [`frame field is ${r.data.frame}, brief was ${expectedFrame}`], raw };
  }
  return { ok: true, artifact: r.data };
}

export function validatePassA(text: string, expectedHash: string, letters: string[], dimensionIds: string[]): PassA {
  const raw = parseYamlLoose(text);
  const got = (raw as { problem_hash?: unknown } | null)?.problem_hash;
  if (got !== expectedHash) throw new HashMismatch(expectedHash, String(got), "critic pass A");
  const r = PassASchema.safeParse(raw);
  if (!r.success) throw new ContractError("critic pass A", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const problems: string[] = [];
  for (const L of letters) {
    const row = r.data.scores[L];
    if (!row) {
      problems.push(`no scores for ${L}`);
      continue;
    }
    for (const d of dimensionIds) if (!(d in row)) problems.push(`${L}.${d} missing`);
    for (const d of Object.keys(row)) if (!dimensionIds.includes(d)) problems.push(`${L}.${d} is not a rubric dimension`);
  }
  for (const L of Object.keys(r.data.scores)) if (!letters.includes(L)) problems.push(`unexpected letter ${L}`);
  if (problems.length) throw new ContractError("critic pass A", problems);
  return r.data;
}

export function validatePassB(text: string, expectedHash: string, frameIds: string[]): PassB {
  const raw = parseYamlLoose(text);
  const got = (raw as { problem_hash?: unknown } | null)?.problem_hash;
  if (got !== expectedHash) throw new HashMismatch(expectedHash, String(got), "critic pass B");
  const r = PassBSchema.safeParse(raw);
  if (!r.success) throw new ContractError("critic pass B", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const problems: string[] = [];
  // Every (branch, trap) record. Missing rejects the pass (hard rule).
  for (const f of frameIds) {
    const row = r.data.traps[f];
    if (!row) {
      problems.push(`no trap records for ${f}`);
      continue;
    }
    for (const t of TRAP_IDS) if (!(t in row)) problems.push(`${f}.${t} detector record missing`);
  }
  for (const f of Object.keys(r.data.traps)) if (!frameIds.includes(f)) problems.push(`trap records for unknown frame ${f}`);
  // Clusters partition the frames.
  const seen = new Map<string, number>();
  for (const c of r.data.clusters) {
    for (const m of c.members) seen.set(m, (seen.get(m) ?? 0) + 1);
    if (c.singleton !== (c.members.length === 1)) problems.push(`cluster ${c.id}: singleton flag disagrees with member count`);
  }
  for (const f of frameIds) {
    const n = seen.get(f) ?? 0;
    if (n === 0) problems.push(`${f} is in no cluster`);
    if (n > 1) problems.push(`${f} is in ${n} clusters`);
  }
  for (const f of seen.keys()) if (!frameIds.includes(f)) problems.push(`cluster member ${f} is not a branch of this run`);
  if (problems.length) throw new ContractError("critic pass B", problems);
  return r.data;
}

export function validateDeepen(text: string, expectedHash: string, expectedFrame: string): DeepenArtifact {
  const raw = parseYamlLoose(text);
  const got = (raw as { problem_hash?: unknown } | null)?.problem_hash;
  if (got !== expectedHash) throw new HashMismatch(expectedHash, String(got), `deepen ${expectedFrame}`);
  const r = DeepenArtifactSchema.safeParse(raw);
  if (!r.success) throw new ContractError(`deepen ${expectedFrame}`, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  if (r.data.frame !== expectedFrame) throw new ContractError(`deepen ${expectedFrame}`, [`frame field is ${r.data.frame}`]);
  if (r.data.verdict === "defend" && !r.data.revised_position)
    throw new ContractError(`deepen ${expectedFrame}`, ["defend requires revised_position (unchanged is fine, null is not)"]);
  return r.data;
}
