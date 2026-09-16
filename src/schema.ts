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
    /**
     * Ids this frame has been renamed from. Recorded runs write the id that was current when
     * they ran, into plan.json, blind-map.json, score.json, branch filenames and the append-only
     * os.json journal. Rewriting those to match a rename would make a run's record claim a frame
     * ran that did not exist yet, so the record stays as written and the library forwards.
     *
     * These are not redaction tokens. A frame is renamed precisely because its old label was
     * ordinary prose, and re-adding it to the redactor would reinstate the collision the rename
     * exists to remove.
     */
    former_ids: z.array(FrameIdSchema).default([]),
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
    /**
     * The rubric version this dimension stopped being scored in (D34). A run scored under an
     * earlier version still includes it; the critic is no longer asked for it.
     *
     * Retiring rather than deleting is what keeps the recorded corpus readable. `validatePassA`
     * rejects a dimension the rubric does not list, so deleting `foreclosure` outright made all
     * seven recorded runs unreadable — not merely non-comparable — and took `replay`, `learn`,
     * `why` and the viewer down with them. The dimension stays in the file, with its weight, as
     * the record of what version 0 asked.
     */
    retired_in: z.number().int().positive().optional(),
  })
  .strict();
export type Dimension = z.infer<typeof DimensionSchema>;

/**
 * The dimensions in force at a given rubric version. A run is scored with the set its own
 * version declared, never with whatever the file says today.
 */
export function dimensionsAt(dimensions: Dimension[], version: number): Dimension[] {
  return dimensions.filter((d) => d.retired_in === undefined || version < d.retired_in);
}

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
    /**
     * The frame's definition when this branch was dispatched (catalogue 53). Optional, because
     * every run recorded before this existed has none, and inventing one for them would claim
     * knowledge the corpus does not have. `adhd frames --drift` reports those as unknown.
     */
    frame_hash: z.string().optional(),
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
    /**
     * The rubric version this run is scored under (D34). Optional, and absent means 0: every run
     * recorded before the rubric had a second version ran under version 0, and a missing field
     * says so as clearly as an explicit 0 would.
     */
    rubric_version: z.number().int().nonnegative().optional(),
    /**
     * Which library produced this plan, or null for the shipped one (D33). Optional so every run
     * recorded before overlays existed still validates — those ran on the shipped library and a
     * missing field says so as clearly as an explicit null would.
     */
    overlay: z
      .object({
        path: z.string(),
        hash: z.string(),
        replaced_frames: z.array(z.string()),
        added_frames: z.array(z.string()),
      })
      .strict()
      .nullable()
      .optional(),
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
        // A fixture that asserts the compiler and nothing about a run, which fixture 008 established
        // the precedent for: some properties are about dispatch rather than about reasoning, and
        // waiting for a recorded run to check them means never checking them. `brief_bytes_max` is the
        // one number worth pinning — a brief that grows without bound is how a long problem stops
        // being dispatchable at all.
        compiles: z.boolean().optional(),
        brief_bytes_max: z.number().int().positive().optional(),
        /**
         * How many branches the plan must carry. Routing decides `n` from the class, and a
         * `compiles: true` fixture could not check it — so the wide path, whose whole subject is
         * that `n` is 7 and not 5, had no way to assert the one thing it is for. A compile that
         * quietly fell back to five branches would have passed.
         */
        branches_expected: z.number().int().min(1).optional(),
        /** Every dispatched frame sits on its own axis (D6). Free to check and never checked. */
        distinct_axes: z.boolean().optional(),
      })
      .strict()
      .default({ decline: false, reason_includes: [] }),
  })
  .strict()
  // A run fixture with no must_surface asserts nothing and would pass on any output at all.
  .refine((f) => f.expect.decline || f.expect.injection_warnings_min !== undefined || f.expect.compiles || f.must_surface.length > 0, {
    message: "must_surface is required unless expect.decline, expect.injection_warnings_min or expect.compiles is set",
    path: ["must_surface"],
  })
  .refine((f) => !f.expect.decline || (f.must_surface.length === 0 && f.must_not.length === 0), {
    message: "a declined fixture has no output to assert against; drop must_surface and must_not",
    path: ["expect", "decline"],
  });
export type Fixture = z.infer<typeof FixtureSchema>;

/**
 * What the host actually spawned, as opposed to what the plan asked for.
 *
 * `plan.json` records the agent a run *intends* for each task. Nothing recorded what it *got*, and
 * that gap hid the defect D41 found for fifteen runs: `adhd-branch`, `adhd-critic` and
 * `adhd-deepen` could not launch at all, every dispatch silently fell back to another agent type,
 * and because a subagent type selects a system prompt, the critic ran the branch instructions.
 * Twelve recorded runs and two decisions were written on top of that, and every one of their
 * `plan.json` files still claims `"agent": "adhd-branch"`.
 *
 * A substitution is not forbidden — D41's own fallback reasoning is sound and a host that cannot
 * launch one agent may legitimately use another. What is forbidden is doing it silently. An entry
 * whose `actual` differs from its `planned` must say why, and the synthesis ships that to the
 * reader the same way the pruned block does.
 */
export const DispatchEntrySchema = z
  .object({
    /** `branch:<FRAME>`, `critique:pass-a`, `critique:pass-b`, or `deepen:<FRAME>`. */
    task: z.string().min(1),
    planned: z.string().min(1),
    actual: z.string().min(1),
    /** Required when `actual` differs from `planned`. The refusal text, ideally verbatim. */
    note: z.string().min(1).optional(),
  })
  .strict();

export const DispatchRecordSchema = z
  .object({ entries: z.array(DispatchEntrySchema) })
  .strict()
  .superRefine((v, ctx) => {
    for (const e of v.entries)
      if (e.actual !== e.planned && !e.note)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${e.task}: planned ${e.planned} and spawned ${e.actual} with no note. A substitution is allowed; an unexplained one is not`,
        });
  });
export type DispatchRecord = z.infer<typeof DispatchRecordSchema>;
export type DispatchEntry = z.infer<typeof DispatchEntrySchema>;

export const RecordedExpectationSchema = z
  .object({
    outcome: z.enum(["pass", "fail"]),
    note: z.string().optional(),
    /** A hand written consensus answer that exists to fail. Audited separately from real runs. */
    control: z.boolean().default(false),
    /*
     * The id of the run this one deliberately repeats: same fixture, same seed, briefs identical,
     * recorded to measure what moves when nothing does (backlog 4). Two treatments follow from it
     * and they are not the same treatment, which is why this field exists rather than a filter.
     *
     * For a *rate* — pruned in n of m, held the recommendation in n of m — a replicate is not an
     * independent observation. `001-seed3-repeat` is fixture 001 at seed 3 declining to pick
     * `LEDGER` for the second time, and counting it twice is how `LEDGER` became the first frame
     * ever to meet a retirement criterion (backlog 99). Rates collapse a replicate group to one
     * draw.
     *
     * For *reliability* — inter-rater agreement, alpha, the noise floor — more samples of the same
     * pack is exactly what is wanted and nothing collapses.
     */
    replicate_of: z.string().optional(),
  })
  .strict();
