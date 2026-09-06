# Contributing

ADHD is a reasoning architecture. The YAML in `config/` and the prompts in `prompts/` are
the product; the TypeScript is plumbing. Most useful contributions are to the product, and
the product has rules that the plumbing enforces. Read `CLAUDE.md` and `docs/DECISIONS.md`
before opening anything.

## Ground rules

- **No inference client.** Nothing in this repo may import a model SDK or call a model. The
  library compiles, validates, scores, and evals. Hosts supply inference by spawning
  subagents. A PR that adds an API client will be closed with a pointer to D2.
- **No quality rubric.** The critic rubric scores divergence value, not fluency,
  thoroughness, or balance. Those reward the consensus trap. `crossCheck` rejects a rubric
  dimension whose id appears in `not_scored`.
- **Every non-negotiable in `CLAUDE.md` has a test.** If you touch the compiler, the critic
  packing, the scorer, or the deepen phase, run `npm test` and expect the isolation, blind,
  hash, and detector-completeness tests to still pass. Do not weaken them to get green.

## Proposing a frame

Frames are the expensive part: every frame in a run costs a full branch. D6 is the policy.

1. Name a problem where the new frame and every existing frame reach materially different
   positions. Add it as a fixture in `evals/fixtures/` with `must_surface` items only the new
   frame is expected to hit.
2. Add the frame to `config/frames.yaml` with `id`, `axis`, `attacks`, `tools`, `stance`,
   `probes`, and `forbidden`. `forbidden` must be non-empty; a frame that forbids nothing is a
   suggestion, not a distortion. `tools` may only contain `WebSearch` and `WebFetch`.
3. Run `node dist/src/cli.js validate`. The static D6 check must pass.
4. Run the fixture for real (see `skills/adhd/SKILL.md`) and record the run under
   `evals/recorded/<fixture-id>-<name>/` with a `README.md` saying what it surfaced and what
   it did not. If the run fails the fixture, record it with `expected.json { outcome: fail }`
   and the reason. Do not hide misses.
5. Run `node dist/src/cli.js frames --orthogonality`. A pair above 60% co-clustering over
   three or more shared runs is a duplicate wearing different words.

Use the "Frame proposal" issue template to discuss before doing the run; runs cost tokens.

## Changing a fixture

A fixture is a claim about what a good run must surface. Tightening a pattern because a run
matched an unrelated sentence is welcome (it happened on the first run). Loosening a pattern
so a run passes is not. If a recorded run no longer matches its `expected.json`, the PR must
say why.

## Code

- TypeScript, Node 20+, ESM. `npm test` builds and runs everything.
- Schemas are `.strict()`. Unknown keys reject. Keep it that way.
- Prompts are templates rendered by `src/template.ts`; values are inserted once and never
  rescanned. A problem statement containing `{{` must pass through byte for byte.
- Commit messages say what changed and why. No model names in commits, PR titles, or code.

## Recording a run

A recorded run is the run directory as the phases left it, plus a `README.md` with
provenance (which host, which agent type, anything blocked or retried), what surfaced, what
did not, and what the run taught the plumbing. Token counts go in `cost.json`. Never edit
artifacts after the fact; if an artifact was wrong, the run is wrong, and that is the record.
