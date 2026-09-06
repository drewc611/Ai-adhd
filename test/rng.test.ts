// D3: every run is seeded and the seed is logged, so a recorded run must be replayable. That
// guarantee rests entirely on this module, which had no test until now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSeed, mulberry32, randomSeed, shuffle } from "../src/rng.js";
import { compile } from "../src/compile.js";
import { cfg } from "./helpers.js";

const PROBLEM = "What timeouts should I set on this HTTP client?";

test("the same seed gives the same stream, and the values are pinned", () => {
  const a = mulberry32(1);
  const first = [a(), a(), a(), a(), a()].map((x) => Number(x.toFixed(10)));
  const b = mulberry32(1);
  assert.deepEqual([b(), b(), b(), b(), b()].map((x) => Number(x.toFixed(10))), first, "same seed, same stream");
  assert.notEqual(mulberry32(2)(), mulberry32(1)(), "a different seed must not start the same way");
  // Pinned. If the generator is ever changed, this fails here rather than every recorded run
  // silently ceasing to replay, which is the failure D3 exists to prevent.
  assert.deepEqual(first, [0.6270739406, 0.0027357212, 0.52744704, 0.9810509675, 0.9683778982]);
});

test("every value is in [0,1) and the stream does not immediately repeat", () => {
  const r = mulberry32(12345);
  const seen = new Set<number>();
  for (let i = 0; i < 10_000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `value ${v} out of range at ${i}`);
    seen.add(v);
  }
  assert.ok(seen.size > 9_900, `stream repeated too often: ${seen.size} distinct of 10000`);
});

test("shuffle is a permutation, does not mutate its input, and is deterministic per seed", () => {
  const items = Object.freeze(["a", "b", "c", "d", "e", "f", "g"]);
  const once = shuffle(items, mulberry32(7));
  const twice = shuffle(items, mulberry32(7));
  assert.deepEqual(once, twice, "same seed, same order");
  assert.deepEqual([...once].sort(), [...items].sort(), "shuffle must be a permutation");
  assert.deepEqual(items, ["a", "b", "c", "d", "e", "f", "g"], "input must not be mutated");
  assert.notDeepEqual(shuffle(items, mulberry32(8)), once, "a different seed should reorder");
  assert.deepEqual(shuffle([], mulberry32(1)), []);
  assert.deepEqual(shuffle(["only"], mulberry32(1)), ["only"]);
});

test("shuffle reaches every position: no element is pinned by an off-by-one", () => {
  // A Fisher-Yates written `i > 0` but indexed wrongly can leave element 0 in place forever.
  const items = ["a", "b", "c", "d", "e"];
  const positionsSeen = items.map(() => new Set<number>());
  for (let seed = 0; seed < 200; seed++) {
    const out = shuffle(items, mulberry32(seed));
    out.forEach((v, i) => positionsSeen[items.indexOf(v)]!.add(i));
  }
  items.forEach((v, i) => assert.equal(positionsSeen[i]!.size, items.length, `${v} never reached every position`));
});

test("derived seeds separate the phases without leaving the run replayable", () => {
  const seed = 42;
  const perPhase = [1, 2, 3, 4].map((salt) => deriveSeed(seed, salt));
  assert.equal(new Set(perPhase).size, perPhase.length, "each phase needs its own stream");
  assert.deepEqual([1, 2, 3, 4].map((s) => deriveSeed(seed, s)), perPhase, "derivation is pure");
  for (const v of perPhase) assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff, `${v} is not a uint32`);
  assert.notEqual(deriveSeed(0, 1), deriveSeed(1, 1), "seed must matter");
});

test("randomSeed returns a uint32 and varies", () => {
  const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()));
  for (const s of seeds) assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, `${s} is not a uint32`);
  assert.ok(seeds.size > 40, "randomSeed should not collide constantly");
});

test("a compiled run replays: the same seed picks the same frames in the same order", () => {
  const decision = { problem_class: "design_decision" as const };
  const a = compile(cfg, PROBLEM, decision, { seed: 99 });
  const b = compile(cfg, PROBLEM, decision, { seed: 99 });
  if (a.kind !== "plan" || b.kind !== "plan") throw new Error("expected plans");
  assert.deepEqual(
    b.plan.branches.map((x) => x.frame),
    a.plan.branches.map((x) => x.frame),
    "D3: a recorded seed must reproduce the dispatch order",
  );
  assert.equal(b.plan.problem_hash, a.plan.problem_hash);
  const other = compile(cfg, PROBLEM, decision, { seed: 100 });
  if (other.kind !== "plan") throw new Error("expected a plan");
  assert.notDeepEqual(other.plan.branches.map((x) => x.frame), a.plan.branches.map((x) => x.frame), "a different seed should shuffle differently");
});
