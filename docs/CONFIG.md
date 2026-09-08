# Config reference

**Generated from the zod schemas in `src/schema.ts` by `adhd schema-doc`. Do not edit by hand:
a test fails when this file and the schemas disagree.**

Every field below is validated before any command runs, and `crossCheck` in `src/config.ts`
adds the rules a per-field schema cannot express — an unknown frame in a routing class, two
primary frames sharing an axis, `n` over `hard_cap`, a `former_id` two frames both claim.
Those raise `ConfigError` and exit 4.

This table says what a field *is*. It cannot say why it exists: that reasoning is in the JSDoc
beside each field in `src/schema.ts`, in the comments at the top of each `config/` file, and in
`docs/DECISIONS.md`. A generated reference is honest about its shape and silent about its intent.

## config/frames.yaml

### File

Read from `config/frames.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `version` | number | yes | — | — |
| `frames` | object[] | yes | — | min length 1 |

### A frame

`stance`, `probes` and `forbidden` are the product. `former_ids` forwards a rename so recorded runs keep resolving (D6); it is bookkeeping and is deliberately excluded from the `frame_hash` that detects a *redefinition*, so renaming a frame never reads as redefining it.

Read from `config/frames.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `id` | string | yes | — | matches `/^[A-Z][A-Z_]*$/` |
| `name` | string | yes | — | min length 1 |
| `axis` | string | yes | — | matches `/^[a-z][a-z_]*$/` |
| `attacks` | (`T1` \| `T2` \| `T3` \| `T4` \| `T5` \| `T6` \| `T7` \| `T8`)[] | yes | — | min length 1 |
| `tools` | (`WebSearch` \| `WebFetch`)[] | no | [] | — |
| `former_ids` | string[] | no | [] | — |
| `stance` | string | yes | — | min length 40 |
| `probes` | string[] | yes | — | min length 1 |
| `forbidden` | string[] | yes | — | min length 1 |

## config/routing.yaml

### File

Read from `config/routing.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `version` | number | yes | — | — |
| `defaults` | object | yes | — | — |
| `decision_schema` | map | yes | — | — |
| `classes` | map | yes | — | — |

### Defaults

Read from `config/routing.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `max_branches` | number | yes | — | > 1 |
| `hard_cap` | number | yes | — | > 1 |
| `min_branches` | number | yes | — | > 1 |
| `require_confirmation` | boolean | yes | — | — |
| `shuffle_frames` | boolean | yes | — | — |
| `seed` | one of several shapes | yes | — | — |
| `tokens_per_branch_estimate` | number | yes | — | > 0 |
| `branch_tools_allowed` | (`WebSearch` \| `WebFetch`)[] | yes | — | — |

### A class that runs

`frames` is the preferred set and `alternates` fills the shortfall. A class that cannot reach its own `n` from both lists together is an error `adhd doctor` reports, because the plan would claim `n` and dispatch fewer.

Read from `config/routing.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `action` | `"run"` | yes | — | — |
| `description` | string | yes | — | min length 1 |
| `signals` | string[] | no | [] | — |
| `frames` | string[] | yes | — | min length 1 |
| `alternates` | string[] | no | [] | — |
| `n` | number | no | — | > 1 |

### A class that declines

A decline is a first-class outcome. `reason` is non-empty because a decline the user cannot learn anything from has rotted even while still declining.

Read from `config/routing.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `action` | `"decline"` | yes | — | — |
| `reason` | string | yes | — | min length 1 |
| `signals` | string[] | no | [] | — |

## config/critic-rubric.yaml

### File

Read from `config/critic-rubric.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `version` | number | yes | — | — |
| `scale` | object | yes | — | — |
| `dimensions` | object[] | yes | — | min length 1 |
| `not_scored` | string[] | yes | — | — |
| `pass_b` | map | yes | — | — |
| `hard_rules` | object | yes | — | — |
| `aggregation` | object | yes | — | — |

### A dimension

`pass_a` is a weighted total across every dimension, so all of them must use the same anchor range: one on a wider scale counts for more than its weight states. `adhd doctor` checks that, along with anchors being contiguous from zero.

Read from `config/critic-rubric.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `id` | string | yes | — | matches `/^[a-z][a-z_]*$/` |
| `weight` | number | yes | — | > 0 |
| `question` | string | yes | — | min length 1 |
| `anchors` | map | yes | — | — |

### Hard rules

Read from `config/critic-rubric.yaml`.

| field | type | required | default | constraints |
|---|---|---|---|---|
| `prune_on_any_fired_trap` | boolean | yes | — | — |
| `contract_violation_prunes` | boolean | yes | — | — |
| `hash_mismatch_aborts_run` | boolean | yes | — | — |
| `missing_detector_record_rejects_pass_b` | boolean | yes | — | — |
| `singleton` | `"escalate_flagged"` | yes | — | — |
| `cluster_min_size` | number | yes | — | > 2 |
| `monoculture_fraction` | number | yes | — | > 0, < 1 |
| `scatter` | object | yes | — | — |
| `run_level_t2_if_no_branch_attacks_assumption` | boolean | yes | — | — |
| `lint_disagreement_is_reported_not_resolved` | boolean | yes | — | — |
| `min_evidence_words_on_fire` | number | no | 0 | > 0 |

---

Regenerate with `adhd schema-doc > docs/CONFIG.md`.
