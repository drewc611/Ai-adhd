/**
 * A mission: work that takes minutes to hours, with stages that are not all the same kind.
 *
 * The kernel in `src/os.ts` already schedules the four ADHD phases and does it well, but its
 * phase enum is those four and widening it would weaken the invariants that enum encodes. So a
 * mission sits above the kernel rather than inside it: it owns a stage graph, and when a stage
 * needs divergent reasoning it submits an ordinary run to the kernel and waits for the result.
 *
 * The three non-negotiables in CLAUDE.md apply here unchanged, and each one shapes a file:
 *
 *   - **The orchestrator never reasons.** The planner compiles briefs and validates artifacts.
 *     `assertNoReasoning` fails a stage whose orchestrator output carries a candidate answer.
 *   - **Branches never see siblings.** A mission has memory and a message gateway, and both are
 *     exactly the mechanisms by which a sibling's output would reach a branch. `memory.ts` and
 *     `gateway.ts` refuse that delivery mechanically rather than by convention.
 *   - **Every gate is mechanical.** No stage advances on a judgement call. Each one names a
 *     contract, and `verifyStage` runs it.
 *
 * Nothing here calls a model. A stage produces a brief and a contract; the host supplies the
 * reasoning by spawning a subagent, exactly as the run phases do.
 */

import { z } from "zod";

/**
 * What a stage is for, which decides its agent, its tool grant and its artifact contract.
 *
 * `diverge` is the odd one: it does not run a subagent directly, it submits a run to the kernel
 * and adopts the synthesis. That is the point of having it in the list — a mission that needs a
 * hard decision made well uses the thing this repository is, rather than asking one agent nicely.
 */
export const STAGE_KINDS = ["research", "diverge", "build", "verify", "create", "review"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/**
 * How long the mission is allowed to be, which is a different question from how much it may
 * spend. A `deep` mission with a small budget is a long series of cheap stages; a `quick` one
 * with a large budget is a short expensive one. Conflating them gives you one knob that is
 * wrong for both.
 */
export const MISSION_CLASSES = ["quick", "standard", "deep"] as const;
export type MissionClass = (typeof MISSION_CLASSES)[number];

export interface ClassPolicy {
  /** Wall clock before the mission is considered stalled and its stages reclaimable. */
  leaseSeconds: number;
  /** Total reported tokens across every stage. */
  budgetTokens: number;
  /** Stages before the mission checkpoints and can be resumed from disk. */
  checkpointEvery: number;
  /** Attempts a stage gets before it is marked dead rather than retried forever. */
  maxAttempts: number;
}

/**
 * Measured against `adhd os stats`, not chosen for roundness. Over the recorded runs the longest
 * single task took 280s, so a `quick` lease of 600s is twice the worst case seen; `deep` is sized
 * for a stage that shells out to a test suite and waits.
 */
export const CLASS_POLICY: Record<MissionClass, ClassPolicy> = {
  quick: { leaseSeconds: 600, budgetTokens: 60_000, checkpointEvery: 1, maxAttempts: 2 },
  standard: { leaseSeconds: 1_800, budgetTokens: 400_000, checkpointEvery: 1, maxAttempts: 3 },
  deep: { leaseSeconds: 5_400, budgetTokens: 2_000_000, checkpointEvery: 1, maxAttempts: 3 },
};

/**
 * D4, generalised. A stage gets the tools its kind needs and nothing else, and the grant is data
 * rather than a sentence in a prompt, so `adhd doctor` can check it against the agent definitions
 * the way it already checks the frames'.
 *
 * `build` has no network on purpose. A build stage that can fetch is a build stage that can fetch
 * a dependency nobody reviewed, and the sandbox policy is the wrong place to catch that because
 * by then it is already in the tree.
 */
export const STAGE_TOOLS: Record<StageKind, readonly string[]> = {
  research: ["WebSearch", "WebFetch", "Read", "Glob", "Grep"],
  diverge: [],
  build: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  verify: ["Read", "Glob", "Grep", "Bash"],
  create: ["Read", "Write", "Glob", "Grep"],
  review: ["Read", "Glob", "Grep"],
};

/**
 * Which agent runs a stage, or `null` for the one stage kind that runs none.
 *
 * `diverge` is null because it does not spawn an agent: it submits a run and the kernel dispatches
 * the branch and critic agents itself. Naming `adhd-branch` here was wrong in a way `adhd doctor`
 * caught on the check's first run — a run agent's tool grant is fixed by D4 at `TaskList` and
 * nothing else, and a stage grant pointing at it either has to be empty or has to widen an agent
 * whose emptiness is the point.
 *
 * `review` gets its own agent for the same reason. Reusing `adhd-critic` would mean either a
 * reviewer that cannot open the file it is reviewing, or a run critic that can read the run
 * directory, and the second is the thing the architecture prevents.
 *
 * `build` and `verify` are two agents rather than one for a third instance of the same argument,
 * also found by the doctor check rather than by design. A tool grant is per agent, so one agent
 * serving both kinds carries the union, and the union means a verify stage can write. A stage that
 * checks its own work and can edit it is not a check.
 */
export const STAGE_AGENT: Record<StageKind, string | null> = {
  research: "adhd-researcher",
  diverge: null,
  build: "adhd-builder",
  verify: "adhd-verifier",
  create: "adhd-maker",
  review: "adhd-reviewer",
};

export const SandboxPolicySchema = z
  .object({
    /** Paths the stage may write, relative to the sandbox root. Empty means the whole sandbox. */
    writable: z.array(z.string()).default([]),
    /** Whether the stage's agent carries network tools. Independent of the sandbox filesystem. */
    network: z.boolean().default(false),
    /** Commands `verify` may run. An allowlist, because a verify stage runs whatever it is told. */
    commands: z.array(z.string()).default([]),
  })
  .strict();
export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>;

export const StageSchema = z
  .object({
    id: z.string(),
    kind: z.enum(STAGE_KINDS),
    label: z.string(),
    /** Stage ids that must be `done` before this one is claimable. */
    after: z.array(z.string()).default([]),
    /**
     * What the stage must produce for `verifyStage` to pass it. Mechanical, always: a file that
     * must exist, keys that must be present, a command that must exit zero.
     */
    contract: z
      .object({
        artifact: z.string(),
        requires: z.array(z.string()).default([]),
        command: z.string().nullable().default(null),
        min_words: z.number().int().nonnegative().default(0),
      })
      .strict(),
    /** Set when kind is `diverge`: the kernel run this stage is waiting on. */
    run_id: z.string().nullable().default(null),
    status: z.enum(["blocked", "pending", "leased", "done", "failed", "dead", "dropped"]).default("blocked"),
    worker: z.string().nullable().default(null),
    lease_until: z.string().nullable().default(null),
    attempts: z.number().int().default(0),
    tokens: z.number().int().nullable().default(null),
    started_at: z.string().nullable().default(null),
    finished_at: z.string().nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict();
export type Stage = z.infer<typeof StageSchema>;

export const MissionSchema = z
  .object({
    mission_id: z.string(),
    goal: z.string(),
    /** sha256 of the goal, checked on every stage return. The run-level `problem_hash`, one level up. */
    goal_hash: z.string(),
    mission_class: z.enum(MISSION_CLASSES),
    state: z.enum(["awaiting_confirm", "running", "blocked", "done", "cancelled", "aborted"]),
    created_at: z.string(),
    updated_at: z.string(),
    confirmed_at: z.string().nullable().default(null),
    finished_at: z.string().nullable().default(null),
    budget_tokens: z.number().int().positive(),
    spent_tokens: z.number().int().default(0),
    sandbox: SandboxPolicySchema,
    stages: z.array(StageSchema),
    reason: z.string().nullable().default(null),
  })
  .strict();
export type Mission = z.infer<typeof MissionSchema>;

/**
 * Phrases an orchestrator writes when it has started answering the question instead of routing
 * it. Deliberately short and deliberately about *commitment*, not about topic: a planner may
 * name the subject freely, and the moment it says which option to take it has done the branches'
 * job with none of their isolation.
 */
const REASONING_MARKERS = [
  /\bthe (?:best|right|correct) (?:answer|approach|option|choice) is\b/i,
  /\bI (?:recommend|suggest|would (?:go with|choose|pick))\b/i,
  /\bwe should (?:use|choose|pick|adopt|go with)\b/i,
  /\bmy (?:recommendation|conclusion|view|take) is\b/i,
  /\bthe (?:answer|solution) (?:is|would be)\b/i,
  /\bin conclusion\b/i,
];

/**
 * CLAUDE.md: "The orchestrator never reasons. Add a test that fails the run if orchestrator
 * output contains a candidate answer." This is that check, applied to every brief the planner
 * emits rather than only to the run orchestrator, because a mission planner writes far more
 * prose than a run orchestrator ever did and is correspondingly easier to let slip.
 */
export function assertNoReasoning(where: string, text: string): string[] {
  return REASONING_MARKERS.filter((re) => re.test(text)).map(
    (re) => `${where} contains a candidate answer (${re.source}); the orchestrator routes, it does not decide`,
  );
}

export function stageById(m: Mission, id: string): Stage | undefined {
  return m.stages.find((s) => s.id === id);
}

/** Stages whose dependencies are all `done`. Pure, so the scheduler and the CLI agree. */
export function unblocked(m: Mission): Stage[] {
  const done = new Set(m.stages.filter((s) => s.status === "done").map((s) => s.id));
  return m.stages.filter((s) => s.status === "blocked" && s.after.every((a) => done.has(a)));
}

/**
 * A cycle in `after` is a mission that can never advance and looks exactly like one that is
 * merely waiting. Kahn's algorithm rather than a visited-set walk, because the useful output is
 * the set of stages left over, which is the cycle itself.
 */
export function planProblems(stages: Stage[]): string[] {
  const out: string[] = [];
  const ids = new Set(stages.map((s) => s.id));
  if (ids.size !== stages.length) out.push("two stages share an id");
  for (const s of stages) {
    for (const a of s.after) if (!ids.has(a)) out.push(`stage ${s.id} waits on ${a}, which is not in the plan`);
    if (s.after.includes(s.id)) out.push(`stage ${s.id} waits on itself`);
  }

  const indegree = new Map(stages.map((s) => [s.id, s.after.filter((a) => ids.has(a)).length]));
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  const settled = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    settled.add(id);
    for (const s of stages) {
      if (!s.after.includes(id)) continue;
      const d = indegree.get(s.id)! - 1;
      indegree.set(s.id, d);
      if (d === 0) queue.push(s.id);
    }
  }
  const cycle = stages.filter((s) => !settled.has(s.id)).map((s) => s.id);
  if (cycle.length) out.push(`stages form a cycle and can never start: ${cycle.sort().join(", ")}`);
  return out;
}
