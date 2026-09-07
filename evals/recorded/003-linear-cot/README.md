# Recorded run: 003, linear chain of thought

A hand recorded negative case for fixture 003. `adhd eval` must report FAIL on this directory.

This is the answer most engineers would call good. The citations are real, the trade-offs are
accurate, the strangler fig recommendation is the industry consensus, and the twenty-engineer
heuristic is the kind of concrete threshold that makes an answer feel actionable. It would pass
almost any review.

## What it does not do

- It opens by handing the decision back ("it depends"), then never takes it back.
- The argument leans on Fowler, Newman, and three famous companies. Strip the names and the
  reasoning that remains is thin, which is exactly what the T3 detector looks for.
- It never asks how the asker would learn the bet was wrong, or when. For a decision with a
  detection latency measured in quarters, that is the omission that matters most.
- It never names who carries the pager for thirty services, or who pays for the year.
- It treats the rewrite as a configuration choice rather than a door that does not reopen.

Fixture 003's `no_it_depends_verdict` check exists specifically to fail this answer.
