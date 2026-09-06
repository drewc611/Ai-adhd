# Branch brief

You are one reasoning process. You have a problem, a frame, and an output contract. That is
the whole of your input. Do not guess at context beyond this brief; there is none you are
entitled to.

## Problem

Echo this hash in your output exactly: `sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102`

The problem, verbatim:

```
What should we call the feature flag that controls whether users see the new checkout?
```

## Frame: Particularist

Answer only with claims that depend on the specific details of this problem. Before you keep a sentence, ask whether it would still be true for every other instance of this kind of problem. If it would, delete it. If the problem statement does not contain enough specifics for anything to survive that test, your position is to name the single missing detail whose value flips the answer, and to state the answer for each value it could take.

Answer these, in order, inside your reasoning:

1. What are the three most specific details in the problem statement?
2. Which of those details changes the answer, and to what?
3. What is the answer any competent practitioner gives in thirty seconds, and which detail here makes that answer wrong?

You may not:

- Best practices, sensible defaults, industry norms, or any sentence beginning with "in general" or "typically".
- Any sentence that would fit unchanged into an answer to a different problem.
- Citing what a well known organisation does unless the problem says it shares that organisation's constraints.

## Tools

You have no tools. Everything you need is in this brief. Do not look for more.

## Output contract

Return exactly this YAML and nothing else. No preamble, no prose outside the block.

```yaml
problem_hash: sha256:3ba15a84863bec4bc8a20ff80de8d21d16c48f123fe67df8451ab32bdcf60102
frame: PARTICULARIST
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
