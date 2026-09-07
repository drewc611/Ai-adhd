// Zod schemas for everything the library reads or writes. Every object schema is .strict():
// an unknown key is a hard failure. That property is load bearing for the routing decision
// (the orchestrator has no field to reason into) and convenient everywhere else.
import { z } from "zod";

export const TRAP_IDS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"] as const;
export type TrapId = (typeof TRAP_IDS)[number];
export const TrapIdSchema = z.enum(TRAP_IDS);

export const FRAME_ID_RE = /^[A-Z][A-Z_]*$/;
export const FrameIdSchema = z.string().regex(FRAME_ID_RE, "frame id must be UPPER_SNAKE");

export const TOOL_NAMES = ["WebSearch", "WebFetch"] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);

// ---- config/frames.yaml ---------------------------------------------------------------

export const FrameSchema = z
  .object({
    id: FrameIdSchema,
    name: z.string().min(1),
    axis: z.string().regex(/^[a-z][a-z_]*$/),
    attacks: z.array(TrapIdSchema).min(1),
    tools: z.array(ToolNameSchema).default([]),
    stance: z.string().min(40),
    probes: z.array(z.string().min(1)).min(1),
    forbidden: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type Frame = z.infer<typeof FrameSchema>;

export const FramesFileSchema = z
  .object({ version: z.number().int(), frames: z.array(FrameSchema).min(1) })
  .strict();
export type FramesFile = z.infer<typeof FramesFileSchema>;

// ---- config/routing.yaml --------------------------------------------------------------

export const RunClassSchema = z
  .object({
    action: z.literal("run"),
    description: z.string().min(1),
    signals: z.array(z.string()).default([]),
    frames: z.array(FrameIdSchema).min(1),
    alternates: z.array(FrameIdSchema).default([]),
    n: z.number().int().min(1).optional(),
  })
  .strict();
export const DeclineClassSchema = z
  .object({
    action: z.literal("decline"),
    reason: z.string().min(1),
    signals: z.array(z.string()).default([]),
  })
  .strict();
export const ProblemClassSchema = z.discriminatedUnion("action", [RunClassSchema, DeclineClassSchema]);
export type RunClass = z.infer<typeof RunClassSchema>;
export type ProblemClass = z.infer<typeof ProblemClassSchema>;

export const RoutingDefaultsSchema = z
  .object({
    max_branches: z.number().int().min(1),
    hard_cap: z.number().int().min(1),
    min_branches: z.number().int().min(1),
    require_confirmation: z.boolean(),
    shuffle_frames: z.boolean(),
    seed: z.union([z.literal("random"), z.number().int()]),
    tokens_per_branch_estimate: z.number().int().positive(),
    branch_tools_allowed: z.array(ToolNameSchema),
  })
  .strict();

export const RoutingFileSchema = z
  .object({
    version: z.number().int(),
    defaults: RoutingDefaultsSchema,
    // Documentation of the decision object. The executable schema is built in
    // validate.ts from the class names and frame ids, so this block is informational.
    decision_schema: z.record(z.string(), z.unknown()),
    classes: z.record(z.string().regex(/^[a-z][a-z_]*$/), ProblemClassSchema),
  })
  .strict();
export type RoutingFile = z.infer<typeof RoutingFileSchema>;

// ---- config/critic-rubric.yaml --------------------------------------------------------

export const DimensionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z_]*$/),
    weight: z.number().positive(),
    question: z.string().min(1),
    anchors: z.record(z.string(), z.string()),
  })
  .strict();
export type Dimension = z.infer<typeof DimensionSchema>;

export const HardRulesSchema = z
  .object({
    prune_on_any_fired_trap: z.boolean(),
    contract_violation_prunes: z.boolean(),
    hash_mismatch_aborts_run: z.boolean(),
    missing_detector_record_rejects_pass_b: z.boolean(),
    singleton: z.literal("escalate_flagged"),
    cluster_min_size: z.number().int().min(2),
    monoculture_fraction: z.number().gt(0).lte(1),
    scatter: z.object({ min_n: z.number().int(), requires_cluster_of: z.number().int() }).strict(),
    run_level_t2_if_no_branch_attacks_assumption: z.boolean(),
    lint_disagreement_is_reported_not_resolved: z.boolean(),
    min_evidence_words_on_fire: z.number().int().min(0).default(0),
  })
  .strict();

export const RubricFileSchema = z
  .object({
    version: z.number().int(),
    scale: z.object({ min: z.number().int(), max: z.number().int() }).strict(),
    dimensions: z.array(DimensionSchema).min(1),
    not_scored: z.array(z.string()),
    pass_b: z.record(z.string(), z.unknown()),
    hard_rules: HardRulesSchema,
    aggregation: z
      .object({ method: z.literal("weighted_mean_normalised"), range: z.tuple([z.number(), z.number()]) })
      .strict(),
  })
  .strict();
export type RubricFile = z.infer<typeof RubricFileSchema>;

// ---- artifacts ------------------------------------------------------------------------

export const BranchArtifactSchema = z
  .object({
    problem_hash: z.string().min(1),
    frame: FrameIdSchema,
    position: z.string().min(1),
    reasoning: z.string().min(1),
    forecloses: z.array(z.string().min(1)).min(1),
    falsifier: z.string().min(1),
    missing_actor: z.string().min(1).nullable(),
    confidence: ConfidenceSchema,
  })
  .strict();
export type BranchArtifact = z.infer<typeof BranchArtifactSchema>;

export const ScoreCellSchema = z
  .object({ score: z.number().int().min(0).max(3), evidence: z.string() })
  .strict();
export const PassASchema = z
  .object({
    problem_hash: z.string().min(1),
    pass: z.literal("A"),
    scores: z.record(z.string(), z.record(z.string(), ScoreCellSchema)),
  })
  .strict();
export type PassA = z.infer<typeof PassASchema>;

export const DetectorRecordSchema = z.object({ fired: z.boolean(), evidence: z.string() }).strict();
export type DetectorRecord = z.infer<typeof DetectorRecordSchema>;
export const ClusterSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    members: z.array(FrameIdSchema).min(1),
    singleton: z.boolean(),
    strongest_objection: z.string().nullable(),
  })
  .strict();
export type Cluster = z.infer<typeof ClusterSchema>;
export const LintVerdictSchema = z
  .object({
    frame: FrameIdSchema,
    trap: TrapIdSchema,
    lint_said: z.boolean(),
    critic_says: z.boolean(),
    evidence: z.string(),
  })
  .strict();
export const PassBSchema = z
  .object({
    problem_hash: z.string().min(1),
    pass: z.literal("B"),
    clusters: z.array(ClusterSchema).min(1),
    traps: z.record(FrameIdSchema, z.record(TrapIdSchema, DetectorRecordSchema)),
    run_level: z
      .object({
        T2_no_branch_attacked_assumption: DetectorRecordSchema,
        T6_all_missing_actor_null: DetectorRecordSchema,
      })
      .strict(),
    lint_verdicts: z.array(LintVerdictSchema).default([]),
  })
  .strict();
export type PassB = z.infer<typeof PassBSchema>;

export const DeepenArtifactSchema = z
  .object({
    problem_hash: z.string().min(1),
    frame: FrameIdSchema,
    verdict: z.enum(["defend", "fold"]),
    response: z.string().min(1),
    revised_position: z.string().nullable(),
    revised_falsifier: z.string().nullable().optional(),
    confidence: ConfidenceSchema,
  })
  .strict();
export type DeepenArtifact = z.infer<typeof DeepenArtifactSchema>;

// ---- plan.json -------------------------------------------------------------------------

export const PlanBranchSchema = z
  .object({
    frame: FrameIdSchema,
    axis: z.string(),
    agent: z.enum(["adhd-branch", "adhd-branch-search"]),
    tools: z.array(ToolNameSchema),
    brief_path: z.string(),
    artifact_path: z.string(),
  })
  .strict();
export const PlanSchema = z
  .object({
    run_id: z.string(),
    created_at: z.string(),
    problem_hash: z.string(),
    problem_class: z.string(),
    seed: z.number().int(),
    n: z.number().int(),
    allow_wide: z.boolean(),
    estimate: z
      .object({
        tokens_branches: z.number().int(),
        tokens_critic: z.number().int(),
        tokens_deepen: z.number().int(),
        tokens_total: z.number().int(),
      })
      .strict(),
    branches: z.array(PlanBranchSchema).min(1),
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;

// ---- evals/fixtures/*.yaml -----------------------------------------------------------

export const ScopeSchema = z.enum(["all", "pruned", "recommendation"]);
export const MustSurfaceSchema = z
  .object({
    id: z.string().min(1),
    trap: TrapIdSchema.optional(),
    description: z.string().min(1),
    scope: ScopeSchema.default("all"),
    any_of: z.array(z.string().min(1)).min(1),
  })
  .strict();
const mustNotBase = {
  id: z.string().min(1),
  trap: TrapIdSchema.optional(),
  description: z.string().min(1),
  scope: ScopeSchema.default("recommendation"),
};
export const MustNotSchema = z.discriminatedUnion("check", [
  z
    .object({ ...mustNotBase, check: z.literal("min_words_outside"), pattern: z.string().min(1), min_words: z.number().int().positive() })
    .strict(),
  z.object({ ...mustNotBase, check: z.literal("must_match"), any_of: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ ...mustNotBase, check: z.literal("must_be_imperative") }).strict(),
  z
    .object({ ...mustNotBase, check: z.literal("max_list_items_without_imperative"), max_items: z.number().int().positive() })
    .strict(),
]);
export const FixtureSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    problem_class: z.string().min(1),
    seed: z.number().int(),
    prompt: z.string().min(1),
    why: z.string().optional(),
    must_surface: z.array(MustSurfaceSchema).default([]),
    must_not: z.array(MustNotSchema).default([]),
    expect: z
      .object({
        pruned_min: z.number().int().min(0).optional(),
        pruned_traps_include_any: z.array(TrapIdSchema).optional(),
        monoculture: z.boolean().optional(),
        scatter: z.boolean().optional(),
        /**
         * The run must never happen. Routing declines the class, so there is no synthesis, no
         * pruned block and nothing to record: the fixture asserts the decision itself. A decline
         * is a first-class outcome and it was the only one nothing tested.
         */
        decline: z.boolean().default(false),
        /** Substrings the decline reason must contain, so a reason cannot rot into "no". */
        reason_includes: z.array(z.string().min(1)).default([]),
        /**
         * The problem statement is hostile: it tries to converge the branches. Asserted at the
         * D5 gate, where a human sees the warning before anything is spent. Independent of
         * `decline`, and of whether a run was recorded.
         */
        injection_warnings_min: z.number().int().positive().optional(),
      })
      .strict()
      .default({ decline: false, reason_includes: [] }),
  })
  .strict()
  // A run fixture with no must_surface asserts nothing and would pass on any output at all.
  .refine((f) => f.expect.decline || f.expect.injection_warnings_min !== undefined || f.must_surface.length > 0, {
    message: "must_surface is required unless expect.decline or expect.injection_warnings_min is set",
    path: ["must_surface"],
  })
  .refine((f) => !f.expect.decline || (f.must_surface.length === 0 && f.must_not.length === 0), {
    message: "a declined fixture has no output to assert against; drop must_surface and must_not",
    path: ["expect", "decline"],
  });
export type Fixture = z.infer<typeof FixtureSchema>;

export const RecordedExpectationSchema = z
  .object({
    outcome: z.enum(["pass", "fail"]),
    note: z.string().optional(),
    /** A hand written consensus answer that exists to fail. Audited separately from real runs. */
    control: z.boolean().default(false),
  })
  .strict();
