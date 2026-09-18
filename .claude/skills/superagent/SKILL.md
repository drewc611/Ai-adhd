---
name: superagent
description: Drive a SuperAgent mission - work that takes minutes to hours across research, divergent decision, build, verify, create and review stages, with a sandbox, memory, and a message gateway. Use when a task is too large for one pass and needs to survive being interrupted. Do not use for a single question, a single edit, or anything you can finish in one reply; use /adhd for a decision that needs divergence but no building.
---

# Driving a mission

A mission is work with stages, a budget, a sandbox and a memory. It is designed to outlive the
process that started it: the record is on disk, leases expire, and a mission resumed tomorrow
picks up where it stopped.

You are the host. You do not reason about the goal — you claim stages, spawn the agent each one
names, and return what comes back. The library checks it.

## The loop

```
adhd super plan --id <mission> --goal goal.txt --class quick|standard|deep \
  [--writable src,test] [--allow 'npm test'] [--budget N]
```

Print the preview to the user and **stop**. D5 applies here with an order of magnitude on it: a
deep mission is seven stages and one of them submits a seven-branch run. Nothing is claimable
until they say go.

```
adhd super confirm <mission>
adhd super claim <mission> --worker <you>
```

`claim` prints the stage, the agent to spawn, its exact tool grant, the sandbox path if it has
one, and the brief. Spawn that agent with that grant and pass the brief as its entire input.
Nothing else. Do not add context, do not summarise what other stages found, do not tell it what
you think. The brief is complete by construction and anything you add is unscored.

When the agent returns, it has written the contract's file into the mission directory. Then:

```
adhd super return <mission> <stage> --worker <you> --goal-hash <hash from claim> --tokens <n>
```

The library checks the artifact against the contract that existed before the stage ran. A rejected
stage goes back to pending with the reason on it and the attempt counted; hand it out again. After
`maxAttempts` it is `dead` and the mission blocks, which is a fact to report rather than a thing
to work around.

Loop until `claim` returns `{"claimed": null}` and `status` says `done`.

## The diverge stage

The `decide` stage in `standard` and `deep` is not an agent. It submits an ordinary run: use the
`/adhd` skill for it, then write the synthesis into the mission directory as `synthesis.md` and
return the stage. That stage is why a mission is worth more than a long prompt — the hard decision
gets made by isolated frames and a blind critic instead of by one agent being thorough.

## The sandbox

`build` and `verify` stages get one. Create it before the build stage:

```
adhd super sandbox <mission> --create .
adhd super sandbox <mission> --diff
adhd super sandbox <mission> --promote --dry-run
```

Nothing reaches the working tree until `--promote` without `--dry-run`, and promote refuses any
path outside the mission's writable list, moving nothing when it refuses. Show the user the diff
before you promote. Never promote a sandbox whose verify stage failed.

## Memory and the gateway, and the one rule

Memory persists across missions. The gateway carries messages between stages, the orchestrator and
the operator.

Both are refused between `diverge` participants. A branch reading what a sibling wrote is not
isolated whatever the delivery mechanism, and these two are the mechanisms. `adhd super memory
--audit` shows what the rule withholds; `adhd super gateway <mission>` shows every delivery it
refused. If you find yourself wanting to pass a branch what another branch said, that is the
architecture working.

## Redirecting a long mission

The operator can steer without killing it:

```
adhd super gateway <mission> --to <stage> --send 'the constraint changed: ...'
```

That lands in the next brief that stage receives. Use it rather than cancelling and replanning.

## Do not

Do not run a stage yourself because it looks small. Do not edit a mission's artifacts to make a
contract pass — the contract failing is information. Do not promote a sandbox the user has not
seen. Do not raise a budget or a lease on your own; report that it bound and let them decide.
