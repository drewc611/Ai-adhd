# Security audit — Ai-adhd — 2026-09-27

Part of a 22-repository audit of this account. The cross-repository report (method, pain points, business impact, solution analysis, roadmap) is published at https://claude.ai/artifact/KgdrC9eNyCwdqjvSfwMNuB.

## Summary for this repository

| Severity | Count |
|---|---|
| Medium | 2 |
| Low | 1 |

Automated passes run against this repository: gitleaks 8.24.2 (full history and tree), the placeholder-credential checker now shipped in `scripts/`, semgrep 1.178.0 (`p/security-audit`, `p/secrets`, `p/owasp-top-ten`, `p/github-actions`), bandit, pip-audit and npm audit where applicable, plus a manual review of auth, input handling, workflows and deployment files.

## Findings

| ID | Severity | Category | Location | Evidence | Impact | Fix | Status |
|---|---|---|---|---|---|---|---|
| AA-1 | Medium | `adhd serve` binds all interfaces with no auth or Origin check | `src/cli.ts:344-345; src/serve.ts:75-104` | `server.listen(o.port, ...)` (no host) while printing `http://localhost`; `POST /api/dump` auto-confirms a mission | Any LAN host or any website (no-cors fetch) can enqueue prompts that a worker later executes with real subagents and tokens. | `server.listen(port, "127.0.0.1")`; validate `Host`/`Origin`; cap request bodies. | open |
| AA-2 | Medium | Unpinned binary piped into a publish job | `.github/workflows/release.yml:118-123` | `curl -fsSL .../releases/latest/download/mcp-publisher_... \| tar xz` then `./mcp-publisher login github-oidc` with `id-token: write`, `packages: write` | A malicious release of the publisher gets OIDC identity and package publish rights. | Pin a version and verify SHA256. | open |
| AA-3 | Low | Actions on tags and a branch ref; no Dependabot for actions | `publish-python.yml:71; release.yml:38-39; test.yml; codeql.yml` | `pypa/gh-action-pypi-publish@release/v1` (a branch) in the PyPI trusted-publishing job | Any push to that branch runs in the publish job. | Pin SHAs; add `.github/dependabot.yml`. | open |

## Guardrails added in this change

- `scripts/check-placeholder-secrets.sh` — fails the build on placeholder credentials, secret defaults, disabled-auth defaults, `debug=True`, literal secret assignments, private keys and committed `.env` files.
- `.gitleaks.toml` — gitleaks defaults plus custom placeholder rules and a fixture allowlist.
- `.github/workflows/secret-scan.yml` — runs both on every push and pull request and weekly over full history (SHA-pinned actions).
- `.pre-commit-config.yaml` — the same checks locally; run `pre-commit install` once.
- `docs/security/AI-CODING-GUARDRAILS.md` — the binding rules for any AI-assisted change, with references.
- A "Security rules for AI-assisted changes" section in `CLAUDE.md` (and `AGENTS.md` / Copilot instructions where present).
- `.gitignore` rules for `.env`, keys and Terraform state where they were missing.

See the cross-repository report for the fail-closed pattern by language and the prioritised fix list.
