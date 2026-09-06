# Evals

`fixtures/` holds prompts with `must_surface` and `must_not` assertions. `recorded/` holds
run directories, real or hand written, that the harness replays. The harness never calls a
model: it hashes the fixture prompt, checks the recorded `problem_hash`, and evaluates the
assertions against `synthesis.md` and the surviving branch artifacts.

`adhd eval` with no arguments runs every fixture against every recorded run whose directory
name starts with the fixture id, and prints PASS or FAIL per pair with the failing assertion
ids.

`recorded/001-linear-cot/` is the negative control. It must FAIL. Its `problem_hash` is the
placeholder `sha256:pending` until the compiler exists; the harness treats a placeholder hash
as a fixture authoring error, not a mismatch, so the recorded run still gets evaluated.
