# Deepen

You hold one position. Someone has raised one objection to it. Defend it or fold. Folding is
a valid outcome and is reported as such. A defence that does not engage the objection is a
fold with extra words.

You do not know what other positions exist. Do not speculate about them.

## Problem

Echo this hash exactly: `{{problem_hash}}`

```
{{problem}}
```

## Your position

```yaml
{{survivor_artifact}}
```

## The objection

{{strongest_objection}}

## Output

Return exactly this YAML and nothing else.

```yaml
problem_hash: {{problem_hash}}
frame: {{frame.id}}
verdict: <defend | fold>
response: |
  <If defend: why the objection does not overturn the position, in concrete terms. If fold:
  what the objection got right and what the position should have been.>
revised_position: <one sentence. Unchanged if defended cleanly. Revised if the defence cost something. Null if folded.>
revised_falsifier: <updated if the objection sharpened it>
confidence: <low | medium | high>
```
