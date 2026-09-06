import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { loadConfig, type Config } from "../src/config.js";
import { TRAP_IDS, type BranchArtifact, type PassA, type PassB } from "../src/schema.js";

export const cfg: Config = loadConfig();

export function tmp(prefix = "adhd-test-"): string {
  return mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), prefix));
}

export function writeProblem(dir: string, text: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "problem.txt");
  writeFileSync(p, Buffer.from(text, "utf8"));
  return p;
}

export function artifact(frame: string, hash: string, over: Partial<BranchArtifact> = {}): BranchArtifact {
  return {
    problem_hash: hash,
    frame,
    position: `Set a cancel button first, then a ${frame.toLowerCase()} specific timeout.`,
    reasoning: `From inside ${frame}: the user can cancel, so the human is the fastest controller. The retry target should not be the same instance. Someone pays for the retry in tokens.`,
    forecloses: ["a fixed 30s timeout for every caller", "silent retry against the same instance"],
    falsifier: "users never cancel within the first token timeout",
    missing_actor: "the human watching the spinner, who can cancel",
    confidence: "medium",
    ...over,
  };
}

export const yaml = (o: unknown) => stringify(o);

export function passA(hash: string, letters: string[], score = 2): PassA {
  const scores: PassA["scores"] = {};
  for (const L of letters) {
    scores[L] = {};
    for (const d of cfg.rubric.dimensions) scores[L]![d.id] = { score, evidence: `evidence for ${L}.${d.id}` };
  }
  return { problem_hash: hash, pass: "A", scores };
}

export function passB(
  hash: string,
  clusters: { id: string; members: string[]; action?: string; objection?: string | null }[],
  fired: Record<string, Partial<Record<(typeof TRAP_IDS)[number], string>>> = {},
): PassB {
  const frames = clusters.flatMap((c) => c.members);
  const traps: PassB["traps"] = {};
  for (const f of frames) {
    traps[f] = {} as PassB["traps"][string];
    for (const t of TRAP_IDS) {
      const ev = fired[f]?.[t];
      // Real fired evidence in the recorded runs is 29 to 50 words, because firing a detector
      // removes a frame from the recommendation and has to be argued for. The helper writes a
      // record of that shape so tests exercise a pass B a critic could actually have produced.
      traps[f]![t] = {
        fired: ev !== undefined,
        evidence: ev === undefined ? "not fired" : `${ev}, so the detector as written is recorded as fired for ${f} on ${t} rather than left open`,
      };
    }
  }
  return {
    problem_hash: hash,
    pass: "B",
    clusters: clusters.map((c) => ({
      id: c.id,
      action: c.action ?? `do ${c.id}`,
      members: c.members,
      singleton: c.members.length === 1,
      strongest_objection: c.objection === undefined ? `objection to ${c.id}` : c.objection,
    })),
    traps,
    run_level: {
      T2_no_branch_attacked_assumption: { fired: false, evidence: "FRAME_BREAKER attacked retry-same-instance" },
      T6_all_missing_actor_null: { fired: false, evidence: "actors named" },
    },
    lint_verdicts: [],
  };
}
