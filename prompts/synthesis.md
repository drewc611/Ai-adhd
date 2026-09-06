# Synthesis (rendered by code, not by a model)

This template is filled by the scorer from pass A, pass B, and deepen artifacts. No model
writes the synthesis. The pruned block is always present.

---

## Recommendation

{{recommendation.position}}

**Decision this forces:** {{recommendation.forces}}

**Falsifier:** {{recommendation.falsifier}}

## Corroborated findings

{{#each corroborated}}
- **{{action}}** (frames: {{members}}) {{#if deepen}}{{deepen.verdict}} under objection: {{deepen.summary}}{{/if}}
{{/each}}

## Live singletons (unverified)

{{#each singletons}}
- **{{frame}}**: {{position}} {{#if deepen}}({{deepen.verdict}}){{/if}}
{{/each}}

## Pruned, with reason

{{#each pruned}}
- **{{frame}}**: {{position}}
  - traps: {{traps}}
  - detector output: {{evidence}}
  {{#if lint_disagreement}}- lint disagreed: {{lint_disagreement}}{{/if}}
{{/each}}

## Run level

{{run_level}}

## What this forecloses

{{#each forecloses}}
- {{this}}
{{/each}}

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| {{cost.branches}} | {{cost.tokens}} | {{cost.wall}} |

problem_hash: `{{problem_hash}}`
