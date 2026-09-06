import type { Config } from "./config.js";
import type { Frame, Plan } from "./schema.js";
import { problemHash } from "./hash.js";
import { deriveSeed, mulberry32, randomSeed, shuffle } from "./rng.js";
import { render } from "./template.js";
import { checkBriefIsolation, type Decision } from "./validate.js";
import { ContractError } from "./errors.js";

export interface CompiledBrief {
  frame: string;
  text: string;
}

export type CompileResult =
  | { kind: "declined"; problem_class: string; reason: string; problem_hash: string }
  | { kind: "plan"; plan: Plan; briefs: CompiledBrief[]; problem: string };

export interface CompileOptions {
  runId?: string;
  seed?: number;
  now?: Date;
  /** Paths inside the run dir. Relative. */
  briefDir?: string;
  artifactDir?: string;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function letterFor(i: number): string {
  return LETTERS[i] ?? `Z${i}`;
}

function toolsStatement(frame: Frame): string {
  if (frame.tools.length === 0) return "You have no tools. Everything you need is in this brief. Do not look for more.";
  return `You may use ${frame.tools.join(" and ")} because your frame requires evidence from outside the problem. You may not read files. Do not look for anything else.`;
}

function numbered(items: string[]): string {
  return items.map((p, i) => `${i + 1}. ${p}`).join("\n");
}
function bulleted(items: string[]): string {
  return items.map((p) => `- ${p}`).join("\n");
}

export function renderBranchBrief(cfg: Config, problem: string, hash: string, frame: Frame): string {
  return render(cfg.prompts.branch, {
    problem,
    problem_hash: hash,
    frame: {
      id: frame.id,
      name: frame.name,
      stance: frame.stance.trim(),
      probes: numbered(frame.probes),
      forbidden: bulleted(frame.forbidden),
      tools_statement: toolsStatement(frame),
    },
  });
}

/**
 * Pick n frames from the class's primary list, then alternates, in seeded shuffle order,
 * never two on the same axis (D6). Explicit `frames` in the decision replaces the class list.
 */
export function selectFrames(cfg: Config, decision: Decision, seed: number): { frames: Frame[]; n: number; allowWide: boolean } {
  const cls = cfg.routing.classes[decision.problem_class];
  if (!cls || cls.action !== "run") throw new ContractError("compile", [`class ${decision.problem_class} is not a run class`]);
  const d = cfg.routing.defaults;
  const allowWide = decision.allow_wide === true;
  const cap = allowWide ? cfg.frames.frames.length : d.hard_cap;

  const explicit = decision.frames;
  const primary = explicit ?? cls.frames;
  const alternates = explicit ? [] : cls.alternates;
  const n = decision.n ?? (explicit ? explicit.length : cls.n ?? Math.min(d.max_branches, primary.length));

  if (n < d.min_branches) throw new ContractError("compile", [`n ${n} below min_branches ${d.min_branches}`]);
  if (n > cap)
    throw new ContractError("compile", [
      `n ${n} exceeds ${allowWide ? "library size" : "hard_cap"} ${cap}${allowWide ? "" : ". Pass allow_wide to go above it."}`,
    ]);

  const rng = mulberry32(deriveSeed(seed, 1));
  const order = d.shuffle_frames ? [...shuffle(primary, rng), ...shuffle(alternates, rng)] : [...primary, ...alternates];
  const chosen: Frame[] = [];
  const axes = new Set<string>();
  const skipped: string[] = [];
  for (const id of order) {
    if (chosen.length === n) break;
    const f = cfg.frameById.get(id)!;
    if (axes.has(f.axis)) {
      skipped.push(`${id} (axis ${f.axis} taken)`);
      continue;
    }
    axes.add(f.axis);
    chosen.push(f);
  }
  if (chosen.length < n)
    throw new ContractError("compile", [
      `only ${chosen.length} frames with distinct axes available for n ${n}${skipped.length ? `; skipped ${skipped.join(", ")}` : ""}`,
    ]);
  return { frames: chosen, n, allowWide };
}

export function compile(cfg: Config, problem: string, decision: Decision, opts: CompileOptions = {}): CompileResult {
  const hash = problemHash(problem);
  const cls = cfg.routing.classes[decision.problem_class];
  if (!cls) throw new ContractError("compile", [`unknown class ${decision.problem_class}`]);
  if (cls.action === "decline") return { kind: "declined", problem_class: decision.problem_class, reason: cls.reason, problem_hash: hash };

  const seed = decision.seed ?? opts.seed ?? (cfg.routing.defaults.seed === "random" ? randomSeed() : cfg.routing.defaults.seed);
  const { frames, n, allowWide } = selectFrames(cfg, decision, seed);
  const now = opts.now ?? new Date();
  const runId = opts.runId ?? `${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${hash.slice(7, 13)}`;
  const briefDir = opts.briefDir ?? "briefs";
  const artifactDir = opts.artifactDir ?? "branches";

  const tpb = cfg.routing.defaults.tokens_per_branch_estimate;
  const tokens_branches = tpb * n;
  const tokens_critic = tpb * n; // reads every artifact twice, writes little
  const tokens_deepen = tpb * Math.ceil(n / 2);

  const briefs: CompiledBrief[] = frames.map((f) => ({ frame: f.id, text: renderBranchBrief(cfg, problem, hash, f) }));
  const allIds = cfg.frames.frames.map((f) => f.id);
  const isolation = briefs.flatMap((b) => checkBriefIsolation(b.text, b.frame, allIds));
  if (isolation.length) throw new ContractError("compile: isolation", isolation);

  const plan: Plan = {
    run_id: runId,
    created_at: now.toISOString(),
    problem_hash: hash,
    problem_class: decision.problem_class,
    seed,
    n,
    allow_wide: allowWide,
    estimate: { tokens_branches, tokens_critic, tokens_deepen, tokens_total: tokens_branches + tokens_critic + tokens_deepen },
    branches: frames.map((f) => ({
      frame: f.id,
      axis: f.axis,
      agent: f.tools.length ? "adhd-branch-search" : "adhd-branch",
      tools: f.tools,
      brief_path: `${briefDir}/${f.id}.md`,
      artifact_path: `${artifactDir}/${f.id}.yaml`,
    })),
  };
  return { kind: "plan", plan, briefs, problem };
}

/** The D5 preview. Everything the user needs to say no. */
export function previewText(result: CompileResult): string {
  if (result.kind === "declined") {
    return [
      `DECLINED (${result.problem_class})`,
      result.reason,
      `problem_hash: ${result.problem_hash}`,
      "No briefs compiled. Nothing spent. Answer the question directly.",
    ].join("\n");
  }
  const { plan, problem } = result;
  const lines = [
    `run ${plan.run_id}`,
    ``,
    `PROBLEM (verbatim, ${Buffer.byteLength(problem, "utf8")} bytes, this exact text was hashed):`,
    `---`,
    problem,
    `---`,
    `problem_hash: ${plan.problem_hash}`,
    `class: ${plan.problem_class}    seed: ${plan.seed}    n: ${plan.n}${plan.allow_wide ? "    (allow_wide)" : ""}`,
    ``,
    `frames, in dispatch order:`,
    ...plan.branches.map((b) => `  ${b.frame.padEnd(17)} axis=${b.axis.padEnd(14)} agent=${b.agent}${b.tools.length ? `  tools=${b.tools.join(",")}` : ""}`),
    ``,
    `estimate (order of magnitude): ${plan.estimate.tokens_total.toLocaleString()} tokens`,
    `  branches ${plan.estimate.tokens_branches.toLocaleString()}  critic ${plan.estimate.tokens_critic.toLocaleString()}  deepen ${plan.estimate.tokens_deepen.toLocaleString()}`,
    ``,
    `Nothing has been spent. Confirm the text above is exactly what you meant before any branch is spawned.`,
  ];
  return lines.join("\n");
}
