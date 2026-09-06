// Code side trap lints. They hint; the critic confirms (D4). Every lint here mirrors a
// "Code lint" line in docs/TRAPS.md. Do not add a lint without adding the doc line.
import type { BranchArtifact, TrapId } from "./schema.js";

export interface LintHint {
  frame: string;
  trap: TrapId;
  evidence: string;
}

const CITATION = /\b(ch\.|chapter\s+\d+|et al\.?|RFC\s*\d+|https?:\/\/\S+|\bbook\b|\bpaper\b|\bstudy\b|according to|\bSRE\b|\bblog\b|\bdocs?\b\s+say)/i;
const HEDGE = /\b(it depends|either|consider(ing)?|could|might|may be|on the other hand|perhaps|possibly|alternatively)\b/i;
export const IMPERATIVE_START =
  /^(set|use|make|expose|give|let|fail|return|do|stop|add|remove|treat|start|drop|route|keep|cancel|show|build|ship|pick|choose|put|run|check|look|measure|write|split|merge|move|delete|prefer|default|cap|bound|reject|accept|degrade|retry|never|don't|do not|always|first|graph|plot|correlate|grep|confirm|overlay|compare|turn|ask|tell|stream|surface|record|log|pay|bill|charge|rename|call|name)\b/i;

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

/** T3: strip citation sentences; if fewer than 40 words of reasoning remain, hint. */
export function lintT3(a: BranchArtifact): LintHint | null {
  const sentences = splitSentences(a.reasoning);
  const cited = sentences.filter((s) => CITATION.test(s));
  if (cited.length === 0) return null;
  const remaining = sentences.filter((s) => !CITATION.test(s)).join(" ");
  const words = wordCount(remaining);
  if (words < 40)
    return {
      frame: a.frame,
      trap: "T3",
      evidence: `${cited.length} citation sentence(s); ${words} words of reasoning remain after removing them (threshold 40)`,
    };
  return null;
}

/** T4: forecloses entries all under four words. (Empty forecloses is a contract violation.) */
export function lintT4(a: BranchArtifact): LintHint | null {
  if (a.forecloses.length && a.forecloses.every((f) => wordCount(f) < 4))
    return { frame: a.frame, trap: "T4", evidence: `every forecloses entry is under four words: ${a.forecloses.join(" | ")}` };
  return null;
}

/** T5: hedge in position and no imperative opening. */
export function lintT5(a: BranchArtifact): LintHint | null {
  const pos = a.position.trim();
  const hedge = pos.match(HEDGE);
  if (hedge && !IMPERATIVE_START.test(pos))
    return { frame: a.frame, trap: "T5", evidence: `position hedges ("${hedge[0]}") and does not open with an imperative` };
  return null;
}

export function lintBranch(a: BranchArtifact): LintHint[] {
  return [lintT3(a), lintT4(a), lintT5(a)].filter((x): x is LintHint => x !== null);
}

/** Run level T6: every branch left missing_actor null. */
export function lintRunT6(artifacts: BranchArtifact[]): LintHint | null {
  if (artifacts.length && artifacts.every((a) => a.missing_actor === null))
    return { frame: "*", trap: "T6", evidence: "missing_actor is null in every branch" };
  return null;
}
