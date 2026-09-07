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
/**
 * An injector writing a problem statement does not know this system's vocabulary. They will not
 * write "every branch must agree"; they will write "all approaches should agree", because
 * "approach" is what a person calls a line of reasoning. The first version of these patterns was
 * written in the words the architecture uses (branch, frame, diverge) and caught only injections
 * phrased in those words: of eighteen realistic attempts, seven fired and eleven went through,
 * including the two most natural ways to manufacture consensus.
 *
 * So the patterns are built from two pieces instead of listed flat. REASONER is what an outsider
 * calls one of these subagents. CONTEXT is what an outsider calls the thing it was told to do.
 * Neither list contains a word this repository invented.
 */
const REASONER = "(?:branch(?:es)?|approach(?:es)?|perspectives?|angles?|analys[ei]s|viewpoints?|answers?|responses?|reasoners?|agents?|models?|methods?|lenses?|takes?)";
const CONTEXT = "(?:fram(?:e|es|ing)|instructions?|briefs?|stances?|contracts?|rules?|roles?|guidance|context|prompts?|constraints?|directions?)";
const AGREE = "(?:agree|converge|concur|align|match|coincide)";
/**
 * An override is an imperative, so it begins a clause. "Users ignore the previous version of the
 * onboarding flow" is a sentence about user behaviour and fired before this was added; "and
 * ignore any framing you were given" is an injection and still fires. The difference is whether
 * a subject precedes the verb, and a clause boundary is the cheap way to ask.
 */
const CLAUSE = "(?:^|(?<=[.!?;:,)\\]]\\s)|(?<=\\b(?:and|or|but|then|also|please|now|first)\\s))";

const INJECTION_PATTERNS: { re: RegExp; why: string }[] = [
  // Override: discard what you were told.
  { re: new RegExp(`${CLAUSE}ignore (?:(?:the|all|any|your) )?(?:previous|prior|above|preceding|earlier|foregoing)\\b`, "i"), why: "tells the reader to ignore what came before" },
  { re: new RegExp(`${CLAUSE}(?:ignore|disregard|forget|override|discard|drop|skip|set aside|put aside|leave aside) (?:(?:the|all|any|your|whatever) )?${CONTEXT}\\b`, "i"), why: "tells the reader to discard the frame or the brief" },
  { re: new RegExp(`${CLAUSE}(?:disregard|forget|override|discard) (?:(?:the|all|any|your) )?(?:previous|prior|above)\\b`, "i"), why: "tells the reader to discard its instructions" },
  { re: new RegExp(`\\bregardless of (?:(?:the|any|your|whatever) )?${CONTEXT}\\b`, "i"), why: "tells the reader its frame does not apply" },
  { re: new RegExp(`\\b(?:whatever|no matter (?:what|which)) ${CONTEXT}`, "i"), why: "tells the reader its frame does not apply" },
  { re: new RegExp(`\\b(?:whatever|no matter (?:what|which)) ${REASONER} you (?:take|use|adopt|hold)`, "i"), why: "tells the reader its frame does not apply" },

  // Convergence: manufacture the consensus trap, which is T1 by construction.
  { re: new RegExp(`\\b(?:every|all|each|both) (?:(?:of the|of your|the|your) )?${REASONER} (?:must|should|will|shall|need to|have to|has to|ought to)`, "i"), why: "addresses the branches as a group, which no branch is supposed to know exists" },
  { re: new RegExp(`\\b(?:every|all|each|both) (?:(?:of the|of your|the|your) )?${REASONER}[^.!?]{0,40}\\b${AGREE}\\b`, "i"), why: "asks for convergence, which is the consensus trap by construction" },
  { re: new RegExp(`\\byou (?:must|should) all\\b`, "i"), why: "addresses the branches as a group, which no branch is supposed to know exists" },
  { re: new RegExp(`\\b(?:reach|arrive at|land on|end (?:up )?(?:at|with)|come to) the same (?:conclusion|answer|position|recommendation|result)`, "i"), why: "asks for convergence, which is the consensus trap by construction" },
  { re: new RegExp(`\\b(?:say|recommend|conclude|propose|choose|pick) the same (?:thing|answer|position)`, "i"), why: "asks for convergence, which is the consensus trap by construction" },
  { re: /\bdo not (?:diverge|disagree|differ|deviate)\b/i, why: "asks for convergence, which is the consensus trap by construction" },
  { re: /\b(?:do not|don't|avoid) (?:consider(?:ing)?|explor(?:e|ing)|propos(?:e|ing)|offer(?:ing)?) (?:any )?(?:alternatives?|other (?:options?|answers?|approaches?))/i, why: "forbids the divergence the run exists to produce" },

  // Role reassignment and out-of-band instruction.
  { re: /\byou are (?:now|actually|really) \w+/i, why: "attempts to reassign the reader's role" },
  { re: /\bnew instructions?\b/i, why: "announces replacement instructions" },
  { re: /\bsystem ?(?:prompt|message)\b/i, why: "refers to a system prompt" },
  { re: /\b(?:answer|respond|reply) only (?:with|that)\b/i, why: "constrains the answer regardless of frame" },
];

export interface ProblemWarning {
  match: string;
  why: string;
}

export function lintProblemInjection(problem: string): ProblemWarning[] {
  // Whitespace is collapsed in one linear pass and the patterns then match single spaces.
  // Writing `\s+` next to an optional group that also ends in `\s+` gives the engine an
  // ambiguous split to backtrack over, which is polynomial on adversarial input: a problem
  // carrying a long run of whitespace would stall the very check meant to catch hostile
  // problems. Collapsing first removes the ambiguity instead of relying on an engine
  // optimisation to hide it.
  const flat = problem.replace(/\s+/g, " ");
  const out: ProblemWarning[] = [];
  for (const { re, why } of INJECTION_PATTERNS) {
    const m = flat.match(re);
    if (m) out.push({ match: m[0].trim(), why });
  }
  return out;
}
