# Repository security operations

Owner-only settings. Nothing here is reachable from a build step or from an agent session, so this
file is a checklist rather than a record of work done. Each item says who can do it and what it
currently is, checked rather than assumed where checking was possible.

## 1. The default branch is the agent's branch, and that is the first thing to fix

**Current state, verified:** `git remote show origin` reports the default branch as
`claude/adhd-architecture-build-jlyjk2`. `main` sits tens of commits behind and receives merges from
it by pull request.

That is backwards, and no amount of branch protection repairs it. The protocol below is built on
"automated changes go to a feature branch, and the feature branch reaches the default branch through
a reviewed pull request." Here the feature branch *is* the default branch, so every agent push lands
on the branch protection is meant to guard.

- [ ] Set `main` as the repository's default branch (**Settings → General → Default branch**).
- [ ] Merge or rebase the agent branch's history into `main` first, so nothing is stranded.
- [ ] Confirm afterwards that `git remote show origin` reports `main`.

Until that is done, the rest of this section protects a branch nobody is pushing to.

## 2. Branch protection on the default branch

**Settings → Branches → Add branch ruleset.** Not checkable from here: the protection API returns
403 to this session, which means "not readable with these credentials", not "not configured".

- [ ] Require a pull request before merging.
- [ ] Require status checks to pass. The ones that exist: `test (20)`, `test (22)`, `analysis`,
      `reports`, `Analyze (javascript-typescript)`, `Analyze (actions)`, `CodeQL`.
- [ ] Block force pushes.
- [ ] Do not allow bypassing the above settings, so administrators are bound too.

## 3. Commit signature verification

**Current state, verified:** commits on this branch are unsigned — `git log --format=%G?` reports
`N` throughout — and no signing key is configured in this environment.

Signing has to be set up on a machine that holds a private key. An ephemeral agent container is not
that machine, and an agent that could sign commits as you would defeat the point of signing them.

- [ ] Generate a signing key on your own machine and register it on GitHub as a **Signing Key**.
- [ ] Decide what should happen to agent-authored commits, which cannot be signed by your key.
      Either accept them unsigned, or require signatures and have a human sign the merge commit,
      which is the usual arrangement and keeps the guarantee meaningful.

## 4. Least-privilege credentials

Nothing in this repository holds a credential. Verified: no key material in the tree, `npm audit`
clean, and every workflow secret referenced through `env:` rather than interpolated into a shell.
`analysis/corpora/eip/eip00008.md` contains strings that read like keys; they are the published
example values in EIP-8's specification text and are not secrets.

- [ ] Use fine-grained PATs scoped to this repository with `Contents: Read & Write` only, or a
      repository deploy key, rather than an account-wide token.
- [ ] Set an expiry of 30–90 days on every automation token.
- [ ] `NPM_TOKEN` is the one secret this repository's workflows expect (`release.yml`). It is not
      set; publishing is skipped without it.

## 5. Secret scanning and push protection

**Settings → Code security and analysis.** Not checkable from this session.

- [ ] Enable secret scanning.
- [ ] Enable push protection, which blocks a push whose diff contains a detected secret. This is the
      item with the most value per click here, because an agent commits text automatically and on a
      schedule.

## What the code already does

These are enforced by tests rather than by settings, and they are checked on every run:

- `test/boundary.test.ts` refuses `torch`, `tensorflow`, `transformers`, any inference client, and
  any writer under `evals/`, `config/`, `prompts/` or `docs/`.
- Model files are gzipped TSV and never `pickle`, so loading one on a schedule is not a
  code-execution path. `tests/test_text_model.py` fails if that changes.
- `text/modelfile.py` bounds what a model file may declare: header and line sizes, total
  decompressed bytes, every dimension, and the memory a set of parameters may ask for (D22).
- `scripts/fetch_corpus.py` re-checks its URL allowlist on every redirect hop and on the final URL,
  refuses anything but `text/plain`, and reads at most 16MB per document (D18).
- Workflows interpolate `${{ }}` only inside `env:`, never into a `run:` body (D18). A test scans
  for it.
