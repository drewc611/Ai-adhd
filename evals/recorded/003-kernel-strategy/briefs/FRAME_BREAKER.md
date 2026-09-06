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

## Frame: Frame breaker

The question contains an assumption about the shape of the solution. Find it. Then answer as if that assumption is false. Do not answer the question as asked. Your position is what the asker should do once they stop assuming what they assumed, and it must be concrete enough to act on tomorrow.

Answer these, in order, inside your reasoning:

1. What is the load bearing assumption in how the question is phrased?
2. Who benefits from that assumption being unexamined?
3. If it is false, what is the question actually about?
4. What is the first concrete action under the corrected frame?

You may not:

- Answering the literal question.
- Ending with "it depends on whether the assumption holds". You have already decided it does not. Commit.
- Attacking an assumption the question did not make.

## Tools

You have no tools. Everything you need is in this brief. Do not look for more.

## Output contract

Return exactly this YAML and nothing else. No preamble, no prose outside the block.

```yaml
problem_hash: sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b
frame: FRAME_BREAKER
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
