# Recorded run: 003, kernel-strategy

Run `003-kernel-strategy`, class `strategy`, seed 3, n 5, final state `done`. Driven by the kernel (docs/OS.md); recorded by `adhd os record`.

## Provenance, from the journal

- Workers: claude-main.
- Lease expiries: 0.
- Tokens: 460541 over 707s from confirm.
- Eval outcome as recorded: PASS.

## How it was produced

The first run in the `strategy` class and the first on fixture 003, written before the run.
Nine tasks claimed and returned by one worker session: five branches as fresh isolated
subagents with the compiled brief as their entire prompt, pass A as a fresh critic, pass B
sent to that same critic (the kernel's continuation preference, taken), two deepen tasks as
fresh subagents. PRIOR_ART carried WebSearch and WebFetch per its frame and used them four
times. The subagents were general-purpose Claude Code subagents, not the plugin's agent
definitions, so the no-tool branches were told they had no tools rather than being unable to
have any.

## What the run surfaced

- All five frames refused the year-long rewrite. That is not a monoculture by the critic's
  clustering (three clusters, distinguished by the first move), but it is worth saying plainly:
  no frame in the strategy set argued for the rewrite, and the fixture did not ask for one.
- The reframe (`reframe`, T2) is in the recommendation: the bold line says to name the pain and
  its metric before choosing an instrument, and that the instrument differs for coupling,
  deploy cadence, and a shared data store. FRAME_BREAKER made the same move most directly and
  was pruned for it (T1: its reasoning serves any rewrite question). The reframe reached the
  output through DOOR_KEEPER's revision, not through the frame built to produce it.
- One way doors (`one_way_door`, T7) are in the recommendation: "take each one way door only
  after its preceding probe shows the named metric moved on real traffic." DOOR_KEEPER's
  reasoning is an inventory of which moves cannot be undone (database split, team reorg,
  public commitment, the fork itself) with a cost of being wrong and a detection latency for
  each. HORIZON added the asymmetry the inventory missed: merging two services is harder than
  splitting a monolith, because a service boundary becomes contracts, schema history, and an
  on-call rotation.
- Who pays (`who_pays`, T6): every branch named the on-call rotation. LEDGER priced it ("paid
  at 3am by individuals, not in a budget line") and named finance as the actor who can force
  the run-cost onto the asker's side of the ledger.
- Under objection, DOOR_KEEPER constructed its own strongest objection (see the bug below):
  the experiment is rigged to say "stay", because the first extracted service carries the whole
  platform fixed cost and can never pay its own way. It conceded that and revised: book platform
  setup as a fixed investment, judge the seam on marginal numbers, and write the pass criterion
  down before the shadow run starts.
- HORIZON, a singleton, defended by conceding three of the objection's four points: divergence
  in deploy cadence is a symptom, not a seam; nothing sequenced the two extractions; "at most
  two" read as a forecast when it was a budget. It kept the point that a wall in CI leaves a
  commit when it is removed, and a document does not.

## What the run did not surface, or surfaced weakly

- `detection_latency` matched only in HORIZON's falsifier, and only on the words "ceiling is
  wrong". The run's real treatment of detection latency is in DOOR_KEEPER's reasoning, which
  gives a latency per one way door in months. The fixture's first pattern list did not include
  the phrase "detection latency"; it does now, with a comment saying when it was added. The
  recommendation itself gates each door on "the named metric moved" but never says how long
  the asker should expect to wait before the metric can move, which is the item's point.
- PRIOR_ART was pruned for T1 and T2. Its precedents (Bell System cutovers, the FAA's Advanced
  Automation System, postwar urban renewal) were judged to carry the argument rather than
  decorate it, and the critic recorded that the settled position would be the same for any
  replacement question. Reasonable, and it means the class's designated search frame
  contributed nothing that reached the recommendation. One run; not a verdict on the frame.
- No branch asked what the asker would do with the year if not this. LEDGER priced the
  opportunity cost but nobody named the alternative bet. Fixture 003 does not ask for that.

## Bugs this run found in the plumbing

Fixed in the same commit series as this recording; each has a test.

1. The pass B prompt said the strongest objection is null "if a member has a fired trap". The
   critic read it literally: PRIOR_ART fired inside a three-member cluster, so DOOR_KEEPER
   went to deepen with no objection and constructed its own. The prompt now says null only
   when every member is pruned.
2. The synthesis listed PRIOR_ART as holding the recommendation. A pruned member corroborated
   the action; it does not hold the position. The "Held by" line now lists survivors and names
   pruned corroborators separately.
3. The kernel wrote returned messages to the artifact files verbatim, fences included. Every
   phase reader stripped the fence, but `adhd frames --orthogonality` did not and crashed on
   this run's `critic/pass-b.yaml`. There is now one `unfence` used by every reader, the kernel
   stores bare YAML, and a message with text outside the fence (PRIOR_ART's sources line) is
   kept whole as `<artifact>.raw.md`. The artifacts here were normalised by that rule.
4. The eval treated an empty regex match as no match and compiled every fixture pattern with
   the `m` flag, so a fixture could not anchor to the first line of a scope. Fixed; fixture
   003's `no_it_depends_verdict` depends on it.

The fixture's `pruned_traps_include_any` was also wrong in its first draft (T3, T5, T7): T5
cannot prune a branch that met the output contract, and T7 is what DOOR_KEEPER and HORIZON
exist to attack. It now lists T1, T2, T3, with the reason in the fixture.

## A second critic

`critic/pass-a.rater2.yaml` is a second blind pass A over the same five artifacts, produced
2026-09-07 from `critic/pass-a.brief.md` verbatim by a critic in a separate context window that
read no other file. It is evidence about the rubric, not part of this run: the run shipped on
`pass-a.yaml` and `score.json` is unchanged.

84% exact agreement over 45 cells, 100% within one point. The overall ranking changed (HORIZON
overtook DOOR_KEEPER) and the outcome did not: the one contested cluster kept DOOR_KEEPER, and
HORIZON is a singleton that goes to deepen either way. Read it with:

```
adhd learn --run evals/recorded/003-kernel-strategy --agreement evals/recorded/003-kernel-strategy/critic/pass-a.rater2.yaml
```

Findings are recorded under D8 in `docs/DECISIONS.md`.
