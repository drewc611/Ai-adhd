import { test } from "node:test";
import assert from "node:assert/strict";
import { cfg } from "./helpers.js";
import { checkBlind, checkBriefIsolation, redactFrameLabels, type FrameLabel } from "../src/validate.js";

const LABELS: FrameLabel[] = cfg.frames.frames.map((f) => ({ id: f.id, name: f.name }));
const PROBLEM = "What timeouts should I set on this HTTP client?";

/**
 * Every way a writer might spell one frame's label. A branch writes "from inside the Door keeper
 * stance" far more naturally than DOOR_KEEPER, and "door-keeper" as naturally again. Each of
 * these identifies the frame exactly as well as the id does, so pass A is not blind while any of
 * them survives.
 */
function variants(token: string): string[] {
  const words = token.split(/[\s_]+/).filter(Boolean);
  const joins = words.length > 1 ? [" ", "  ", "-", "_", "", "\n", " \t"] : [""];
  const out = new Set<string>();
  for (const j of joins) {
    const joined = words.join(j);
    out.add(joined);
    out.add(joined.toLowerCase());
    out.add(joined.toUpperCase());
    out.add(words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(j));
  }
  return [...out];
}

const contexts = (label: string) => [
  `From inside ${label}: the answer is X.`,
  `As the ${label} frame, I would ship it.`,
  `the ${label}'s position is that you should not.`,
  `Reasoning (${label}): nobody owns the retry.`,
  `# ${label}\n\nPosition: do the thing.`,
];

test("no separator or case spelling of any frame label survives the blind check", () => {
  const leaks: string[] = [];
  for (const f of LABELS)
    for (const token of [f.id, f.name])
      for (const v of variants(token))
        for (const text of contexts(v)) if (checkBlind(text, LABELS, { problem: PROBLEM }).length === 0) leaks.push(`${f.id}: ${JSON.stringify(v)}`);
  assert.deepEqual([...new Set(leaks)], [], "these spellings identified a frame and were not caught");
});

test("the same spellings are caught in a sibling's brief", () => {
  const leaks: string[] = [];
  for (const own of LABELS)
    for (const other of LABELS) {
      if (other.id === own.id) continue;
      for (const v of variants(other.name))
        if (checkBriefIsolation(`Brief for the run.\n\n${v} argued the opposite.`, own.id, LABELS, { problem: PROBLEM }).length === 0) leaks.push(`${own.id} brief showed ${other.id} as ${JSON.stringify(v)}`);
    }
  assert.deepEqual([...new Set(leaks)], []);
});

/**
 * The two must agree by construction: anything the check would flag, the redactor must already
 * have removed. If they can disagree, a brief passes redaction and then fails its own assertion,
 * or worse, passes both while still carrying the label.
 */
test("redaction removes exactly what the blind check would flag", () => {
  for (const f of LABELS)
    for (const token of [f.id, f.name])
      for (const v of variants(token))
        for (const text of contexts(v)) {
          const redacted = redactFrameLabels(text, LABELS, { problem: PROBLEM });
          assert.deepEqual(checkBlind(redacted, LABELS, { problem: PROBLEM }), [], `redaction left a label in: ${JSON.stringify(text)}`);
        }
});

test("a frame's own label survives redaction when it is kept, in every spelling", () => {
  for (const f of LABELS)
    for (const v of variants(f.name)) {
      const kept = redactFrameLabels(`From inside ${v}: do the thing.`, LABELS, { keep: f.id, problem: PROBLEM });
      assert.ok(kept.includes(v), `keep: ${f.id} lost its own label spelled ${JSON.stringify(v)}`);
    }
});

/**
 * The exemption that stops a problem about a mechanic's dashboard from aborting a blind run. It
 * has to survive the looser matching, or every problem naming an end user aborts.
 */
test("a label the problem itself uses is exempt however either side spells it", () => {
  const problem = "Our door-keeper service rejects requests. What timeouts should it use?";
  for (const v of variants("DOOR_KEEPER").concat(variants("Door keeper")))
    assert.deepEqual(checkBlind(`From inside ${v}: reject early.`, LABELS, { problem }), [], `${JSON.stringify(v)} should be exempt`);
  // The exemption is per label, not blanket: another frame in the same text still leaks.
  assert.ok(checkBlind("Door-keeper and Night operator disagree.", LABELS, { problem }).length > 0);
});

/**
 * The guard against catastrophic backtracking in the label matcher. Exponential blowup here is
 * reachable by anyone who can put text in an artifact, so it is worth a test.
 *
 * Measured as a *minimum* over repeated trials, on inputs big enough to take milliseconds. The
 * previous version timed a single sample of a sub-millisecond call, and CI failed it at
 * `0.18ms -> 5.23ms` on code that had not changed — no `src/` file differed from the last green
 * run, and it passed twelve times out of twelve locally. A 0.18ms baseline on a shared runner is
 * not a measurement of anything.
 *
 * The minimum is the right statistic rather than the mean or the median: scheduler noise only ever
 * *adds* time, so the fastest trial is the closest estimate of what the algorithm actually costs,
 * and a runner under sustained load contaminates a median just as thoroughly as a mean.
 */
test("label matching is linear on adversarial input", () => {
  const grow = (n: number) => "Door" + "_".repeat(n) + "x ".repeat(n);
  const fastest = (n: number, trials = 5) => {
    const text = grow(n);
    let best = Infinity;
    for (let i = 0; i < trials; i++) {
      const t = process.hrtime.bigint();
      checkBlind(text, LABELS, { problem: PROBLEM });
      best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
    }
    return best;
  };
  fastest(8_000, 2); // warm the JIT, so the first measured trial is not compiling
  const small = fastest(8_000);
  const large = fastest(32_000);
  // 4x the input. Linear lands near 4x, quadratic near 16x, and exponential leaves the building.
  // 20x is the same tolerance this test has always used, kept rather than tightened: the point is
  // catching blowup, and a threshold that also has to be right about the constant factor is a
  // threshold that fails for the wrong reason.
  assert.ok(
    large < small * 20,
    `4x the input took ${(large / small).toFixed(1)}x the time (${small.toFixed(2)}ms -> ${large.toFixed(2)}ms)`,
  );
});

test("a text naming no frame is left alone", () => {
  const clean = "Set a cancel button first, then a caller supplied deadline. Someone pays for the retry.";
  assert.deepEqual(checkBlind(clean, LABELS, { problem: PROBLEM }), []);
  assert.equal(redactFrameLabels(clean, LABELS, { problem: PROBLEM }), clean);
});
