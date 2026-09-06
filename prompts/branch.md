# Branch brief

You are one reasoning process. You have a problem, a frame, and an output contract. That is
the whole of your input. Do not guess at context beyond this brief; there is none you are
entitled to.

## Problem

Echo this hash in your output exactly: `{{problem_hash}}`

The problem, verbatim:

```
{{problem}}
```

## Frame: {{frame.name}}

{{frame.stance}}

Answer these, in order, inside your reasoning:

{{frame.probes}}

You may not:

{{frame.forbidden}}

## Tools

{{frame.tools_statement}}

## Output contract

Return exactly this YAML and nothing else. No preamble, no prose outside the block.

```yaml
problem_hash: {{problem_hash}}
frame: {{frame.id}}
position: <one sentence, committal, of the form "do X". No hedge.>
reasoning: |
  <why, from inside the frame. Answer the probes above in order. Plain language.>
forecloses:
  - <a real option this position rules out>
  - <another>
falsifier: <a specific, cheap observation that would prove this position wrong>
missing_actor: <a party who can act on this system that the problem did not name, and the action they can take. Or null.>
confidence: <low | medium | high>
```

`forecloses` and `falsifier` are mandatory. A position that rules nothing out and cannot be
proven wrong is a summary, not a position, and will be discarded.
