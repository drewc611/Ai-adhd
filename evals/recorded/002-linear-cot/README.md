# Recorded run: 002, linear chain of thought

A hand recorded negative case for fixture 002, packaged as a one branch run so the harness has
something that must fail. `adhd eval` must report FAIL on this directory.

This is deliberately not a strawman. It is the answer a competent engineer gives: seven real
causes, correctly ordered by how often they turn out to be the culprit, with a sensible next
step. Every individual sentence is defensible. That is the point of the control — the failure
is not in what it says, it is in what it never asks.

## What it does not do

- It never asks who the p99 tail lands on, or whether p99 is the metric that matters here.
- It never notices that "or so" in the problem statement is itself evidence about the cause.
- It never sequences a cheap observation before an expensive change; every item is presented
  as equally worth checking, which leaves the ordering to the reader.
- It hands back a list and forces no decision. Nothing is foreclosed and nothing is falsifiable.

A run passes fixture 002 only by doing what this cannot.
