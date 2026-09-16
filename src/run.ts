// The run directory state machine. Each phase reads what the host wrote, validates it, and
// writes the next briefs. No phase waits on anything. No phase calls a model.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { readJsonIf } from "./read.js";
import type { Config } from "./config.js";
import { DispatchRecordSchema, PlanSchema, dimensionsAt, type BranchArtifact, type DeepenArtifact, type DispatchEntry, type Plan } from "./schema.js";
import { compile, letterFor, previewText } from "./compile.js";
import {
  checkBlind,
  checkBriefIsolation,
  redactFrameLabels,
  parseDecision,
  validateBranchArtifact,
  validateDeepen,
  validatePassA,
  validatePassB,
  type BranchValidation,
} from "./validate.js";
import { lintBranch, lintRunT6, type LintHint } from "./lint.js";
import { deriveSeed, mulberry32, shuffle } from "./rng.js";
import { render } from "./template.js";
import { passAScores, scoreRun, type ScoreResult } from "./score.js";
import { renderPartial, renderSynthesis } from "./synth.js";
import { ContractError, RunAbort } from "./errors.js";

export interface PhaseResult {
  text: string;
  /** Files the host must now act on, if any. */
  next?: { kind: "spawn"; agent: string; brief: string; artifact: string }[];
  /**
   * Where compile put the run. It was only ever in the prose, so a driver had to regex a path
   * out of a sentence to find the directory it had just been told to use.
   */
  runDir?: string;
  exitCode: 0 | 1 | 2;
}

export interface CompileArgs {
  problemPath: string;
  decision: unknown;
  runsDir?: string;
  seed?: number;
  runId?: string;
}

const rd = (p: string) => readFileSync(p, "utf8");
const validArtifacts = (branches: BranchValidation[]): BranchArtifact[] =>
  branches.flatMap((b) => (b.ok ? [b.artifact] : []));
const wr = (p: string, s: string) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, s);
};

export function loadPlan(runDir: string): Plan {
  const p = join(runDir, "plan.json");
  if (!existsSync(p)) throw new RunAbort(`${p} missing. Run --phase compile first.`, "NO_PLAN");
  const r = PlanSchema.safeParse(JSON.parse(rd(p)));
  if (!r.success) throw new RunAbort(`plan.json invalid: ${r.error.message}`, "BAD_PLAN");
  return r.data;
}

// ---- compile ----------------------------------------------------------------------------

export function phaseCompile(cfg: Config, args: CompileArgs): PhaseResult {
  const problemBytes = readFileSync(args.problemPath); // exact bytes, never trimmed
  const problem = problemBytes.toString("utf8");
  const decision = parseDecision(cfg, args.decision);
  const result = compile(cfg, problem, decision, { seed: args.seed, runId: args.runId });
  if (result.kind === "declined") return { text: previewText(result), exitCode: 2 };

  const runsDir = resolve(args.runsDir ?? "runs");
  const runDir = join(runsDir, result.plan.run_id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "problem.txt"), problemBytes);
  wr(join(runDir, "decision.json"), JSON.stringify(decision, null, 2) + "\n");
  wr(join(runDir, "plan.json"), JSON.stringify(result.plan, null, 2) + "\n");
  for (const b of result.briefs) {
    const pb = result.plan.branches.find((x) => x.frame === b.frame)!;
    wr(join(runDir, pb.brief_path), b.text);
    mkdirSync(join(runDir, pb.artifact_path, ".."), { recursive: true }); // the host writes here
  }
  mkdirSync(join(runDir, "critic"), { recursive: true });
  mkdirSync(join(runDir, "deepen"), { recursive: true });
  const text = `${previewText(result)}\n\nrun dir: ${runDir}\nnext: spawn one subagent per brief (see plan.json), write each final message to its artifact_path, then --phase critique.`;
  return {
    text,
    runDir,
    exitCode: 0,
    next: result.plan.branches.map((b) => ({ kind: "spawn", agent: b.agent, brief: join(runDir, b.brief_path), artifact: join(runDir, b.artifact_path) })),
  };
}

// ---- shared: load and validate branch artifacts --------------------------------------------

export function loadBranches(runDir: string, plan: Plan, opts: { allowMissing?: boolean } = {}): { branches: BranchValidation[]; missing: string[] } {
  const branches: BranchValidation[] = [];
  const missing: string[] = [];
  for (const b of plan.branches) {
    const p = join(runDir, b.artifact_path);
    if (!existsSync(p)) {
      missing.push(b.frame);
      continue;
    }
    branches.push(validateBranchArtifact(rd(p), plan.problem_hash, b.frame)); // throws HashMismatch
  }
  if (missing.length && !opts.allowMissing)
    throw new RunAbort(`artifacts missing for ${missing.join(", ")}. Spawn them, or use --phase synth --partial to take what exists.`, "MISSING_ARTIFACTS");
  return { branches, missing };
}

export function collectLints(branches: BranchValidation[]): LintHint[] {
  const ok = validArtifacts(branches);
  const hints = ok.flatMap((a) => lintBranch(a));
  const t6 = lintRunT6(ok);
  if (t6) hints.push(t6);
  return hints;
}

function renderDetectors(trapsDoc: string): string {
  // Pull each "## Tn." section's detector lines out of docs/TRAPS.md so the critic runs the
  // detectors as written, not as remembered.
  const out: string[] = [];
  const re = /^## (T[1-8])\. ([^\n]+)\n([\s\S]*?)(?=^## |^---|\Z)/gm;
  for (const m of trapsDoc.matchAll(re)) {
    const body = m[3]!;
    // Index lookups rather than a lazy match with a lookahead: same result, and it cannot
    // rescan from every position inside a run of "*Detector:*".
    const MARK = "*Detector:*";
    const at = body.indexOf(MARK);
    let det: string | null = null;
    if (at !== -1) {
      const from = at + MARK.length;
      const stop = body.indexOf("\n\n", from);
      det = body.slice(from, stop === -1 ? undefined : stop);
    }
    out.push(`   ${m[1]} ${m[2]!.trim()}. Detector:${det !== null ? det.replace(/\s+/g, " ") : " (see docs/TRAPS.md)"}`);
  }
  return out.join("\n");
}

/**
 * The critic is asked only for the dimensions in force now (D34). A retired one is still in the
 * rubric file, because seven recorded runs were scored with it, and asking a fresh critic to score
 * it would put a dimension nothing reads back into new artifacts.
 */
function renderRubric(cfg: Config): string {
  return dimensionsAt(cfg.rubric.dimensions, cfg.rubric.version)
    .map((d) => {
      const anchors = Object.entries(d.anchors)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([k, v]) => `    ${k}: ${v}`)
        .join("\n");
      return `- **${d.id}** (weight ${d.weight}): ${d.question}\n${anchors}`;
    })
    .join("\n");
}

function yamlBlock(obj: unknown): string {
  // Minimal YAML emitter for artifacts we already validated. Stable key order.
  const lines: string[] = [];
  const emit = (v: unknown, indent: string) => {
    if (Array.isArray(v)) {
      for (const it of v) lines.push(`${indent}- ${JSON.stringify(it)}`);
    } else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (Array.isArray(val) || (val && typeof val === "object")) {
          lines.push(`${indent}${k}:`);
          emit(val, indent + "  ");
        } else lines.push(`${indent}${k}: ${JSON.stringify(val ?? null)}`);
      }
    }
  };
  emit(obj, "");
  return lines.join("\n");
}

// ---- critique ---------------------------------------------------------------------------

export interface DispatchCheck {
  /** Absent for every run recorded before D41, which is the point of reporting it. */
  recorded: boolean;
  substitutions: DispatchEntry[];
  missing: string[];
  text: string;
}

/**
 * What the host actually spawned, checked against what the plan asked for.
 *
 * The plan records an intent. Until D41 nothing recorded the outcome, so a dispatch that fell back
 * to a different agent — and therefore to a different system prompt — left no trace anywhere in the
 * run directory. Fifteen recorded runs carry `"agent": "adhd-branch"` for branches that agent never
 * produced, because it could not launch.
 *
 * Absence is reported rather than thrown. Every existing recording predates the file and failing
 * them would destroy the corpus the finding rests on; what it must not do is read as clean.
 */
export function checkDispatch(runDir: string): DispatchCheck {
  const plan = loadPlan(runDir);
  const planned = new Map<string, string>(plan.branches.map((b) => [`branch:${b.frame}`, b.agent]));
  const rec = readJsonIf(join(runDir, "dispatch.json"), (v) => DispatchRecordSchema.parse(v));
  if (!rec)
    return {
      recorded: false,
      substitutions: [],
      missing: [...planned.keys()],
      text: [
        "dispatch: not recorded. This run does not say which subagent type produced each artifact,",
        "  so plan.json's `agent` field is an intention rather than a fact. See D41.",
      ].join("\n"),
    };

  const seen = new Set(rec.entries.map((e) => e.task));
  const missing = [...planned.keys()].filter((t) => !seen.has(t));
  const substitutions = rec.entries.filter((e) => e.actual !== e.planned);
  const lines = [`dispatch: ${rec.entries.length} task(s) recorded`];
  for (const e of rec.entries.filter((x) => planned.has(x.task) && planned.get(x.task) !== x.planned))
    lines.push(`  ${e.task}: record says planned ${e.planned}, plan.json says ${planned.get(e.task)}`);
  if (missing.length) lines.push(`  no dispatch recorded for: ${missing.join(", ")}`);
  for (const e of substitutions) lines.push(`  SUBSTITUTED ${e.task}: planned ${e.planned}, spawned ${e.actual} — ${e.note}`);
  if (!substitutions.length && !missing.length) lines.push("  every task ran on the agent the plan named");
  return { recorded: true, substitutions, missing, text: lines.join("\n") };
}

export function phaseCritique(cfg: Config, runDir: string): PhaseResult {
  const plan = loadPlan(runDir);
  const problem = rd(join(runDir, "problem.txt"));
  const criticDir = join(runDir, "critic");
  const passAPath = join(criticDir, "pass-a.yaml");
  const passBPath = join(criticDir, "pass-b.yaml");
  const { branches } = loadBranches(runDir, plan);
  const valid = validArtifacts(branches);
  const invalid = branches.flatMap((b) => (b.ok ? [] : [b]));
  const lints = collectLints(branches);
  wr(join(criticDir, "lints.json"), JSON.stringify(lints, null, 2) + "\n");
  wr(join(criticDir, "violations.json"), JSON.stringify(invalid.map((v) => ({ frame: v.frame, violations: v.violations })), null, 2) + "\n");
  if (valid.length === 0) throw new RunAbort("no valid branch artifacts. Every branch violated the contract.", "ALL_INVALID");

  // State 1: build pass A brief.
  if (!existsSync(passAPath)) {
    const rng = mulberry32(deriveSeed(plan.seed, 2));
    const shuffled = shuffle(valid, rng);
    const blindMap: Record<string, string> = {};
    // A branch may name its own frame in prose ("from inside the Door keeper stance"). Redact
    // every identifying label, id and display name alike, from the text pass A sees. Labels the
    // problem itself uses are left alone: they cannot say which branch wrote the artifact.
    const redact = (text: string) => redactFrameLabels(text, cfg.frames.frames, { problem });
    const blindArtifacts = shuffled.map((a, i) => {
      const L = letterFor(i);
      blindMap[L] = a.frame;
      const { frame: _f, ...rest } = a;
      return `### Artifact ${L}\n\n\`\`\`yaml\n${redact(yamlBlock(rest))}\n\`\`\``;
    });
    wr(join(criticDir, "blind-map.json"), JSON.stringify(blindMap, null, 2) + "\n");
    const brief = render(cfg.prompts.criticPassA, {
      problem,
      problem_hash: plan.problem_hash,
      rubric: { dimensions: renderRubric(cfg) },
      artifacts_blind: blindArtifacts.join("\n\n"),
    });
    const leaks = checkBlind(brief, cfg.frames.frames, { problem });
    if (leaks.length) throw new RunAbort(`pass A brief is not blind: ${leaks.join("; ")}`, "BLIND_LEAK");
    const briefPath = join(criticDir, "pass-a.brief.md");
    wr(briefPath, brief);
    return {
      text: [
        `critique: ${valid.length} valid artifact(s), ${invalid.length} contract violation(s) (pruned), ${lints.length} lint hint(s).`,
        `pass A brief written (blind, ${shuffled.length} letters).`,
        // D41: say what actually produced these artifacts before scoring them. A pack built by an
        // agent the plan did not name is still scorable, but the reader has to be told.
        checkDispatch(runDir).text,
        `next: spawn adhd-critic with ${briefPath} as the prompt; write its final message to ${passAPath}; run this phase again.`,
        `  and append a dispatch.json entry for critique:pass-a naming the agent you actually spawned.`,
      ].join("\n"),
      next: [{ kind: "spawn", agent: "adhd-critic", brief: briefPath, artifact: passAPath }],
      exitCode: 0,
    };
  }

  const blindMap = JSON.parse(rd(join(criticDir, "blind-map.json"))) as Record<string, string>;
  const letters = Object.keys(blindMap);
  const rubricVersion = plan.rubric_version ?? 0;
  const runDims = dimensionsAt(cfg.rubric.dimensions, rubricVersion);
  const passA = validatePassA(rd(passAPath), plan.problem_hash, letters, runDims.map((d) => d.id));
  const scoresByFrame = passAScores(cfg, passA, blindMap, rubricVersion);

  // State 2: build pass B brief.
  if (!existsSync(passBPath)) {
    const labelled = valid.map((a) => `### ${a.frame}\n\n\`\`\`yaml\n${yamlBlock(a)}\n\`\`\``).join("\n\n");
    const scoresText = Object.entries(scoresByFrame)
      .map(([f, s]) => {
        const L = letters.find((l) => blindMap[l] === f)!;
        return `- ${f} (was ${L}): ${s.toFixed(2)}`;
      })
      .join("\n");
    const lintsText = lints.length
      ? lints.map((l) => `- ${l.frame === "*" ? "run level" : l.frame} ${l.trap}: ${l.evidence}`).join("\n")
      : "(no lint fired)";
    const brief = render(cfg.prompts.criticPassB, {
      problem,
      problem_hash: plan.problem_hash,
      artifacts_labelled: labelled,
      pass_a_scores: scoresText,
      lints: lintsText,
      trap_detectors: renderDetectors(cfg.trapsDoc),
    });
    const briefPath = join(criticDir, "pass-b.brief.md");
    wr(briefPath, brief);
    return {
      text: [
        `pass A validated: ${letters.length} letters x ${runDims.length} dimensions.`,
        `pass B brief written (unblind).`,
        `next: send ${briefPath} to the SAME critic subagent; write its final message to ${passBPath}; then --phase deepen.`,
      ].join("\n"),
      next: [{ kind: "spawn", agent: "adhd-critic", brief: briefPath, artifact: passBPath }],
      exitCode: 0,
    };
  }

  // State 3: both present.
  validatePassB(rd(passBPath), plan.problem_hash, valid.map((a) => a.frame), cfg.rubric.hard_rules.min_evidence_words_on_fire);
  return { text: ["critique complete.", checkDispatch(runDir).text, "next: --phase deepen."].join("\n"), exitCode: 0 };
}

// ---- deepen -----------------------------------------------------------------------------

export function computeScore(cfg: Config, runDir: string): { plan: Plan; score: ScoreResult; branches: BranchValidation[] } {
  const plan = loadPlan(runDir);
  const criticDir = join(runDir, "critic");
  const passBPath = join(criticDir, "pass-b.yaml");
  if (!existsSync(passBPath)) throw new RunAbort("critic/pass-b.yaml missing. Finish --phase critique first.", "NO_PASS_B");
  const { branches } = loadBranches(runDir, plan);
  const valid = validArtifacts(branches);
  const blindMap = JSON.parse(rd(join(criticDir, "blind-map.json"))) as Record<string, string>;
  const synthVersion = plan.rubric_version ?? 0;
  const passA = validatePassA(
    rd(join(criticDir, "pass-a.yaml")),
    plan.problem_hash,
    Object.keys(blindMap),
    dimensionsAt(cfg.rubric.dimensions, synthVersion).map((d) => d.id),
  );
  const passB = validatePassB(rd(passBPath), plan.problem_hash, valid.map((a) => a.frame), cfg.rubric.hard_rules.min_evidence_words_on_fire);
  const lints = existsSync(join(criticDir, "lints.json")) ? (JSON.parse(rd(join(criticDir, "lints.json"))) as LintHint[]) : collectLints(branches);
  const score = scoreRun(cfg, branches, passAScores(cfg, passA, blindMap, synthVersion), passB, lints);
  wr(join(runDir, "score.json"), JSON.stringify(score, null, 2) + "\n");
  return { plan, score, branches };
}

export function phaseDeepen(cfg: Config, runDir: string): PhaseResult {
  const { plan, score, branches } = computeScore(cfg, runDir);
  const problem = rd(join(runDir, "problem.txt"));
  if (!score.proceed) {
    return {
      text: ["deepen refused. Run level failure:", ...score.run_level.notes.map((n) => `  - ${n}`), "Run --phase synth to render what exists."].join("\n"),
      exitCode: 2,
    };
  }
  const byFrame = new Map(validArtifacts(branches).map((a) => [a.frame, a]));
  const next: PhaseResult["next"] = [];
  for (const c of score.clusters) {
    if (!c.representative) continue;
    const a = byFrame.get(c.representative)!;
    // A survivor never sees the other survivors. The critic wrote the objection with every
    // label in view and may have named them; strip every frame id but the survivor's own.
    const objection = c.strongest_objection ?? "(the critic recorded no objection; defend against the strongest one you can construct yourself)";
    const redacted = redactFrameLabels(objection, cfg.frames.frames, {
      keep: a.frame,
      problem,
      replacement: "another line of reasoning",
    });
    const brief = render(cfg.prompts.deepen, {
      problem,
      problem_hash: plan.problem_hash,
      frame: { id: a.frame },
      survivor_artifact: yamlBlock(a),
      strongest_objection: redacted,
    });
    const leaks = checkBriefIsolation(brief, a.frame, cfg.frames.frames, { problem });
    if (leaks.length) throw new RunAbort(`deepen brief for ${a.frame} is not isolated: ${leaks.join("; ")}`, "DEEPEN_LEAK");
    const briefPath = join(runDir, "deepen", `${a.frame}.brief.md`);
    const artifactPath = join(runDir, "deepen", `${a.frame}.yaml`);
    wr(briefPath, brief);
    next.push({ kind: "spawn", agent: "adhd-deepen", brief: briefPath, artifact: artifactPath });
  }
  return {
    text: [
      `score.json written. ${score.frames.filter((f) => f.status === "survivor").length} survivor(s) in ${next.length} cluster(s); ${score.frames.filter((f) => f.status === "pruned").length} pruned.`,
      ...score.run_level.notes.map((n) => `  note: ${n}`),
      `next: for each brief below spawn a FRESH adhd-deepen subagent, write its final message to the artifact path, then --phase synth.`,
      ...next.map((n) => `  ${n.brief} -> ${n.artifact}`),
    ].join("\n"),
    next,
    exitCode: 0,
  };
}

// ---- synth ------------------------------------------------------------------------------

function costFor(runDir: string, plan: Plan): { tokens: number | string; wall: string } {
  const p = join(runDir, "cost.json");
  if (existsSync(p)) {
    const c = JSON.parse(rd(p)) as { tokens?: number; wall?: string };
    return { tokens: c.tokens ?? plan.estimate.tokens_total, wall: c.wall ?? "n/a" };
  }
  const started = Date.parse(plan.created_at);
  const secs = Math.max(0, Math.round((Date.now() - started) / 1000));
  return { tokens: `~${plan.estimate.tokens_total.toLocaleString()} (estimate)`, wall: `${secs}s since compile` };
}

/**
 * The synthesis a run's artifacts produce, without writing anything.
 *
 * Split out of `phaseSynth` so a recorded run can be re-rendered and compared against the
 * synthesis it shipped with (`adhd replay`). A recorded synthesis is evidence, and a check that
 * has to overwrite the evidence to run is not a check.
 */
export function renderRun(cfg: Config, runDir: string, opts: { partial?: boolean } = {}): string {
  const plan = loadPlan(runDir);
  if (opts.partial) {
    const { branches } = loadBranches(runDir, plan, { allowMissing: true });
    return renderPartial(cfg, plan, branches, collectLints(branches), costFor(runDir, plan));
  }
  const { plan: p2, score } = computeScore(cfg, runDir);
  const deepenDir = join(runDir, "deepen");
  const deepen: Record<string, DeepenArtifact> = {};
  if (existsSync(deepenDir)) {
    for (const f of readdirSync(deepenDir).filter((x) => x.endsWith(".yaml"))) {
      const frame = f.replace(/\.yaml$/, "");
      deepen[frame] = validateDeepen(rd(join(deepenDir, f)), p2.problem_hash, frame);
    }
  }
  const body = renderSynthesis(cfg, p2, score, deepen, costFor(runDir, p2));
  /*
   * D41. A substitution reaches the reader, for the same reason the pruned block does: a run whose
   * critic was not the critic is a run whose scoring means something different, and the person
   * acting on the recommendation is the one who needs to know. Appended rather than threaded
   * through `renderSynthesis`, which takes what it scores and has no business reading the run
   * directory.
   */
  const dispatch = checkDispatch(runDir);
  /*
   * A run with no dispatch.json renders exactly as it did before D41. That is deliberate and it is
   * the narrower choice: every one of the fifteen recorded runs predates the file, and appending a
   * section to all of them would rewrite the corpus that item 4's finding rests on to accommodate a
   * feature added afterwards. `adhd replay` is the guard that caught the attempt.
   *
   * The absence is not swallowed. `runPhase` prints it to the operator at critique and at synth,
   * and `adhd doctor` reports which recordings lack it. What does not happen is a historical
   * synthesis quietly gaining a paragraph its run never produced.
   */
  if (!dispatch.recorded || (!dispatch.substitutions.length && !dispatch.missing.length)) return body;
  const lines = ["", "## Dispatch", ""];
  if (dispatch.substitutions.length) {
    lines.push("**This run did not use the agents its plan named.** A subagent type selects a system", "prompt, so a substituted agent ran different instructions on the same brief.", "");
    for (const e of dispatch.substitutions) lines.push(`- \`${e.task}\`: planned \`${e.planned}\`, spawned \`${e.actual}\` — ${e.note}`);
  }
  if (dispatch.missing.length) {
    lines.push("", `No dispatch was recorded for: ${dispatch.missing.join(", ")}.`);
  }
  return `${body}\n${lines.join("\n")}\n`;
}

export function phaseSynth(cfg: Config, runDir: string, opts: { partial?: boolean } = {}): PhaseResult {
  const text = renderRun(cfg, runDir, opts);
  wr(join(runDir, "synthesis.md"), text);
  // To the operator, not into the file. See the note in renderRun about why the corpus is exempt.
  const dispatch = checkDispatch(runDir);
  return { text: dispatch.recorded && !dispatch.substitutions.length && !dispatch.missing.length ? text : `${text}\n\n${dispatch.text}`, exitCode: 0 };
}

export type Phase = "compile" | "critique" | "deepen" | "synth";

export function runPhase(cfg: Config, phase: Phase, opts: { runDir?: string; partial?: boolean } & Partial<CompileArgs>): PhaseResult {
  switch (phase) {
    case "compile":
      if (!opts.problemPath || opts.decision === undefined) throw new ContractError("compile", ["--problem and --decision are required"]);
      return phaseCompile(cfg, { problemPath: opts.problemPath, decision: opts.decision, runsDir: opts.runsDir, seed: opts.seed, runId: opts.runId });
    case "critique":
      if (!opts.runDir) throw new ContractError("critique", ["--run is required"]);
      return phaseCritique(cfg, opts.runDir);
    case "deepen":
      if (!opts.runDir) throw new ContractError("deepen", ["--run is required"]);
      return phaseDeepen(cfg, opts.runDir);
    case "synth":
      if (!opts.runDir) throw new ContractError("synth", ["--run is required"]);
      return phaseSynth(cfg, opts.runDir, { partial: opts.partial });
  }
}

export { parseYaml };
