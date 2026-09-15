import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "./helpers.js";
import { renderBranchBrief } from "../src/compile.js";
import { parse as parseYaml } from "yaml";
import { validateBranchArtifact, validateDeepen } from "../src/validate.js";
import { RunAbort } from "../src/errors.js";

/**
 * Backlog 87. The output contract gives `reasoning` a block scalar and leaves `position`,
 * `falsifier` and `missing_actor` as plain ones, so a colon-space anywhere in those three makes
 * the artifact unparseable, and since D30 an unparseable artifact aborts the run.
 *
 * These are not invented strings. All three are verbatim from run `20260914223732-7e664e`, the
 * seed 3 dispatch of fixture 001, which lost three branches out of five this way and aborted
 * having paid for all five. D30's record priced the case as "one flaky subagent"; the cause here
 * is the contract, and it fires on any branch that writes the way people write.
 *
 * Nothing here chooses the fix. It pins what the contract does today, in the shape the failure
 * actually took, so that whichever fix is adopted has something to turn green — and so that the
 * "eleven recorded runs all parse" fact is held as the coincidence it is rather than as evidence
 * the contract is sound.
 */

const HASH = "sha256:7e664e715f0b6fb0f409965455dc0e635d68e89b73f8ad68ba977bb7b1f2d394";

/** The three values, verbatim, and the internal `: ` in each that the parser refuses. */
const OBSERVED: { frame: string; field: "falsifier" | "missing_actor"; value: string; culprit: string }[] = [
  {
    frame: "DOOR_KEEPER",
    field: "falsifier",
    value:
      "The one-week histogram shows healthy p99.9 time-to-last-byte above 2s. A second, equally cheap falsifier: the would-have-retried counter shows well under 0.1% of requests.",
    culprit: "falsifier: ",
  },
  {
    frame: "LEDGER",
    field: "falsifier",
    value:
      "Instrument the client for a week and plot the latency distribution of successful responses. Cheaper still: find one production incident report where a client's retries amplified a remote brownout.",
    culprit: "still: ",
  },
  {
    frame: "FRAME_BREAKER",
    field: "falsifier",
    value:
      "Instrument the existing client for a week and compare the distribution of time-remaining-at-call against the fixed timeout. Equally falsifying: if deadline-exceeded work is a rounding error in traces, the budget framing is solving a problem this system does not have.",
    culprit: "falsifying: ",
  },
];

/** The shipped contract's shape: `reasoning` folded, the other free-text fields plain. */
function asContractSpecifies(frame: string, field: string, value: string): string {
  const fields: Record<string, string> = {
    position: "Do the smallest thing that bounds the call.",
    falsifier: "users never cancel within the first token timeout",
    missing_actor: "the human watching the spinner, who can cancel",
  };
  fields[field] = value;
  return [
    "```yaml",
    `problem_hash: ${HASH}`,
    `frame: ${frame}`,
    `position: ${fields.position}`,
    "reasoning: |",
    "  From inside the frame: the human can cancel, so treat them as the control.",
    "forecloses:",
    "  - a fixed 30s timeout for every caller",
    "  - silent retry against the same instance",
    `falsifier: ${fields.falsifier}`,
    `missing_actor: ${fields.missing_actor}`,
    "confidence: medium",
    "```",
  ].join("\n");
}

test("the three values a real run actually wrote abort that run, and the contract is why", () => {
  for (const { frame, field, value, culprit } of OBSERVED) {
    assert.ok(value.includes(culprit), `${frame}: the culprit ${JSON.stringify(culprit)} is not in the value`);
    const text = asContractSpecifies(frame, field, value);
    let thrown: unknown;
    assert.throws(() => validateBranchArtifact(text, HASH, frame), (e: unknown) => ((thrown = e), e instanceof RunAbort));
    const e = thrown as RunAbort;
    assert.equal(e.code, "UNPARSEABLE", `${frame} aborted for the wrong reason: ${e.message}`);
    // The parser's own message travels on the abort (D30), so the reader gets the column.
    assert.match(e.message, /not valid YAML/);
  }
});

test("the same three values parse when the field is a block scalar, which is what makes this the contract's defect", () => {
  // The branches are not at fault and the values are not too long or too strange. Fold the field
  // and every one of them is a valid artifact — so the difference between a run that completes and
  // a run that aborts is one character in prompts/branch.md.
  for (const { frame, field, value } of OBSERVED) {
    const text = asContractSpecifies(frame, field, value).replace(`${field}: ${value}`, `${field}: |\n  ${value}`);
    const r = validateBranchArtifact(text, HASH, frame);
    assert.equal(r.ok, true, r.ok ? "" : `${frame}/${field} still fails: ${r.violations.join("; ")}`);
  }
});

test("every prose field in the contract is folded, and the closed-vocabulary ones are not", () => {
  // The fix for backlog 87. `>-` on a field means its value starts on the next line, where a `: `
  // is ordinary text rather than the start of a nested mapping. `problem_hash`, `frame` and
  // `confidence` stay plain because each is a closed vocabulary that cannot contain prose.
  //
  // `forecloses` items are folded for the same reason even though no recorded item has ever
  // carried an internal `: ` — 104 recorded items and 15 from the seed 3 run, none of them risky.
  // The class is closed here rather than the three instances that happened to fire.
  const contract = readFileSync(join(cfg.root, "prompts", "branch.md"), "utf8");
  assert.match(contract, /^reasoning: \|$/m, "reasoning was always a block scalar");
  for (const f of ["position", "falsifier", "missing_actor"]) {
    assert.match(contract, new RegExp(`^${f}: >-$`, "m"), `${f} is not folded, so a colon in it loses the run`);
  }
  assert.match(contract, /^ {2}- >-$/m, "forecloses items are not folded");
  for (const f of ["problem_hash", "frame", "confidence"]) {
    assert.ok(!new RegExp(`^${f}: >-$`, "m").test(contract), `${f} is a closed vocabulary and needs no folding`);
  }
  // `missing_actor` is the one nullable prose field, so the contract has to say how to write null:
  // a folded scalar cannot be null, and "null" under `>-` is the four-character string.
  assert.match(contract, /`missing_actor: null` on one line/);

  // The brief a branch actually receives carries it, not just the template.
  const brief = renderBranchBrief(cfg, "What timeouts should I set on this HTTP client?", HASH, cfg.frames.frames[0]!);
  assert.match(brief, /^falsifier: >-$/m);
});

test("the fold changes what the contract asks for and not what the validator accepts", () => {
  // This is what makes the fix free. Folding is a change to `prompts/branch.md`; `validate.ts` is
  // untouched, so all 39 recorded artifacts — every one of them written under the plain contract —
  // still parse and still validate. No migration, and no recorded run becomes unreadable, which is
  // the cost that blocked backlog 60 when the same kind of change was tried on the rubric.
  const plain = [
    "```yaml",
    `problem_hash: ${HASH}`,
    "frame: LEDGER",
    "position: Do the smallest thing that bounds the call.",
    "reasoning: |",
    "  From inside the frame: the human can cancel.",
    "forecloses:",
    "  - a fixed 30s timeout for every caller",
    "falsifier: users never cancel within the first token timeout",
    "missing_actor: the human watching the spinner, who can cancel",
    "confidence: medium",
    "```",
  ].join("\n");
  const r = validateBranchArtifact(plain, HASH, "LEDGER");
  assert.equal(r.ok, true, r.ok ? "" : r.violations.join("; "));

  // And the folded form validates to the same value, with the colon that used to be fatal in it.
  const folded = [
    "```yaml",
    `problem_hash: ${HASH}`,
    "frame: LEDGER",
    "position: >-",
    "  Do the smallest thing that bounds the call.",
    "reasoning: |",
    "  From inside the frame: the human can cancel.",
    "forecloses:",
    "  - >-",
    "    a fixed 30s timeout for every caller",
    "falsifier: >-",
    "  Instrument the client for a week. Cheaper still: find one production incident report.",
    "missing_actor: null",
    "confidence: medium",
    "```",
  ].join("\n");
  const f = validateBranchArtifact(folded, HASH, "LEDGER");
  assert.equal(f.ok, true, f.ok ? "" : f.violations.join("; "));
  if (f.ok) {
    assert.equal(f.artifact.position, "Do the smallest thing that bounds the call.", "folding left a trailing newline");
    assert.match(f.artifact.falsifier, /Cheaper still: find one production incident report\.$/);
    assert.equal(f.artifact.missing_actor, null, "the null path broke");
  }
});

test("not one unquoted value in any recorded run contains a colon-space, which is the luck this rests on", () => {
  // The reason the corpus parses, counted, and the count now shows the fix landing. Across 44
  // branch artifacts there are 132 `position` / `falsifier` / `missing_actor` values. **106 are bare
  // plain scalars and not one carries an internal `: `** — that is the coincidence, and it held for
  // eleven runs before breaking on the twelfth, where most of the artifacts broke it at once.
  //
  // **15 are folded, and all 15 are from `001-seed3`**, the first run dispatched under D37. Every
  // prose value in it is a block scalar and none is plain, which is what the contract now asks for.
  // One of them carries `isolation: under this position` inside a `forecloses` item — the exact
  // construct that aborted the run before it.
  //
  // Eleven values are quoted, which is the other way out, and exactly one of those needed to be:
  // `001-seed2/ACTOR_CENSUS`'s falsifier reads "Look at the inbound path for one hour of real
  // traffic: if no caller sends a deadline". So quoting does happen, unprompted and inconsistently,
  // in 9% of values. It is a habit some branches have, not a property the contract secures.
  //
  // A future recording that carries an unquoted colon fails here rather than at someone's
  // critique phase, which is a cheaper place to find out.
  const recorded = join(cfg.root, "evals", "recorded");
  let plain = 0;
  let quoted = 0;
  let folded = 0;
  let files = 0;
  const offenders: string[] = [];
  for (const run of readdirSync(recorded)) {
    const dir = join(recorded, run, "branches");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
      files++;
      for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
        const m = /^(position|falsifier|missing_actor): (.*)$/.exec(line);
        if (!m) continue;
        const v = m[2]!;
        if (v.startsWith("|") || v.startsWith(">")) {
          folded++;
          continue;
        }
        if (v.startsWith('"') || v.startsWith("'")) {
          quoted++;
          continue;
        }
        plain++;
        if (/\S: /.test(v)) offenders.push(`${run}/${file} ${m[1]}`);
      }
    }
  }
  assert.equal(files, 44, "the recorded corpus changed size; re-count before trusting the rest of this test");
  assert.deepEqual({ plain, quoted, folded }, { plain: 106, quoted: 11, folded: 15 });
  // Every folded value comes from the one run dispatched under the folded contract, and that run
  // contributed no plain ones. If a later run adds plain values, D37 stopped reaching the briefs.
  assert.equal(folded, 15, "the folded count moved without this comment moving with it");
  assert.deepEqual(offenders, [], "a recorded artifact now carries the backlog 87 defect unquoted, so the luck has run out");
});

/**
 * Backlog 95, and the same defect one contract over.
 *
 * `prompts/critic-pass-a.md` and `critic-pass-b.md` put their free text inside `{ }` flow mappings,
 * where a folded scalar is not legal, so the fix there is quoting rather than `>-`. `prompts/deepen.md`
 * uses ordinary block context, so its two prose fields fold like the branch contract's.
 *
 * Neither had ever fired, because every critic in the corpus quoted its evidence unprompted — the
 * same luck D37 found in the branch artifacts, and the same reason not to keep relying on it.
 */
test("the critic contracts quote their free text, because a folded scalar cannot sit in a flow mapping", () => {
  const passA = readFileSync(join(cfg.root, "prompts", "critic-pass-a.md"), "utf8");
  const passB = readFileSync(join(cfg.root, "prompts", "critic-pass-b.md"), "utf8");
  assert.match(passA, /evidence: "<one sentence>"/, "pass A's evidence placeholder is unquoted again");
  assert.match(passB, /T1: \{ fired: <bool>, evidence: "<text>" \}/, "pass B's trap evidence is unquoted again");
  assert.match(passB, /action: "<one sentence, what the asker would do>"/);
  assert.match(passB, /strongest_objection: "<paragraph>"/);
  for (const doc of [passA, passB]) assert.match(doc, /ends at the first `: ` in it/, "the contract does not say why");

  // And a flow mapping really does break on a bare colon, which is the premise.
  assert.throws(() => parseYaml("x: { score: 2, evidence: Rules out X: because Y }"));
  assert.deepEqual(parseYaml('x: { score: 2, evidence: "Rules out X: because Y" }'), {
    x: { score: 2, evidence: "Rules out X: because Y" },
  });
});

test("the deepen contract folds its prose fields and keeps the null path on one line", () => {
  const doc = readFileSync(join(cfg.root, "prompts", "deepen.md"), "utf8");
  assert.match(doc, /^response: \|$/m, "response was always a block scalar");
  for (const f of ["revised_position", "revised_falsifier"]) {
    assert.match(doc, new RegExp(`^${f}: >-$`, "m"), `${f} is not folded, so a colon in it loses the artifact`);
  }
  assert.match(doc, /`revised_position: null` on one line/, "the fold has no null path, and a fold cannot be null");

  // The shapes the contract now asks for, through the real validator. A colon in a folded value is
  // ordinary text, and the null path still parses as null rather than the four-character string.
  const folded = [
    "```yaml",
    `problem_hash: ${HASH}`,
    "frame: LEDGER",
    "verdict: defend",
    "response: |",
    "  The objection is right about sequencing: it is wrong about what the position needs.",
    "revised_position: >-",
    "  Set one deadline locally today: propagation is a later upgrade, never a precondition.",
    "revised_falsifier: >-",
    "  Plot completion durations per route. Cheaper still: read the proxy's own timeout.",
    "confidence: medium",
    "```",
  ].join("\n");
  const r = validateDeepen(folded, HASH, "LEDGER");
  assert.match(r.revised_position!, /^Set one deadline locally today: propagation/);
  assert.match(r.revised_falsifier!, /Cheaper still: read the proxy's own timeout\.$/);

  const folded_null = folded
    .replace("revised_position: >-\n  Set one deadline locally today: propagation is a later upgrade, never a precondition.", "revised_position: null")
    .replace("verdict: defend", "verdict: fold");
  const n = validateDeepen(folded_null, HASH, "LEDGER");
  assert.equal(n.revised_position, null, "the null path broke, so a fold cannot report a fold");
});
