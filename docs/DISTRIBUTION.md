# Distribution

Where this can go, what each venue is actually good for, and which ones need something only the
owner can give. Researched against the live services rather than from memory: `ai-adhd` and
`adhd-analysis` were both checked as available, and none of the four directories below has indexed
this repository yet.

| venue | state | what a user runs | needs |
|---|---|---|---|
| Claude Code marketplace | **live** | `/plugin marketplace add drewc611/Ai-adhd` | nothing |
| GitHub Packages | **wired, fires on a tag** | authenticated `npm install` | nothing — `GITHUB_TOKEN` |
| Citation metadata | **live** | GitHub's "Cite this repository" | nothing |
| npm | wired, fires on a tag | `npx ai-adhd` | an `NPM_TOKEN` secret |
| Official MCP Registry | wired, fires on a tag | any registry-aware host | the npm publish above |
| PyPI (`analysis/`) | wired, fires on a tag | `pip install adhd-analysis` | one PyPI web form, no secret |
| Zenodo DOI | ready | a citable DOI per release | one OAuth toggle |
| Glama | auto-indexes GitHub | its directory | probably nothing |
| Smithery, mcp.so, PulseMCP | submission | their directories | a form, after the registry |
| OpenAI app directory | **refused** | — | see below |

## The three that cost nothing

**GitHub Packages** takes `GITHUB_TOKEN` with `packages: write`, minted per run and gone when the
job ends. There is no secret to add and none to rotate. It is a second home for the same tarball
rather than a substitute for npm: GitHub Packages requires an authenticated `npm install` even for
a public package, so it reaches people who already have a token and not the `npx` case. The name is
rewritten to `@drewc611/ai-adhd` for that step only, because GitHub Packages requires the scope to
match the owner and the npmjs name is deliberately unscoped so `npx ai-adhd` works without one.

**`CITATION.cff`** makes GitHub render a "Cite this repository" button immediately, and Zenodo
reads the same file when the owner enables the integration. It costs a file.

**PyPI** turns out not to need a token either. Trusted publishing exchanges a GitHub OIDC identity
for a credential that expires within fifteen minutes, so the thing an attacker could steal from
this repository does not exist. It needs one web form on PyPI naming this repository, this workflow
and the `pypi` environment — a click, not a secret. Until that exists the upload step fails saying
exactly that, which is the correct failure for a publish nobody has authorised.

`publish-python.yml` fires on `analysis-v*` rather than `v*`, because the analysis package is its
own package with its own version: `pyproject.toml` says 0.1.0 while `package.json` says 0.0.1, and
they move for different reasons. Sharing a tag would force a release of one whenever the other
changed.

## The MCP directories

The official registry feeds the rest, so it goes first and the others follow. Glama auto-indexes
open-source MCP servers from GitHub and may pick this up without being asked; Smithery, mcp.so and
PulseMCP take a submission. None of them is worth chasing before the registry entry exists, because
the registry is what most of them read.

## Zenodo

A DOI per GitHub release, which is what makes the findings citable rather than linkable — the
chance-corrected reliability result and the T1 sign result are the parts of this repository someone
might want to reference. It needs the owner to authorise Zenodo against their GitHub account and
toggle this repository on. `CITATION.cff` is already in place for when they do.

## Claude Code

This repository is its own marketplace. That is the whole mechanism: Claude Code ships Anthropic's
marketplace pre-registered and **there is no public submission process** for third-party plugins to
it. Organisations distribute through their own marketplace repositories, and a marketplace is a git
repository with a `.claude-plugin/marketplace.json` in it.

```
/plugin marketplace add drewc611/Ai-adhd
/plugin install adhd@adhd
```

or, for a team, in `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "adhd": { "source": { "source": "github", "repo": "drewc611/Ai-adhd" } }
  },
  "enabledPlugins": { "adhd@adhd": true }
}
```

The skill, the four run agents and the commands work from a fresh install with nothing built. The
MCP server does not, because `dist/` is a build artifact and is gitignored, so `bin/adhd-mcp.mjs`
exists to say that in a sentence instead of failing with a module path inside the host's plugin
cache. It does not build on the user's behalf: hosts start MCP servers without asking, and a
server that runs `npm install` on first start is a surprise with a network fetch in it.

`.claude-plugin/plugin.json` names the agents it ships rather than pointing at the whole `agents/`
directory: the four run agents and the five mission agents the SuperAgent dispatches, and not
`adhd-trainer` or `adhd-governor`, which maintain this repository's own background model and would
arrive at a plugin user as two agents referencing paths they do not have.

Three skills install: `adhd` drives a run, `adhd-worker` executes one, `superagent` drives a
mission across research, a divergent decision, build, verify, create and review.

## npm and the MCP Registry

`git tag v0.1.0 && git push --tags` runs `.github/workflows/release.yml`, which publishes to npm
and then registers that exact version with the official MCP Registry.

**One secret is needed and this repository cannot create it.** Add `NPM_TOKEN` under Settings →
Secrets and variables → Actions, from an npm automation token. The registry step needs nothing:
it authenticates with the workflow's own GitHub OIDC identity, which is what proves the
`io.github.drewc611/*` namespace.

**The package is `ai-adhd`, not `adhd`.** npm already serves `adhd` — a 2022 stub at version
0.0.0, description "unstable wip, do not use atm". Publishing under it returns a 403 that reads
like a permissions problem. `docs/BACKLOG.md` item 72 called the name the owner's decision; the
registry made it. The CLI binary is still `adhd`.

**npm goes first, and the order is load-bearing.** The MCP Registry proves package ownership by
reading `mcpName` out of the published `package.json` and checking it matches the server name being
claimed. Publishing to the registry against a version npm does not yet serve fails describing a
missing field rather than a race.

Four files carry the version and they disagree silently. `test/marketplace.test.ts` checks them
against each other on every run, and the release workflow checks them against the tag.

## OpenAI

Not possible as built, and the obstacle is the architecture rather than an account.

The ChatGPT app directory takes MCP servers, and the submission requirements are a stable publicly
reachable HTTPS endpoint serving `/mcp`, domain verification through a token at
`https://<host>/.well-known/openai-apps-challenge`, developer identity verification in the OpenAI
platform dashboard, and an organisation role carrying Apps Management write.

The first requirement is the one that does not survive contact with D2. This MCP server is stdio
and local by design: it compiles briefs and validates contracts, and the *host* supplies inference
by spawning isolated subagents. A hosted remote server has no subagents to spawn. It would have to
call a model to do anything, which is the inference client CLAUDE.md bans on the first page and D2
argues against for a reason that is not about cost — branch isolation is a property of separate
context windows, and a remote server holding one conversation has none.

So the honest options are: publish a different thing there (a hosted service that calls a model,
which is a different project and would falsify this one), or do not. This repository does not.

The three remaining requirements are also things the repository cannot supply on its own: a domain
the owner controls, the owner's own verified identity, and a role assignment in the owner's OpenAI
organisation.

## PyPI, the part that changed

An earlier version of this file said publishing `analysis/` was not worth doing first because it
needed a token and a release cadence for a package whose only consumer is this repository. The
token turned out not to be needed — trusted publishing is OIDC — and the cadence turned out to be
free, because a separate tag prefix keeps it from dragging the TypeScript release along. What is
left is one web form on PyPI, and `adhd-analysis` is still available.
