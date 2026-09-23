/**
 * The triage stage's artifact contract: a brain dump segmented into quick tasks, notes and
 * decisions.
 *
 * `.strict()` is the same mechanical trick `decisionSchema` (src/validate.ts) uses to keep an
 * orchestrator from having anywhere to put a candidate answer: there is no `priority` field, no
 * `recommendation` field, no slot for one to land in. Triage segments and classifies; it does not
 * rank, and the schema is what makes that a fact about the artifact rather than a request in a
 * prompt.
 *
 * Unlike a branch artifact, a triage artifact carries no hash of its own to echo. `SuperAgent
 * .return_` already checks `goal_hash` against what `claim` handed out, for every stage kind, before
 * `verifyStage` runs at all — the same paraphrase-drift protection `problem_hash` gives a run,
 * applied once at the mission level rather than reinvented per stage.
 */

import { z } from "zod";
import { parse as parseYaml } from "yaml";
import type { Config } from "./config.js";
import { unfence } from "./validate.js";

export const TRIAGE_KINDS = ["quick_task", "note", "decision"] as const;

export const TriageItemSchema = z
  .object({
    id: z.number().int().positive(),
    kind: z.enum(TRIAGE_KINDS),
    text: z.string().min(1),
    draft_problem: z.string().min(1).nullable(),
    suggested_class: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const wantsDecision = item.kind === "decision";
    if (wantsDecision !== (item.draft_problem !== null))
      ctx.addIssue({ code: "custom", message: `item ${item.id}: decision items carry draft_problem and nothing else does` });
    if (wantsDecision !== (item.suggested_class !== null))
      ctx.addIssue({ code: "custom", message: `item ${item.id}: decision items carry suggested_class and nothing else does` });
  });
export type TriageItem = z.infer<typeof TriageItemSchema>;

export const TriageResultSchema = z.object({ items: z.array(TriageItemSchema).min(1) }).strict();
export type TriageResult = z.infer<typeof TriageResultSchema>;

/**
 * Checked in the same shape `verifyStage` already uses for every other stage kind: a list of
 * problems, empty when the artifact passes. A `decision` item's `suggested_class` is checked
 * against the live routing config the same way `selectFrames` rejects a decline-only or unknown
 * class for a real run — a run-eligible-looking class named by an agent that cannot read
 * `config/routing.yaml` itself is exactly the kind of drift this catches before it reaches
 * `kernel.submit`.
 */
export function checkTriageArtifact(cfg: Config, text: string): { problems: string[]; result: TriageResult | null } {
  let raw: unknown;
  try {
    raw = parseYaml(unfence(text));
  } catch (e) {
    return { problems: [`items.yaml is not valid YAML: ${(e as Error).message}`], result: null };
  }
  const r = TriageResultSchema.safeParse(raw);
  if (!r.success) return { problems: r.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`), result: null };

  const problems: string[] = [];
  for (const item of r.data.items) {
    if (item.kind !== "decision" || item.suggested_class === null) continue;
    const cls = cfg.routing.classes[item.suggested_class];
    if (!cls) problems.push(`item ${item.id}: suggested_class ${item.suggested_class} is not a routing class`);
    else if (cls.action !== "run") problems.push(`item ${item.id}: suggested_class ${item.suggested_class} is a decline class, not eligible for a run`);
  }
  return { problems, result: problems.length ? null : r.data };
}

/** The classes a triage brief may suggest: every routing class whose action is `run`. */
export function runEligibleClasses(cfg: Config): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = [];
  for (const [name, cls] of Object.entries(cfg.routing.classes)) {
    if (cls.action !== "run") continue;
    out.push({ name, description: cls.description });
  }
  return out;
}
