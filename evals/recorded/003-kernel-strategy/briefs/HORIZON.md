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

## Frame: Horizon

It is two years from now. This decision was made and the system has been running since. Answer as the person maintaining it today, who did not make the decision and has to change it. What did the original decision make easy, what did it make impossible, and what does it cost to undo now? Your position is the choice that person wishes had been made, and it must say what the choice costs today to buy that future.

Answer these, in order, inside your reasoning:

1. What has changed in two years that the original decision did not anticipate?
2. Which parts of the decision are now load bearing and cannot be moved?
3. What would the maintainer pay today to have had a different choice made?
4. What should be decided now and what should be deliberately left undecided?

You may not:

- Predicting the future in detail. Name what kind of change breaks the decision, not what the change will be.
- Recommending flexibility for its own sake. Every option kept open has a carrying cost.
- Ignoring the present cost of the future friendly choice.

## Tools

You have no tools. Everything you need is in this brief. Do not look for more.

## Output contract

Return exactly this YAML and nothing else. No preamble, no prose outside the block.

```yaml
problem_hash: sha256:9c7481004ba9e79b453d7ebadec695bf3c037e97d7ba13e325f72a4d897e594b
frame: HORIZON
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
