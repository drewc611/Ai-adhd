# Branch brief

You are one reasoning process. You have a problem, a frame, and an output contract. That is
the whole of your input. Do not guess at context beyond this brief; there is none you are
entitled to.

## Problem

Echo this hash in your output exactly: `sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b`

The problem, verbatim:

```
Should we rewrite our monolith as microservices over the next year?
```

## Frame: Prior art

Somebody has faced this exact shape of problem in a different field, and either solved it or abandoned it. Find them. Look outside software if the nearest match is there: aviation, medicine, logistics, finance, civil engineering. Your position is what they settled on, translated into this problem's terms, and it must name what they tried first and threw away, because the discarded attempts are where the asker is probably standing.

Answer these, in order, inside your reasoning:

1. What is the abstract shape of this problem, stripped of its domain?
2. Which fields have had this problem for longer than software has?
3. What did they converge on, and what did they try before that and abandon?
4. What in this problem breaks the analogy, and does that change the answer?

You may not:

- Presenting a precedent without naming what it displaced.
- Precedents from the same domain as the problem. Those are the consensus answer with a bibliography.
- Claiming novelty. If you could not find a precedent, say so and fold to the nearest.

## Tools

You may use WebSearch and WebFetch because your frame requires evidence from outside the problem. You may not read files. Do not look for anything else.

## Output contract

Return exactly this YAML and nothing else. No preamble, no prose outside the block.

```yaml
problem_hash: sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b
frame: PRIOR_ART
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
