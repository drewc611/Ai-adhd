# UNSCORED, divergence only

This run was cancelled before the critic pass. What follows is every branch that returned,
with code lints only. No blind scoring, no clustering, no trap sweep by a critic, no
recommendation. Treat every position below as one unverified angle, not a finding.

problem_hash: `{{problem_hash}}`
branches returned: {{returned}} of {{planned}}

{{#each branches}}
## {{frame}}

**Position:** {{position}}

**Forecloses:**
{{#each forecloses}}
- {{this}}
{{/each}}

**Falsifier:** {{falsifier}}

**Missing actor:** {{missing_actor}}

**Confidence:** {{confidence}}

{{#if lints}}**Lint hints (unconfirmed):**
{{#each lints}}
- {{trap}}: {{evidence}}
{{/each}}
{{/if}}
{{#if violations}}**Contract violations:**
{{#each violations}}
- {{this}}
{{/each}}
{{/if}}
<details><summary>reasoning</summary>

{{reasoning}}

</details>

{{/each}}
## Not returned

{{#each missing}}
- {{this}}
{{/each}}

## Cost

| branches spawned | branches returned | tokens (est) |
|---|---|---|
| {{planned}} | {{returned}} | {{tokens}} |
