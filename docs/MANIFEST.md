# Architectural manifest and behavioral guardrails

Binding on every change to this repository, by a person or an agent. `CLAUDE.md` says what this
repo is and what it must never contain; this file says how the code inside it gets written.
Where they overlap, `CLAUDE.md` wins.

## 1. Code synthesis and pragmatism

**No AI archetypes.** Do not generate textbook generic patterns. Write as a highly opinionated
senior systems architect who favours maintenance velocity over dogma.

**Context preservation.** Match the host repository's implicit design philosophies,
architectural boundaries, paradigms (FP vs OOP) and formatting quirks exactly. In this repo that
means: pure functions over the YAML in `config/`, `zod` schemas as the single source of truth,
errors that carry a code and abort rather than degrade, and tests that assert a claim a doc makes
rather than a line a function ran.

**Dependency minimisation.** Use primitive language features or utilities already present. Do not
add a package for a trivial utility. The TypeScript side has four runtime dependencies and the
Python side has three; both numbers are a decision, not an accident.

**Idempotency and safety.** Every mutation, migration and state change fails loudly and safely.
Production-ready error handling, logging context and graceful degradation on the first pass. No
placeholders, no `TODO` left as the implementation.

## 2. Execution and code review aesthetics

**Nix semantic fluff.** No line-by-line documentation. `// initialize counter` and `// catch
block` get deleted on sight.

**The "why" rule.** Document edge cases, mathematical constraints, performance trade-offs, and
upstream API quirks that cannot be deduced from the types and syntax. Nothing else. The
Kneser-Ney discount estimator carries a comment because the formula is not visible in the code;
the loop that applies it does not.

**Refactoring thresholds.** No pre-abstraction. Rule of three: abstract on the third concrete
duplication, not the first. Slightly redundant and readable beats deeply nested and generic.

## 3. Communication strategy and diff semantics

**Zero fluff.** No greetings, no validations, no "I hope this helps". Start with the code or the
architectural critique.

**Strict diff scoping.** Never reproduce unmodified blocks. Isolated contextual snippets or
unified diff targeting only the modified functions.

**Impact over summary.** Say what the change makes possible or impossible, not what it contains.
A diff already contains itself.

## How this is enforced

`test/manifest.test.ts` checks the mechanical parts: no narrating comments in new source, no
dependency added without an entry in `package.json` or `pyproject.toml` that a test names, and no
source file that documents its own control flow. The judgement calls are not enforceable and are
not pretended to be.
