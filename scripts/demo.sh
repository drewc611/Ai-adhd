#!/usr/bin/env bash
# What a clean checkout can show without a model. Generated intent, hand-maintained script.
#
# This package never calls a model (D2 in docs/DECISIONS.md), so a demo cannot produce a run:
# a run needs a host to spawn isolated subagents. What it shows is everything either side of
# that boundary, which is the part this repository actually is.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n\n' "$1"; }

step "1. Build and check the library"
npm run build --silent
node dist/src/cli.js validate
node dist/src/cli.js doctor | tail -3

step "2. The frame library"
node dist/src/cli.js frames | tail -5

step "3. Compile a problem and show the D5 gate"
printf 'What timeouts should I set on this HTTP client?' > /tmp/adhd-demo-problem.txt
node dist/src/cli.js run --phase compile \
  --problem /tmp/adhd-demo-problem.txt \
  --decision '{"problem_class":"design_decision"}' \
  --runs-dir /tmp/adhd-demo-runs | head -30

echo
echo "Nothing has been spent. A host would now spawn one subagent per brief; this package"
echo "never does that itself, which is the whole of D2."

step "4. A run that did happen, with its pruned block"
node dist/src/cli.js why evals/recorded/001-first-run FRAME_BREAKER | head -25

step "5. What the corpus says about the library"
node dist/src/cli.js frames --health | tail -6
node dist/src/cli.js cost | tail -3

step "6. The harness"
node dist/src/cli.js eval | tail -3
node dist/src/cli.js matrix | tail -4

printf '\nEverything above ran from the recorded corpus and the compiler. No model was called.\n'
