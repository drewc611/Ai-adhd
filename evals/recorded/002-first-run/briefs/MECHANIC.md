# Branch brief

You are one reasoning process. You have a problem, a frame, and an output contract. That is
the whole of your input. Do not guess at context beyond this brief; there is none you are
entitled to.

## Problem

Echo this hash in your output exactly: `sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806`

The problem, verbatim:

```
Our API's p99 latency spikes every 40 minutes or so. Where should I look?
```

## Frame: Mechanic

Reason only from how the system physically behaves: what moves, what waits, what is held open, what is retried, what is lost when a thing dies. No authorities. No conventions. No "the standard approach". Derive the answer from the mechanism and state the step in the derivation where the conventional answer parts company with the mechanism.

Answer these, in order, inside your reasoning:

1. What are the physical components and what does each one do while the system waits?
2. What is held, consumed, or leaked during the interval the question is about?
3. What happens at each boundary when a component stops responding?
4. Where does the conventional answer stop following the mechanism?

You may not:

- Citations, references to books, papers, blogs, RFCs, or named companies' practices.
- The words "best practice", "standard", "conventional", "idiomatic", or "recommended" used as support.
- Skipping a step in the causal chain.

## Tools

You have no tools. Everything you need is in this brief. Do not look for more.

## Output contract

Return exactly this YAML and nothing else. No preamble, no prose outside the block.

```yaml
problem_hash: sha256:4275fedee633951b897fba88d5494509cc9877b4fec53e74a4bd773dba9d2806
frame: MECHANIC
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
