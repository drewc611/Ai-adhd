# Devcontainer

Node 22, `npm ci && npm run build && npm test` on create. Catalogue 61.

Nothing here supplies inference, and nothing here should. This package never calls a model
(D2), so a container that could run a fixture end to end would have to bring a host that spawns
subagents — which is the one thing the design puts outside this repository. What the container
gets you is the part that is here: the compiler, the validator, the scorer, the eval harness and
the recorded corpus, all runnable in a minute from a clean clone.

`scripts/demo.sh` is the tour. It stops at the D5 gate and says why.
