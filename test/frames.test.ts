import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { RETIREMENT_FLOOR, axisCoverage, diffRuns, frameHealth, frameStats, labelCollisions, orthogonality } from "../src/frames.js";

/** A recorded run is a directory with score.json and, optionally, deepen/<frame>.yaml. */
function recordRun(
  root: string,
  id: string,
  frames: { frame: string; status: "survivor" | "pruned"; pass_a?: number; fired?: string[]; verdict?: "defend" | "fold" }[],
  clusters: { id: string; members: string[]; survivors: string[]; representative: string | null; singleton?: boolean }[],
  runLevel: { monoculture?: boolean; scatter?: boolean } = {},
) {
  const dir = join(root, id);
  mkdirSync(join(dir, "deepen"), { recursive: true });
  writeFileSync(
    join(dir, "score.json"),
    JSON.stringify({
      n: frames.length,
      frames: frames.map((f) => ({
        frame: f.frame,
        status: f.status,
        cluster: null,
        pass_a: f.pass_a ?? null,
        fired: (f.fired ?? []).map((t) => ({ trap: t, evidence: "because" })),
        violations: [],
        lint_disagreements: [],
        position: "Do it.",
        forecloses: [],
        falsifier: null,
        missing_actor: null,
      })),
      clusters: clusters.map((c) => ({ ...c, action: "act", singleton: c.singleton ?? c.members.length === 1, strongest_objection: null, mean_pass_a: 0.8 })),
      run_level: { monoculture: false, scatter: false, ...runLevel, notes: [] },
      proceed: true,
    }),
  );
  for (const f of frames)
    if (f.verdict)
      writeFileSync(
        join(dir, "deepen", `${f.frame}.yaml`),
        `problem_hash: "sha256:${"a".repeat(64)}"\nframe: ${f.frame}\nverdict: ${f.verdict}\nresponse: |\n  Something.\nrevised_position: ${f.verdict === "fold" ? "null" : '"Do it."'}\nconfidence: medium\n`,
      );
}

test("frame stats count prunes, folds and recommendations across runs, and name the frames never dispatched", () => {
  const root = join(tmp(), "recorded");
  mkdirSync(root, { recursive: true });
  // LEDGER pruned in both runs; DOOR_KEEPER never pruned and holds the recommendation once,
  // then folds the second time so it must not be counted as holding it twice.
  recordRun(
    root,
    "001-a",
    [
      { frame: "DOOR_KEEPER", status: "survivor", pass_a: 0.9, verdict: "defend" },
      { frame: "SUCCESSOR", status: "survivor", pass_a: 0.7 },
      { frame: "LEDGER", status: "pruned", pass_a: 0.5, fired: ["T1"] },
    ],
    [
      { id: "big", members: ["DOOR_KEEPER", "SUCCESSOR"], survivors: ["DOOR_KEEPER", "SUCCESSOR"], representative: "DOOR_KEEPER" },
      { id: "gone", members: ["LEDGER"], survivors: [], representative: null },
    ],
  );
  recordRun(
    root,
    "001-b",
    [
      { frame: "DOOR_KEEPER", status: "survivor", pass_a: 0.8, verdict: "fold" },
      { frame: "SUCCESSOR", status: "survivor", pass_a: 0.6, verdict: "defend" },
      { frame: "LEDGER", status: "pruned", pass_a: 0.4, fired: ["T1", "T7"] },
    ],
    [
      { id: "one", members: ["DOOR_KEEPER"], survivors: ["DOOR_KEEPER"], representative: "DOOR_KEEPER" },
      { id: "two", members: ["SUCCESSOR"], survivors: ["SUCCESSOR"], representative: "SUCCESSOR" },
      { id: "gone", members: ["LEDGER"], survivors: [], representative: null },
    ],
  );

  const r = frameStats(cfg, root);
  assert.equal(r.runs, 2);
  const dk = r.frames.find((f) => f.frame === "DOOR_KEEPER")!;
  assert.deepEqual([dk.runs, dk.pruned, dk.folded, dk.defended], [2, 0, 1, 1]);
  assert.equal(dk.recommended, 1, "a folded representative does not hold the recommendation");
  const hz = r.frames.find((f) => f.frame === "SUCCESSOR")!;
  assert.equal(hz.recommended, 1, "the next live cluster holds it when the first folded");
  const ld = r.frames.find((f) => f.frame === "LEDGER")!;
  assert.deepEqual([ld.runs, ld.pruned, ld.traps.T1, ld.traps.T7], [2, 2, 2, 1]);
  assert.equal(ld.mean_pass_a?.toFixed(2), "0.45");
  assert.equal(r.traps.find((t) => t.trap === "T1")!.fired, 2, "T1 fired once per run on LEDGER");
  assert.equal(r.traps.find((t) => t.trap === "T5")!.fired, 0);
  assert.match(r.text, /pruned in every appearance[^\n]*LEDGER 2\/2/);
  assert.match(r.text, /never pruned[^\n]*DOOR_KEEPER 0\/2/);
  assert.match(r.text, /never dispatched in a recorded run:[^\n]*SABOTEUR/);
  assert.match(r.text, /detectors that have never fired:[^\n]*T5/);
});

test("a run that failed at run level attributes the recommendation to nobody", () => {
  const root = join(tmp(), "recorded");
  mkdirSync(root, { recursive: true });
  recordRun(
    root,
    "900-mono",
    [
      { frame: "DOOR_KEEPER", status: "survivor", pass_a: 0.9, verdict: "defend" },
      { frame: "SUCCESSOR", status: "survivor", pass_a: 0.8, verdict: "defend" },
    ],
    [{ id: "one", members: ["DOOR_KEEPER", "SUCCESSOR"], survivors: ["DOOR_KEEPER", "SUCCESSOR"], representative: "DOOR_KEEPER" }],
    { monoculture: true },
  );
  const r = frameStats(cfg, root);
  assert.equal(r.frames.every((f) => f.recommended === 0), true, "monoculture ships no recommendation, so no frame held one");
  assert.equal(r.frames.find((f) => f.frame === "DOOR_KEEPER")!.defended, 1);
});

test("stats and orthogonality both report zero runs against an empty directory rather than throwing", () => {
  const root = join(tmp(), "empty");
  mkdirSync(root, { recursive: true });
  const s = frameStats(cfg, root);
  assert.equal(s.runs, 0);
  assert.deepEqual(s.frames, []);
  assert.match(s.text, /no scored runs yet/);
  const o = orthogonality(cfg, root);
  assert.equal(o.runs, 0);
  assert.deepEqual(o.flagged, []);
});

test("diff refuses to blame the seed when the frame sets also differ", () => {
  const root = join(tmp(), "recorded");
  mkdirSync(root, { recursive: true });
  const H = "sha256:" + "c".repeat(64);
  const plan = (seed: number) => JSON.stringify({ problem_hash: H, seed });
  const mk = (id: string, seed: number, frames: { frame: string; status: "survivor" | "pruned"; pass_a: number }[], rec: string) => {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.json"), plan(seed));
    writeFileSync(
      join(dir, "score.json"),
      JSON.stringify({
        n: frames.length,
        frames: frames.map((f) => ({ frame: f.frame, status: f.status, cluster: null, pass_a: f.pass_a, fired: [], violations: [], lint_disagreements: [], position: "p", forecloses: [], falsifier: null, missing_actor: null })),
        clusters: [],
        run_level: { monoculture: false, scatter: false, notes: [] },
        proceed: true,
      }),
    );
    writeFileSync(join(dir, "synthesis.md"), `# ADHD synthesis\n\n## Recommendation\n\n**${rec}**\n`);
    return dir;
  };

  // Same frames, different seed: the change is attributable.
  const clean = [
    mk("900-a", 1, [{ frame: "LEDGER", status: "survivor", pass_a: 0.8 }, { frame: "SUCCESSOR", status: "pruned", pass_a: 0.5 }], "Do X."),
    mk("900-b", 2, [{ frame: "LEDGER", status: "survivor", pass_a: 0.8 }, { frame: "SUCCESSOR", status: "survivor", pass_a: 0.7 }], "Do Y."),
  ] as const;
  const ok = diffRuns(cfg, clean[0], clean[1]);
  assert.equal(ok.same_problem, true);
  assert.deepEqual(ok.status_changed, [{ frame: "SUCCESSOR", a: "pruned", b: "survivor" }]);
  assert.match(ok.text, /this change is the seed's doing/);
  assert.match(ok.text, /That is a seed effect/);
  assert.ok(!/CONFOUNDED/.test(ok.text));
  assert.equal(ok.pass_a_moved.find((m) => m.frame === "SUCCESSOR")?.delta.toFixed(2), "0.20");

  // Different frames as well as a different seed: it is not.
  const c = mk("901-c", 3, [{ frame: "LEDGER", status: "survivor", pass_a: 0.8 }, { frame: "MECHANIC", status: "survivor", pass_a: 0.7 }], "Do Z.");
  const confounded = diffRuns(cfg, clean[0], c);
  assert.deepEqual(confounded.only_a, ["SUCCESSOR"]);
  assert.deepEqual(confounded.only_b, ["MECHANIC"]);
  assert.match(confounded.text, /CONFOUNDED/);
  assert.match(confounded.text, /cannot say which caused it/);
});

test("diff says plainly when two runs are not of the same problem", () => {
  const root = join(tmp(), "recorded");
  mkdirSync(root, { recursive: true });
  const mk = (id: string, hash: string) => {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ problem_hash: hash, seed: 1 }));
    writeFileSync(join(dir, "synthesis.md"), "# ADHD synthesis\n\n## Recommendation\n\n**Do it.**\n");
    return dir;
  };
  const r = diffRuns(cfg, mk("902-a", "sha256:" + "1".repeat(64)), mk("902-b", "sha256:" + "2".repeat(64)));
  assert.equal(r.same_problem, false);
  assert.match(r.text, /DIFFERENT problem_hash/);
  assert.match(r.text, /nothing below is a comparison/);
});

/** A recorded run with just a branches/ directory, which is all labelCollisions reads. */
function recordBranches(root: string, id: string, artifacts: Record<string, string>) {
  const dir = join(root, id, "branches");
  mkdirSync(dir, { recursive: true });
  for (const [frame, body] of Object.entries(artifacts)) writeFileSync(join(dir, `${frame}.yaml`), `frame: ${frame}\n${body}\n`);
}

test("a label used only by its own frame is discriminating and not reported", () => {
  const root = tmp();
  recordBranches(root, "001", {
    LEDGER: 'reasoning: "The ledger says someone pays for the retry."',
    MECHANIC: 'reasoning: "Look at what the machine actually does."',
  });
  const r = labelCollisions(cfg, root);
  assert.equal(r.artifacts, 2);
  assert.deepEqual(r.collisions, []);
  assert.match(r.text, /Every label is discriminating/);
});

/**
 * The case that damages a run. A branch writing "the mechanic who has to fix it" is naming a
 * person, not identifying itself, and the redactor removes it anyway.
 *
 * This was written against END_USER, whose label was "End user" and which no artifact ever used
 * to identify itself. That frame is SUPPLICANT now precisely because of what this check found,
 * so the mechanism is demonstrated on a label that is still ordinary English.
 */
test("a label used by a frame that does not own it is reported with the text that matched", () => {
  const root = tmp();
  recordBranches(root, "001", {
    ACTOR_CENSUS: 'missing_actor: "The mechanic who has to fix it at 3am."',
    MECHANIC: 'reasoning: "Trace the request path and find where the time goes."',
  });
  const r = labelCollisions(cfg, root);
  const c = r.collisions.find((x) => x.label === "Mechanic")!;
  assert.equal(c.frame, "MECHANIC");
  assert.equal(c.foreign, 1);
  assert.equal(c.own, 0);
  // The example shows the text as it actually appeared, not the label as configured.
  assert.match(c.examples[0]!, /001\/ACTOR_CENSUS: "mechanic"/);
  assert.match(r.text, /a phrase the redactor removes/);
});

/** Counting it would put every label at own >= 1 and hide the real signal. */
test("the mandatory frame field is not counted as a use", () => {
  const root = tmp();
  recordBranches(root, "001", { LEDGER: 'position: "Do the thing."' });
  const r = labelCollisions(cfg, root);
  assert.deepEqual(r.collisions, []);
  assert.equal(r.artifacts, 1);
});

test("separator spellings count as the same label", () => {
  const root = tmp();
  recordBranches(root, "001", {
    LEDGER: 'reasoning: "The door-keeper pattern and the doorkeeper idea are the same."',
    DOOR_KEEPER: 'position: "Gate it."',
  });
  const c = labelCollisions(cfg, root).collisions.find((x) => x.frame === "DOOR_KEEPER" && x.label === "Door keeper")!;
  assert.equal(c.foreign, 2, "door-keeper and doorkeeper are both the label");
});

/**
 * This asserted the opposite until the rename. END_USER's two labels were written twelve times
 * across artifacts it did not produce and never once by itself, and HORIZON's once; the redactor
 * removed every one. SUPPLICANT and SUCCESSOR appear nowhere in the corpus, which is why they
 * were chosen over the alternatives. A new frame whose name is ordinary prose fails here.
 */
test("no frame label in the shipped library collides with the recorded corpus", () => {
  const r = labelCollisions(cfg);
  assert.ok(r.artifacts >= 39, `only ${r.artifacts} artifacts read`);
  assert.deepEqual(
    r.collisions.filter((c) => c.foreign > 0).map((c) => `${c.frame} "${c.label}"`),
    [],
    "a label found in an artifact its frame did not write identifies nothing and is redacted anyway",
  );
  assert.match(r.text, /Every label is discriminating/);
});

test("no recorded artifacts reports nothing rather than claiming every label is clean", () => {
  const r = labelCollisions(cfg, join(tmp(), "nope"));
  assert.equal(r.artifacts, 0);
  assert.match(r.text, /no recorded artifacts to read/);
});

/**
 * docs/RETIREMENT.md states numbers about the current library. A policy doc whose figures have
 * drifted from the tooling is worse than no policy: someone reads it, believes it, and retires a
 * frame on a stale count. These check the claims that would cause that.
 */
test("the retirement policy's stated standing matches what the tooling reports", () => {
  const doc = readFileSync(join(cfg.root, "docs", "RETIREMENT.md"), "utf8");
  const stats = frameStats(cfg);
  const by = new Map(stats.frames.map((f) => [f.frame, f]));

  // "Nothing meets the bar. Every frame is under the five-run floor except FRAME_BREAKER."
  assert.match(doc, /Nothing meets the bar/);
  const atOrOverFloor = stats.frames.filter((f) => f.runs >= 5).map((f) => f.frame);
  assert.deepEqual(atOrOverFloor, ["FRAME_BREAKER"], "the doc names FRAME_BREAKER as the only frame at the floor");

  // The SUPPLICANT exemption, which is the whole point of the section it sits in.
  const endUser = by.get("SUPPLICANT")!;
  assert.equal(endUser.runs, endUser.pruned, "SUPPLICANT is pruned in every appearance");
  assert.equal(endUser.recommended, 0);
  assert.match(doc, /`SUPPLICANT` is the live example/);
  assert.match(doc, /through the pruned block/);

  // The never-pruned three, named as a D6 worry rather than a retirement criterion.
  const neverPruned = stats.frames.filter((f) => f.runs >= 2 && f.pruned === 0).map((f) => f.frame).sort();
  assert.deepEqual(neverPruned, ["DOOR_KEEPER", "MECHANIC", "SUCCESSOR"]);
  for (const f of neverPruned) assert.match(doc, new RegExp(`\`${f}\``), `${f} is never pruned and the doc does not mention it`);

  // Criterion 4 rests on which traps have never fired, and that set shrank when T3 fired in E1b.
  const neverFired = stats.traps.filter((t) => t.fired === 0).map((t) => t.trap).sort();
  assert.deepEqual(neverFired, ["T5"], "the doc's criterion 4 section is written against exactly these");
  for (const t of neverFired) assert.match(doc, new RegExp(`\`${t}\``), `${t} has never fired and the doc does not name it`);
  // Any frame whose whole attacks list has never fired fully meets criterion 4 and must be named.
  for (const fr of cfg.frames.frames)
    if (fr.attacks.every((a) => neverFired.includes(a)))
      assert.match(doc, new RegExp(`\`${fr.id}\``), `${fr.id} attacks only never-fired traps and the doc does not mention it`);
});

/**
 * MECHANIC was the one frame fully meeting criterion 4, because T3 had never fired. T3 fired in
 * E1b on PRIOR_ART, the first run where any frame reached adhd-branch-search with web tools. The
 * doc has to keep saying that, because "a detector with no evidence may be untriggered rather
 * than useless" is the lesson, and it is only legible while the example is named.
 */
test("the doc records that T3 fired and stops counting it against MECHANIC", () => {
  const stats = frameStats(cfg);
  const t3 = stats.traps.find((t) => t.trap === "T3")!;
  assert.ok(t3.fired > 0, "T3 has fired; if that ever reverts, RETIREMENT.md needs rereading");
  const doc = readFileSync(join(cfg.root, "docs", "RETIREMENT.md"), "utf8");
  assert.match(doc, /T3 fired in E1b/);
  assert.match(doc, /untriggered rather than useless/);
  const mechanic = cfg.frames.frames.find((f) => f.id === "MECHANIC")!;
  assert.deepEqual(mechanic.attacks, ["T3"], "MECHANIC's attacks list is what made it the example");
});

// ---- retirement health and axis coverage --------------------------------------------------

test("frame health counts docs/RETIREMENT.md's five criteria and refuses to conclude", () => {
  const h = frameHealth(cfg);
  assert.equal(h.frames.length, cfg.frames.frames.length, "every frame in the library is assessed, dispatched or not");
  for (const f of h.frames) {
    assert.deepEqual(f.criteria.map((c) => c.id), [1, 2, 3, 4, 5], "all five criteria are evaluated for every frame");
    assert.equal(f.met, f.criteria.filter((c) => c.met).length);
    for (const c of f.criteria) assert.ok(c.detail.length > 0, `criterion ${c.id} on ${f.frame} met=${c.met} with no detail`);
  }
  // The policy's own instruction: nothing fires automatically. No exit code, no verdict.
  assert.match(h.text, /Retirement is the owner's call and nothing here fires automatically/);
});

test("the five-run floor is what stops a coin flip retiring a frame", () => {
  const h = frameHealth(cfg);
  // Every frame meeting two criteria today is under the floor, and none is a candidate for it.
  const twoOrMore = h.frames.filter((f) => f.met >= 2);
  assert.ok(twoOrMore.length > 0, "the corpus has no frame at two criteria, so this asserts nothing");
  for (const f of twoOrMore) {
    if (f.runs >= RETIREMENT_FLOOR || f.criteria[4]!.met) assert.equal(f.candidate, true);
    else assert.equal(f.candidate, false, `${f.frame} is a candidate on ${f.runs} run(s), under the ${RETIREMENT_FLOOR}-run floor`);
  }
  assert.deepEqual(h.candidates, [], "a frame meets the bar and docs/RETIREMENT.md's standing section has not been rewritten");
  assert.match(h.text, new RegExp(`No frame meets the bar: two criteria across at least ${RETIREMENT_FLOOR} dispatched runs`));
});

test("criteria 2 and 3 always carry the pruned-block exemption, because SUPPLICANT is why they exist", () => {
  const h = frameHealth(cfg);
  const supplicant = h.frames.find((f) => f.frame === "SUPPLICANT")!;
  assert.equal(supplicant.criteria[1]!.met, true, "SUPPLICANT is pruned in every appearance");
  assert.equal(supplicant.criteria[2]!.met, true, "SUPPLICANT has never held a recommendation");
  assert.equal(supplicant.needs_pruned_block_read, true);
  // The flag is a property of the criteria met, never of which frame it is.
  for (const f of h.frames) assert.equal(f.needs_pruned_block_read, f.criteria[1]!.met || f.criteria[2]!.met, f.frame);
});

test("every frame the health report puts at two criteria is named in docs/RETIREMENT.md's standing table", () => {
  // The table is what a reader consults before retiring anything. A frame the tooling has put on
  // the list and the table has not is exactly the drift this test exists to catch: it found
  // NIGHT_OPERATOR, which met criteria 2 and 3 and appeared nowhere in the document.
  const doc = readFileSync(join(cfg.root, "docs", "RETIREMENT.md"), "utf8");
  const standing = doc.slice(doc.indexOf("## Current standing"));
  for (const f of frameHealth(cfg).frames.filter((x) => x.met >= 2))
    assert.match(standing, new RegExp(`\`${f.frame}\``), `${f.frame} meets ${f.met} criteria and the standing section does not name it`);
});

test("axis coverage names every axis in the library and marks the ones no run has exercised", () => {
  const a = axisCoverage(cfg);
  const axesInLibrary = new Set(cfg.frames.frames.map((f) => f.axis));
  assert.deepEqual(new Set(a.axes.map((x) => x.axis)), axesInLibrary);
  assert.equal(a.axes.reduce((n, x) => n + x.frames.length, 0), cfg.frames.frames.length, "every frame sits on exactly one axis");
  for (const x of a.axes) assert.ok(x.exercised.every((f) => x.frames.includes(f)));

  // D6 forbids two frames from one axis in a single run, so a one-frame axis is one routing has
  // no alternative on. That is worth naming and is not a defect.
  const thin = a.axes.filter((x) => x.frames.length === 1);
  assert.ok(thin.length > 0, "the library has no thin axis, so the report asserts nothing");
  assert.match(a.text, /A run never carries two frames from one axis \(D6\)/);

  // FIRST_PRINCIPLES has never been dispatched; its axis is shared with MECHANIC, which has.
  const mechanism = a.axes.find((x) => x.axis === "mechanism")!;
  assert.deepEqual(mechanism.frames.sort(), ["FIRST_PRINCIPLES", "MECHANIC"]);
  assert.deepEqual(mechanism.exercised, ["MECHANIC"]);
});
