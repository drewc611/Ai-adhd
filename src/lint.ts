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
  /^(set|use|make|expose|give|let|fail|return|do|stop|add|remove|treat|start|drop|route|keep|cancel|show|build|ship|pick|choose|put|run|check|look|measure|write|split|merge|move|delete|prefer|default|cap|bound|reject|accept|degrade|retry|never|don't|do not|always|first|graph|plot|correlate|grep|confirm|overlay|compare|turn|ask|tell|stream|surface|record|log|pay|bill|charge|rename|call|name|pull|read|query|list|enumerate|partition|group|shift|instrument|test|find|change|require|stay|wait|halve|double|lower|raise|open|close|flip|pause|treat|swap)\b/i;

/** A "do X" sentence exists: an imperative opening, or an explicit ordering word. */
export function hasImperative(text: string): boolean {
  return splitSentences(text.replace(/[*_`#]/g, "")).some((s) => IMPERATIVE_START.test(s) || /\b(first|before)\b/i.test(s));
}

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


/**
 * Override language in the problem statement. The problem reaches every branch verbatim, so a
 * single sentence telling branches to converge is the cheapest possible attack on this
 * architecture: it manufactures the consensus trap the whole system exists to catch.
 *
 * This warns, it never blocks. The problem is passed through byte for byte by design, a person
 * may legitimately be asking about prompt injection, and the orchestrator does not get to
 * decide what a problem is allowed to say. The D5 confirmation gate is where a human sees it.
 */
const INJECTION_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\bignore\s+(the\s+|all\s+|any\s+|your\s+)?(previous|prior|above|preceding|earlier|foregoing)\b/i, why: "tells the reader to ignore what came before" },
  { re: /\bignore\s+(the\s+|your\s+)?(frame|instructions?|brief|stance|contract|rules?)\b/i, why: "tells the reader to ignore the frame or the brief" },
  { re: /\b(disregard|forget|override|discard)\s+(the\s+|all\s+|any\s+|your\s+)?(previous|prior|above|frame|instructions?|brief|stance|contract|rules?)\b/i, why: "tells the reader to discard its instructions" },
  { re: /\b(every|all|each)\s+branch(es)?\s+(must|should|will|shall)\b/i, why: "addresses the branches as a group, which no branch is supposed to know exists" },
  { re: /\bdo\s+not\s+(diverge|disagree|differ)\b/i, why: "asks for convergence, which is the consensus trap by construction" },
  { re: /\byou\s+are\s+(now|actually|really)\s+\w+/i, why: "attempts to reassign the reader's role" },
  { re: /\bnew\s+instructions?\b/i, why: "announces replacement instructions" },
  { re: /\bsystem\s*(prompt|message)\b/i, why: "refers to a system prompt" },
  { re: /\b(answer|respond|reply)\s+only\s+(with|that)\b/i, why: "constrains the answer regardless of frame" },
];

export interface ProblemWarning {
  match: string;
  why: string;
}

export function lintProblemInjection(problem: string): ProblemWarning[] {
  const out: ProblemWarning[] = [];
  for (const { re, why } of INJECTION_PATTERNS) {
    const m = problem.match(re);
    if (m) out.push({ match: m[0].trim(), why });
  }
  return out;
}
