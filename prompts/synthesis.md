# ADHD synthesis

Rendered by code from the run artifacts. No model wrote this page. The pruned block is always
present.

## Recommendation

{{#if recommendation}}
**{{recommendation.position}}**

**Decision this forces:** {{recommendation.action}}
{{#if recommendation.revised}}
**Revised under objection.** The decision line above is the cluster as the critic grouped it before deepening. The bold position is what survived the strongest objection. Original position: {{recommendation.original_position}}
{{/if}}
**Falsifier:** {{recommendation.falsifier}}

Held by: {{recommendation.members}}. {{#if recommendation.deepen}}Under the strongest objection it **{{recommendation.deepen.verdict}}**: {{recommendation.deepen.summary}}{{/if}}
{{/if}}
{{#if no_recommendation}}
No recommendation. {{no_recommendation}}
{{/if}}

## Corroborated findings

{{#each corroborated}}- **{{action}}** (frames: {{members}}){{#if deepen}}. Deepen: {{deepen.verdict}}. {{deepen.summary}}{{/if}}
{{/each}}
{{#if no_corroborated}}(none: no two frames landed on the same action){{/if}}

## Live singletons (unverified)

{{#each singletons}}- **{{frame}}**: {{position}}{{#if deepen}} ({{deepen.verdict}}: {{deepen.summary}}){{/if}}
{{/each}}
{{#if no_singletons}}(none){{/if}}

## Pruned, with reason

{{#each pruned}}- **{{frame}}**: {{position}}
  - traps: {{traps}}
  - detector output: {{evidence}}
{{#if violations}}  - contract: {{violations}}
{{/if}}{{#if lint_disagreement}}  - lint disagreed: {{lint_disagreement}}
{{/if}}{{/each}}
{{#if no_pruned}}(none pruned){{/if}}

## Run level

{{#each run_level}}- {{this}}
{{/each}}

## What this forecloses

{{#each forecloses}}- {{this}}
{{/each}}
{{#if no_forecloses}}(nothing recorded){{/if}}

## Cost

| branches | tokens (est) | wall clock |
|---|---|---|
| {{cost.branches}} | {{cost.tokens}} | {{cost.wall}} |

problem_hash: `{{problem_hash}}`
seed: {{seed}}
