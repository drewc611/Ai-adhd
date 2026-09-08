# The SuperAgent

Work that takes minutes to hours: research it, decide it, build it, check it, write it up. Six
stage kinds, a sandbox, memory that survives the mission, and a message gateway.

It never calls a model. The library compiles a brief for each stage and checks what comes back
against a contract; the host supplies the reasoning by spawning the agent the stage names. That is
the same arrangement `src/os.ts` already uses for the four run phases, one level up.

```
adhd super plan --id <mission> --goal goal.txt --class quick|standard|deep
adhd super confirm <mission>
adhd super claim <mission> --worker <you>          # prints the agent, its tools, and the brief
adhd super return <mission> <stage> --worker <you> --goal-hash <hash> --tokens <n>
adhd super status <mission>
```

## What "minutes to hours" actually means

Three classes, and the difference is the stage graph rather than a timeout.

| class | stages | lease | budget | what it is for |
|---|---|---|---|---|
| `quick` | research → create | 10 min | 60k | a question somebody already has the answer to |
| `standard` | research → **decide** → build → verify → create | 30 min | 400k | a change with a decision in front of it |
| `deep` | research → **decide** → research → build → verify → create → review | 90 min | 2M | a decision whose hard part is only visible after the first attempt at it |

`deep` puts a second research stage *after* the divergence on purpose. The most common way an
hour-long piece of work goes wrong is committing to a direction chosen before the hard part was
understood, and the second pass is where the branches' disagreement gets checked against the world
rather than against each other.

**`decide` is where this stops being a generic harness.** It does not spawn an agent. It submits an
ordinary run to the kernel — N isolated frames, a blind critic, the eight trap detectors — and
adopts the synthesis. A mission is worth more than a long prompt precisely because its hard
decision is made by that machine instead of by one agent being thorough.

## Memory, and the rule that shapes it

Findings persist across missions in append-only JSONL, content-addressed, every entry carrying
where it came from.

The hard part is not storage. **Memory is exactly the mechanism by which a sibling's output would
reach a branch.** "Branches never see siblings" is a property of separate context windows, and a
store that hands a branch what another branch wrote five minutes ago has rebuilt the channel
isolation existed to remove — through a component with a database's air of neutrality about it.

So `forBrief` refuses, mechanically: **nothing a `diverge` participant wrote reaches a `diverge`
brief.** Not filtered on read, not discouraged in a prompt. Global scope does not exempt it, and
neither does coming from a different run — a branch of last week's run is still a branch, and its
conclusion on a related question is the anchor this repository exists to defeat.

A diverge brief is told how many entries were withheld and never which. A list of titles is a list
of what siblings thought worth writing down.

```
adhd super memory --audit          # what the rule withholds, and why, for each entry
```

## The gateway

Stages that run for an hour need to be able to say things, and an operator needs to redirect a
mission without killing it.

```
adhd super gateway <mission> --to <stage> --send 'the constraint changed: ...'
adhd super gateway <mission>       # the thread, and every delivery the rule refused
```

Same rule, second mechanism: **no message is delivered between two `diverge` participants**, in
either direction. Direction does not matter, because a branch asking a sibling a question leaks
the question, and a question is a claim about what the asker thinks matters.

Refused at send, not hidden on read. A message accepted and then quietly dropped is a message the
sender believes arrived. Refusals are journalled, so a gateway that has never refused anything is
one whose rule is not being exercised.

The mailbox is on disk. An in-memory bus loses exactly the messages sent during the crash that
caused the restart.

## The sandbox

`build` and `verify` stages get their own tree.

```
adhd super sandbox <mission> --create .
adhd super sandbox <mission> --diff
adhd super sandbox <mission> --promote --dry-run
adhd super sandbox <mission> --promote
```

**It is not a security boundary and it does not pretend to be.** A stage with Bash can walk out of
any directory this creates. What it does is make an honest stage's work reviewable and revertible:
changes in one place, a diff that shows them, and one deliberate step back into the working tree.
The failure it prevents is not malice, it is a build stage that got most of the way there and left
the repository in a state nobody can reconstruct.

`promote` checks every path against the mission's writable list first, so a promote that would
touch something the stage was not allowed to write fails having moved nothing. All-or-nothing,
because a partial promote leaves a tree matching neither the sandbox nor the source.

The command allowlist matches the **whole command string**, not a prefix. Prefix matching on
`npm test` lets `npm test && curl somewhere` through, and a verify stage runs what it is told.

Copy rather than a git worktree: a worktree needs the source to be a clean repository at a commit,
which is exactly what a mission running on a dirty tree does not have.

## The agents, and what the tool grants cost to get right

| stage kind | agent | tools |
|---|---|---|
| `research` | `adhd-researcher` | WebSearch, WebFetch, Read, Glob, Grep |
| `diverge` | *(none — submits a run)* | — |
| `build` | `adhd-builder` | Read, Write, Edit, Glob, Grep, Bash |
| `verify` | `adhd-verifier` | Read, Glob, Grep, Bash |
| `create` | `adhd-maker` | Read, Write, Glob, Grep |
| `review` | `adhd-reviewer` | Read, Glob, Grep |

`adhd doctor` checks that table against the agents' own front matter in both directions, and it
found two real holes the first time it ran.

`review` originally reused `adhd-critic` and `diverge` named `adhd-branch`. Both are run agents
whose grant is fixed by D4 at `TaskList` and nothing else, so the stage grants either had to be
empty or had to widen an agent whose emptiness is the point.

`build` and `verify` were one agent. A tool grant is per agent, so one agent serving both kinds
carries the union — and the union means a verify stage can write. **A stage that checks its own
work and can edit it is not a check.**

`build` has no network. A build stage that can fetch is a build stage that can add a dependency
nobody reviewed, and the sandbox is the wrong place to catch that because by then it is in the
tree. If the work needs something from outside, the artifact says so and a research stage gets it.

## The contract gate

Every stage names its artifact, the headings it must contain, a word floor, and optionally a
command that must exit zero — all written before the stage runs. `verifyStage` runs that, and
nothing else. Nobody decides whether the artifact is good: "good" is what the review stage and the
critic are for, and a gate that asks for it is a gate that passes whatever it is given.

A rejected stage goes back to `pending` with the reasons attached and the attempt counted. After
the class's `maxAttempts` it is `dead` and the mission blocks, which is a fact to report rather
than something to work around.

`goal_hash` is checked on every return. A worker returning against a paraphrased goal is the
mission-level version of the drift `problem_hash` catches, and it aborts the same way.

## Nothing starts before somebody says so

`plan` prints the stage graph, the leases, the budget and the sandbox policy, and stops. D5 said a
system that spawns seven subagents and gives the user no way out fails its own fixture 001. A deep
mission is seven stages and one of them is itself a seven-branch run, so the same objection applies
with an order of magnitude on it.
