// `adhd traps <file>`: run the contract check and the code lints over one branch artifact.
import { readFileSync } from "node:fs";
import { unfence } from "./validate.js";
import { parse as parseYaml } from "yaml";
import { BranchArtifactSchema } from "./schema.js";
import { lintBranch } from "./lint.js";

export function trapsReport(filePath: string, opts: { expectHash?: string } = {}): { text: string; exitCode: 0 | 1 } {
  const text = readFileSync(filePath, "utf8");
  const raw = parseYaml(unfence(text));
  const lines: string[] = [`artifact: ${filePath}`];
  let bad = false;
  const r = BranchArtifactSchema.safeParse(raw);
  if (!r.success) {
    bad = true;
    lines.push("contract: VIOLATED (would be pruned)");
    for (const i of r.error.issues) lines.push(`  - ${i.path.join(".") || "<root>"}: ${i.message}`);
    return { text: lines.join("\n"), exitCode: 1 };
  }
  const a = r.data;
  lines.push(`contract: ok (frame ${a.frame}, confidence ${a.confidence})`);
  if (opts.expectHash) {
    if (a.problem_hash !== opts.expectHash) {
      bad = true;
      lines.push(`problem_hash: MISMATCH (${a.problem_hash} != ${opts.expectHash}). Run would abort.`);
    } else lines.push("problem_hash: matches");
  }
  const hints = lintBranch(a);
  if (!hints.length) lines.push("lints: none fired (T3, T4, T5 checked). T1, T2, T6, T7, T8 need the critic.");
  else for (const h of hints) lines.push(`lint ${h.trap}: ${h.evidence}`);
  if (a.missing_actor === null) lines.push("note: missing_actor is null. If every branch does this, run level T6 fires.");
  return { text: lines.join("\n"), exitCode: bad ? 1 : 0 };
}
