# Distribution

Four surfaces, at three different stages. What is live, what needs one credential the repository
cannot hold, and what is blocked on architecture rather than on paperwork.

| surface | state | what a user runs | blocked on |
|---|---|---|---|
| Claude Code plugin marketplace | **live on merge** | `/plugin marketplace add drewc611/Ai-adhd` | nothing |
| npm | ready, unpublished | `npx ai-adhd --help` | an `NPM_TOKEN` repository secret |
| Official MCP Registry | ready, unpublished | any registry-aware MCP host | the npm publish above |
| PyPI (`analysis/`) | ready, unpublished | `pip install adhd-analysis` | a PyPI token, and a decision that it is worth it |
| OpenAI ChatGPT app directory | **not possible as built** | — | see below |

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

`.claude-plugin/plugin.json` ships the four run agents by name rather than the whole `agents/`
directory, which also holds `adhd-trainer` and `adhd-governor` — those maintain this repository's
own background model and would arrive at a plugin user as two agents referencing paths they do not
have.

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

## PyPI

`analysis/` is a working package with a console script and 43 tests, and nothing depends on it
being installable from an index — `pip install -e analysis` is what CI does and what the trainer
agent's brief says to run. Publishing it means owning a name and a release cadence for a package
whose only consumer is this repository. Worth doing if someone asks; not worth doing first.
