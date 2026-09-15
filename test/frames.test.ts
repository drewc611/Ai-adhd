import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { PASS_A_NOISE_FLOOR, RETIREMENT_FLOOR, axisCoverage, diffRuns, frameDrift, frameHealth, frameReach, frameStats, labelCollisions, orthogonality, forbiddenAudit, forbiddenProbes } from "../src/frames.js";
import { frameHash } from "../src/hash.js";
import { compile, selectFrames } from "../src/compile.js";
import { loadFixtures } from "../src/eval.js";

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
/*
 * This asserted zero collisions and held for 39 artifacts. E10 broke it at 63, and the tool was
 * right: `ledger` and `successor` are ordinary English nouns, and two artifacts in the wide-path
 * runs used them as nouns. The damage is visible in that run's own pass A brief, where SABOTEUR's
 * "logs that were not written to be a ledger" reached the critic as "written to be a [frame]".
 *
 * The fix is a rename, the rename changes `frame_hash`, and that is a D6 decision with the whole
 * recorded corpus downstream of it. `frames --collisions` says so itself and stops. So does this:
 * the known pair is pinned with its evidence, and a *new* collision still fails, which is the
 * property worth keeping. Backlog 100.
 */
const KNOWN_LABEL_COLLISIONS = ["LEDGER", "SUCCESSOR"];

test("no frame label collides with the recorded corpus beyond the two already recorded", () => {
  const r = labelCollisions(cfg);
  assert.ok(r.artifacts >= 63, `only ${r.artifacts} artifacts read`);
  const colliding = [...new Set(r.collisions.filter((c) => c.foreign > 0).map((c) => c.frame))].sort();
  assert.deepEqual(
    colliding,
    KNOWN_LABEL_COLLISIONS,
    "a label found in an artifact its frame did not write identifies nothing and is redacted anyway; a new one is a new problem",
  );
  // And the two that do collide are ordinary nouns rather than a near-miss on a frame id, which is
  // what makes them a naming problem and not a redactor bug.
  for (const c of r.collisions.filter((x) => x.foreign > 0)) assert.match(c.label, /^(LEDGER|Ledger|SUCCESSOR|Successor)$/);
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

  // Every frame at or past the five-run floor has to be named, whichever frames those are. The
  // set was ["FRAME_BREAKER"] for eight runs and grew at nine; hard-coding it made the guard
  // assert the corpus rather than the doc.
  const atOrOverFloor = stats.frames.filter((f) => f.runs >= 5).map((f) => f.frame).sort();
  assert.ok(atOrOverFloor.length > 0, "no frame is at the floor, so this asserts nothing");
  for (const f of atOrOverFloor) assert.match(doc, new RegExp(`\`${f}\``), `${f} is at the five-run floor and the standing section does not name it`);
  assert.match(doc, new RegExp(`as of ${["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"][stats.runs] ?? String(stats.runs)} runs`), "the standing heading names a different run count than the corpus holds");

  // The SUPPLICANT exemption, which is the whole point of the section it sits in.
  const endUser = by.get("SUPPLICANT")!;
  assert.equal(endUser.runs, endUser.pruned, "SUPPLICANT is pruned in every appearance");
  assert.equal(endUser.recommended, 0);
  assert.match(doc, /`SUPPLICANT` is the live example/);
  assert.match(doc, /through the pruned block/);

  // The never-pruned set, named as a D6 worry rather than a retirement criterion. Which frames are
  // in it is the corpus's business and changes as runs land — MECHANIC left it at eleven runs — so
  // the guard is that the doc names whichever they are, not that they are a particular three.
  const neverPruned = stats.frames.filter((f) => f.runs >= 2 && f.pruned === 0).map((f) => f.frame).sort();
  assert.ok(neverPruned.length > 0, "no frame is never-pruned, so this asserts nothing");
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
  /*
   * A candidate is not a failure — retirement is the owner's call and nothing fires automatically.
   * What would be a failure is a candidate the standing section has not argued about, because then
   * the doc says "nothing meets the bar" while the tooling says otherwise. So: every candidate must
   * be named there, and the section must stand it down in writing rather than by omission.
   */
  const doc = readFileSync(join(cfg.root, "docs", "RETIREMENT.md"), "utf8");
  const standing = doc.slice(doc.indexOf("## Current standing"));
  for (const c of h.candidates) {
    assert.match(standing, new RegExp(`\`${c.frame}\``), `${c.frame} meets the bar and the standing section does not name it`);
    assert.match(standing, /[Ww]atch, do not act|not being acted on/, `${c.frame} is a candidate and nothing in the standing section stands it down`);
  }
  if (h.candidates.length === 0) assert.match(h.text, new RegExp(`No frame meets the bar: two criteria across at least ${RETIREMENT_FLOOR} dispatched runs`));
  else assert.doesNotMatch(standing, /^Nothing meets the bar/m, "a frame meets the bar and the standing section still opens by saying none does");
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

  // D35 split these apart. `mechanism` is MECHANIC alone and has been exercised; `derivation` is
  // FIRST_PRINCIPLES alone and has not, because it only became reachable in the same decision and
  // no run has happened since. The pair is what this assertion is for: an axis with a member no run
  // has dispatched is a real gap, and it is now one axis rather than hidden inside a shared one.
  const mechanism = a.axes.find((x) => x.axis === "mechanism")!;
  assert.deepEqual(mechanism.frames, ["MECHANIC"]);
  assert.deepEqual(mechanism.exercised, ["MECHANIC"]);
  const derivation = a.axes.find((x) => x.axis === "derivation")!;
  assert.deepEqual(derivation.frames, ["FIRST_PRINCIPLES"]);
  assert.deepEqual(derivation.exercised, [], "FIRST_PRINCIPLES has run; this record is stale");
});

// ---- frame definition drift (catalogue 53) --------------------------------------------------

test("a frame hash covers what a branch is asked to do, and not what the frame is called", () => {
  // The two mechanisms have to stay separate. `former_ids` says a frame was renamed; the hash
  // says a frame was redefined. If renaming changed the hash, every rename would read as a
  // redefinition and the corpus would report drift for a change that altered no instruction.
  const f = cfg.frames.frames.find((x) => x.id === "PARTICULARIST")!;
  const base = frameHash(f);
  assert.equal(frameHash({ ...f, name: "Something else" } as typeof f), base, "a display-name change is not a redefinition");
  assert.equal(frameHash({ ...f, attacks: [...f.attacks].reverse() } as typeof f), base, "attack order is not meaningful");
  assert.notEqual(frameHash({ ...f, stance: f.stance + " Also do this." } as typeof f), base, "a stance edit changes what the branch is asked to do");
  assert.notEqual(frameHash({ ...f, probes: [...f.probes, "another question"] } as typeof f), base);
  assert.notEqual(frameHash({ ...f, forbidden: f.forbidden.slice(1) } as typeof f), base);
  assert.notEqual(frameHash({ ...f, tools: ["WebSearch"] } as typeof f), base);
});

test("a run recorded before the stamp is unknown, which is not unchanged, and a stamped one is neither", () => {
  // Assuming the corpus matches would invent the fact the report exists to establish. Every run
  // recorded before `frame_hash` was stamped reads `null`, and until `001-seed3` that was all of
  // them — this test asserted it of every row. That run is the first carrying the stamp, so it
  // reads `false`, unchanged, on evidence rather than by assumption. Nothing reads `true`.
  const d = frameDrift(cfg);
  assert.deepEqual(d.changed, []);
  assert.ok(d.unknown.length >= 35, `only ${d.unknown.length} branches read as unknown`);

  const stamped = d.rows.filter((r) => r.changed !== null);
  assert.ok(stamped.length > 0, "no recorded run carries a frame_hash, so the stamp is not being written");
  for (const r of stamped) assert.equal(r.changed, false, `${r.run}/${r.frame} reads as changed`);
  for (const r of d.rows.filter((r) => !stamped.includes(r))) assert.equal(r.changed, null);
  assert.match(d.text, /unknown is not unchanged/);
});

test("a stamped run whose frame has since been edited reports CHANGED", () => {
  // The mechanism, exercised rather than asserted. Without it a stance edit leaves every
  // recorded run still saying the frame's name, so `frames --stats` pools two different frames
  // as one and RETIREMENT.md's bar is counted across both.
  const dir = join(tmp(), "recorded");
  const run = join(dir, "999-stamped");
  mkdirSync(run, { recursive: true });
  const edited = cfg.frames.frames.find((f) => f.id === "LEDGER")!;
  writeFileSync(
    join(run, "plan.json"),
    JSON.stringify({
      branches: [
        { frame: "LEDGER", frame_hash: frameHash({ ...edited, stance: "a different instruction entirely" }) },
        { frame: "PARTICULARIST", frame_hash: frameHash(cfg.frames.frames.find((f) => f.id === "PARTICULARIST")!) },
      ],
    }),
  );
  const d = frameDrift(cfg, dir);
  assert.deepEqual(d.changed.map((r) => r.frame), ["LEDGER"]);
  assert.equal(d.rows.find((r) => r.frame === "PARTICULARIST")!.changed, false);
  assert.match(d.text, /^CHANGED\s+999-stamped\/LEDGER/m);
  assert.match(d.text, /not evidence about the frame that carries the id today/);
});

test("drift forwards a renamed frame rather than reporting it as gone", () => {
  // A run that wrote END_USER is a run about SUPPLICANT. Reporting it as a frame the library no
  // longer has would turn every rename into a false drift finding.
  const dir = join(tmp(), "recorded");
  const run = join(dir, "999-renamed");
  mkdirSync(run, { recursive: true });
  const supplicant = cfg.frames.frames.find((f) => f.id === "SUPPLICANT")!;
  writeFileSync(join(run, "plan.json"), JSON.stringify({ branches: [{ frame: "END_USER", frame_hash: frameHash(supplicant) }] }));
  const d = frameDrift(cfg, dir);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0]!.frame, "SUPPLICANT");
  assert.equal(d.rows[0]!.changed, false, "a rename read as a redefinition");
});

test("a new compile stamps every branch, so the corpus stops being unknown from here", () => {
  const r = compile(cfg, "What timeouts should I set on this HTTP client?", { problem_class: "design_decision" }, { seed: 1 });
  assert.equal(r.kind, "plan");
  if (r.kind !== "plan") return;
  const plan = r.plan;
  assert.ok(plan.branches.length >= 5);
  for (const b of plan.branches) {
    assert.ok(b.frame_hash, `${b.frame} was dispatched without a definition stamp`);
    assert.equal(b.frame_hash, frameHash(cfg.frames.frames.find((f) => f.id === b.frame)!));
  }
});

// ---- backlog 21: the forbidden lists, and how much of them is enforced --------------------------

test("the forbidden audit finds the phrases an entry quotes, however long", () => {
  assert.deepEqual(forbiddenProbes('Any sentence beginning with "in general" or "typically".'), ["in general", "typically"]);
  assert.deepEqual(forbiddenProbes("Answering the literal question."), []);
  // The bound was 40 and silently dropped FRAME_BREAKER's rule at 42 characters, which made the
  // audit undercount what the repository could be testing — the one number it exists to produce.
  const long = 'Ending with "it depends on whether the assumption holds". You have already decided it does not.';
  assert.deepEqual(forbiddenProbes(long), ["it depends on whether the assumption holds"]);
});

test("every frame forbids something, and most of what they forbid nothing checks", () => {
  const r = forbiddenAudit(cfg);
  assert.equal(r.entries.length, 39, "the library's forbidden entries moved; the audit's numbers are stale");
  for (const f of cfg.frames.frames) {
    assert.ok(r.entries.some((e) => e.frame === f.id), `${f.id} forbids nothing, which config/frames.yaml says is not allowed`);
  }
  // The finding, asserted so it cannot quietly become false. 35 of 39 entries are instructions to a
  // model that this repository states and never tests — the shape D13 lost a rule in, and the shape
  // `cut_heldout.py` reached a wrong conclusion in. If this ratio improves, the prose should say so.
  assert.ok(r.checkable <= 6, `${r.checkable} entries are checkable; the report's framing assumes few`);
  assert.ok(r.entries.length - r.checkable >= 30, "most entries should still have no mechanical form");
  assert.match(r.text, /guidance and not rules/);
});

test("a forbidden entry binds its own frame and no other", () => {
  const r = forbiddenAudit(cfg);
  // MECHANIC forbids "conventional" as support and used it twice. That is a real violation in a
  // recorded run, which is the answer backlog 21 asked for and the reason the audit is not decoration.
  const fired = r.entries.filter((e) => e.fired > 0);
  assert.ok(fired.length >= 1, "no checkable entry has ever fired, so this test proves nothing");
  for (const e of fired) for (const ex of e.examples) assert.match(ex, new RegExp(`/${e.frame}:`), `${e.frame}'s entry fired on another frame's artifact`);
});

/**
 * Backlog 19 asked for one fixture per frame, as a unit test for the frame's own stance. Building
 * it turned up the reason one frame cannot have one, so the check came before the fixtures.
 *
 * `--stats` and `--axes` count what recorded runs did, and a frame absent from both is either
 * unlucky or unreachable. These tests pin the distinction, because it decides what to do about it:
 * an unlucky frame needs a fixture; an unreachable one is holding an axis in the library and can
 * never appear in a run anyone starts.
 */
test("frame reach asks the real selector, so it cannot agree with a bug in it", () => {
  const r = frameReach(cfg, 60);
  assert.equal(r.frames.length, cfg.frames.frames.length, "every frame is reported on");
  // Whatever the selector picks, it must obey D6: one frame per axis. A reach report built from a
  // re-implementation could miss that; this one runs selectFrames itself, and this asserts it.
  for (let seed = 1; seed <= 20; seed++) {
    const picked = selectFrames(cfg, { problem_class: "design_decision" }, seed);
    const axes = picked.frames.map((f) => f.axis);
    assert.equal(new Set(axes).size, axes.length, `seed ${seed} dispatched two frames on one axis`);
  }
});

test("a frame in a class's primary list is reachable at that class's default n", () => {
  const r = frameReach(cfg, 200);
  const byFrame = new Map(r.frames.map((f) => [f.frame, f]));
  for (const [pc, cls] of Object.entries(cfg.routing.classes)) {
    if (cls.action !== "run") continue;
    for (const id of cls.frames) {
      // Unless a same-axis frame sits earlier in the same primary list, in which case the axis
      // rule takes it and the frame is unreachable there on purpose.
      const f = cfg.frameById.get(id)!;
      const sameAxisEarlier = cls.frames.slice(0, cls.frames.indexOf(id)).some((o) => cfg.frameById.get(o)?.axis === f.axis);
      if (sameAxisEarlier) continue;
      assert.ok(byFrame.get(id)!.at_default.some((c) => c.startsWith(`${pc}@`)), `${id} is primary for ${pc} and never dispatched there`);
    }
  }
});

/**
 * The finding, pinned. FIRST_PRINCIPLES is an alternate in six classes and primary in none, and
 * its axis is held in a primary list by MECHANIC — a primary is drawn before any alternate, so the
 * axis is taken every time. It appears only at n=9, which needs an explicit n in the decision.
 *
 * This test fails when that changes, which is the point: routing gaining a class where it is
 * primary, or MECHANIC moving off `mechanism`, both make it reachable and both mean this record is
 * stale. It asserts the state, not that the state is right — whether to fix routing or retire the
 * frame is a decision, per docs/RETIREMENT.md and D6.
 */
test("every frame in the library is reachable at some class's default n", () => {
  // This test used to pin the opposite, and that is the point of it. `--reach` was built for
  // backlog 19 and found FIRST_PRINCIPLES dispatchable by no class at its default n: an alternate
  // in six classes and primary in none. D35 gave it a primary slot in `strategy`, so the finding is
  // spent and its inverse is now the thing worth guarding — a frame that becomes unreachable again,
  // by a routing edit or an n that shrinks below a primary list, fails here.
  const r = frameReach(cfg, 400);
  assert.deepEqual(r.unreachable_at_default, []);
  assert.deepEqual(r.proved_unreachable, []);
  assert.match(r.text, /Every frame is reachable at some class's default n/);

  // FIRST_PRINCIPLES specifically, because it is the one this cost a decision.
  const fp = r.frames.find((f) => f.frame === "FIRST_PRINCIPLES")!;
  assert.deepEqual(fp.at_default, ["strategy@6"]);
  assert.deepEqual(fp.blocked_by, [], "nothing blocks it now that its axis is its own");
  assert.equal(cfg.frameById.get("FIRST_PRINCIPLES")!.axis, "derivation");
  const strategy = cfg.routing.classes.strategy!;
  assert.equal(strategy.action, "run");
  if (strategy.action === "run") {
    assert.ok(strategy.frames.includes("FIRST_PRINCIPLES"), "it is a primary in strategy, which is what makes it reachable");
    assert.equal(strategy.n, 6, "the slot was added without displacing a frame, so n moved with it");
  }

  // The axis split alone would not have done it, which is the part item 85 had wrong. Put it back
  // on `mechanism` and it stays reachable, because a primary slot is what reachability rests on.
  const onMechanism = {
    ...cfg,
    frames: { ...cfg.frames, frames: cfg.frames.frames.map((f) => (f.id === "FIRST_PRINCIPLES" ? { ...f, axis: "mechanism" } : f)) },
  };
  assert.deepEqual(frameReach(onMechanism as typeof cfg, 40).unreachable_at_default, [], "the slot, not the axis, is what makes it reachable");
});

/**
 * The claim the previous version of this test made was stronger than a sample, and the machinery
 * that makes that distinction is still worth its own test now that nothing in the shipped library
 * is unreachable. A frame reachable on one seed in ten thousand reads as unreachable at any seed
 * count you can afford, so "did not turn up in 400 shuffles" and "cannot turn up" are different
 * claims that look identical in a report.
 */
test("the proof of unreachability still works, shown on a library where a frame has no primary slot", () => {
  // Take FIRST_PRINCIPLES back out of every primary list and the proof returns, with `strategy`
  // back to five so its n is at or below its primary length again.
  const demoted = {
    ...cfg,
    routing: {
      ...cfg.routing,
      classes: Object.fromEntries(
        Object.entries(cfg.routing.classes).map(([k, c]) => [
          k,
          c.action === "run" && c.frames.includes("FIRST_PRINCIPLES")
            ? { ...c, n: c.frames.length - 1, frames: c.frames.filter((f: string) => f !== "FIRST_PRINCIPLES") }
            : c,
        ]),
      ),
    },
  } as typeof cfg;

  // The two premises the proof rests on, checked rather than asserted.
  for (const [pc, cls] of Object.entries(demoted.routing.classes)) {
    if (cls.action !== "run") continue;
    const n: number = cls.n ?? Math.min(demoted.routing.defaults.max_branches, cls.frames.length);
    assert.ok(n <= cls.frames.length, `${pc} draws ${n} from a primary list of ${cls.frames.length}, so it reaches alternates`);
  }
  assert.deepEqual(frameReach(demoted, 40).proved_unreachable, ["FIRST_PRINCIPLES"]);

  // One seed and forty give the same answer, because the answer does not come from the seeds.
  assert.deepEqual(frameReach(demoted, 1).unreachable_at_default, frameReach(demoted, 40).unreachable_at_default);

  // And the report says which kind of claim it is making, where a reader sees it.
  assert.match(frameReach(demoted, 40).text, /proved, not sampled/);
});

/**
 * The proof rests on two premises, so it has to stop claiming a proof when either fails. A class
 * whose default n reaches past its primary list draws alternates, and then only sampling can say
 * whether any seed picks a given one.
 */
test("reach stops claiming a proof when a class can reach its alternates", () => {
  const widened = {
    ...cfg,
    routing: {
      ...cfg.routing,
      classes: Object.fromEntries(
        Object.entries(cfg.routing.classes).map(([k, c]) =>
          k === "design_decision" && c.action === "run" ? [k, { ...c, n: c.frames.length + 2 }] : [k, c],
        ),
      ),
    },
  } as typeof cfg;
  const r = frameReach(widened, 60);
  assert.deepEqual(r.proved_unreachable, [], "one class reaching its alternates ends the proof for every frame");
  assert.match(r.text, /Otherwise sampled, not proved|sampled, not proved/);
});

test("every fixture names a class routing can actually run, or one it declines on purpose", () => {
  const reach = frameReach(cfg, 60);
  const reachable = new Set(reach.frames.filter((f) => f.at_default.length).map((f) => f.frame));
  for (const fx of loadFixtures(join(cfg.root, "evals", "fixtures"))) {
    const cls = cfg.routing.classes[fx.problem_class];
    assert.ok(cls, `fixture ${fx.id} names class ${fx.problem_class}, which routing does not have`);
    if (cls.action === "decline") {
      assert.ok(fx.expect.decline, `fixture ${fx.id} names a declined class and does not expect a decline`);
      continue;
    }
    // A run fixture's class must be able to dispatch at least one frame, or it can never record.
    assert.ok(cls.frames.some((f) => reachable.has(f)), `fixture ${fx.id}'s class ${fx.problem_class} dispatches no reachable frame`);
  }
});

/*
 * The pass A noise floor is a published number (docs/EXPERIMENTS.md, E1a; backlog 4) and it has
 * exactly one piece of evidence: two runs of fixture 001 at seed 3 with byte-identical briefs and
 * the same dispatch. A constant that drifts away from the pair it was measured on is the failure
 * mode `comparable_heldout` exists to prevent on the analysis side, so it is guarded the same way.
 */
test("PASS_A_NOISE_FLOOR still covers the pair it was measured on", () => {
  const a = join(cfg.root, "evals", "recorded", "001-seed3");
  const b = join(cfg.root, "evals", "recorded", "001-seed3-repeat");
  const d = diffRuns(cfg, a, b);
  assert.equal(d.only_a.length, 0, "the pair must share a frame set or it measures the frame set, not the session");
  assert.equal(d.only_b.length, 0);
  assert.equal(d.a.seed, d.b.seed, "the pair must share a seed or it measures the seed, not the session");
  const biggest = Math.max(...d.pass_a_moved.map((m) => Math.abs(m.delta)), 0);
  assert.ok(biggest > 0, "a floor measured on a pair that did not move is not a measurement");
  assert.ok(
    biggest <= PASS_A_NOISE_FLOOR,
    `the floor is ${PASS_A_NOISE_FLOOR} and its own evidence now moves ${biggest.toFixed(4)}; re-measure or raise it`,
  );
});

/*
 * The finding item 4 exists to record: pass A held and the trap sweep did not. If a later edit to
 * either recording flattens that contrast, the E1a write-up is describing runs that no longer exist.
 */
test("the same-seed pair still shows a stable pass A and an unstable trap sweep", () => {
  const d = diffRuns(cfg, join(cfg.root, "evals", "recorded", "001-seed3"), join(cfg.root, "evals", "recorded", "001-seed3-repeat"));
  const firedA = d.a.frames.flatMap((f) => f.fired);
  const firedB = d.b.frames.flatMap((f) => f.fired);
  assert.deepEqual(firedB, [], "the repeat fired no detector; that is the finding");
  assert.ok(firedA.length >= 2, "001-seed3 fired at least twice; that is the other half of the finding");
  assert.equal(d.b.frames.filter((f) => f.status === "pruned").length, 0);
  assert.equal(d.a.frames.filter((f) => f.status === "pruned").length, 2);
  assert.notEqual(d.a.recommendation, d.b.recommendation, "the recommendation changed hands with the seed held");
});
