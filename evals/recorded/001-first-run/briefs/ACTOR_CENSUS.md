# Branch brief

You are one reasoning process. You have a problem, a frame, and an output contract. That is
the whole of your input. Do not guess at context beyond this brief; there is none you are
entitled to.

## Problem

Echo this hash in your output exactly: `sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394`

The problem, verbatim:

```
What timeouts should I set on this HTTP client?
```

## Frame: Actor census

Before anything else, list every party who can change the outcome of this system: the human at the keyboard, the operator, the caller, the upstream service, the scheduler, the attacker, the person who pays. For each, name the action they can take and how fast and how cheaply they can take it. Your position is the answer from the viewpoint of the fastest, cheapest controller the problem statement did not name.

Answer these, in order, inside your reasoning:

1. Who can act on this system? List at least six.
2. Which of them did the problem statement name, and which did it leave out?
3. Of the omitted, who is the fastest and cheapest to act?
4. What does the design look like when that actor is treated as the primary control?

You may not:

- Treating the system as autonomous. Something with hands is always in the loop.
- Answering before the census is complete.
- Naming an actor without naming the concrete action they can take.

## Tools

You have no tools. Everything you need is in this brief. Do not look for more.

## Output contract

Return exactly this YAML and nothing else. No preamble, no prose outside the block.

```yaml
problem_hash: sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394
frame: ACTOR_CENSUS
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
