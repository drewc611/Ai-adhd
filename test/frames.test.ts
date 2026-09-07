import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { diffRuns, frameStats, labelCollisions, orthogonality } from "../src/frames.js";

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
      { frame: "HORIZON", status: "survivor", pass_a: 0.7 },
      { frame: "LEDGER", status: "pruned", pass_a: 0.5, fired: ["T1"] },
    ],
    [
      { id: "big", members: ["DOOR_KEEPER", "HORIZON"], survivors: ["DOOR_KEEPER", "HORIZON"], representative: "DOOR_KEEPER" },
      { id: "gone", members: ["LEDGER"], survivors: [], representative: null },
    ],
  );
  recordRun(
    root,
    "001-b",
    [
      { frame: "DOOR_KEEPER", status: "survivor", pass_a: 0.8, verdict: "fold" },
      { frame: "HORIZON", status: "survivor", pass_a: 0.6, verdict: "defend" },
      { frame: "LEDGER", status: "pruned", pass_a: 0.4, fired: ["T1", "T7"] },
    ],
    [
      { id: "one", members: ["DOOR_KEEPER"], survivors: ["DOOR_KEEPER"], representative: "DOOR_KEEPER" },
      { id: "two", members: ["HORIZON"], survivors: ["HORIZON"], representative: "HORIZON" },
      { id: "gone", members: ["LEDGER"], survivors: [], representative: null },
    ],
  );

  const r = frameStats(cfg, root);
  assert.equal(r.runs, 2);
  const dk = r.frames.find((f) => f.frame === "DOOR_KEEPER")!;
  assert.deepEqual([dk.runs, dk.pruned, dk.folded, dk.defended], [2, 0, 1, 1]);
  assert.equal(dk.recommended, 1, "a folded representative does not hold the recommendation");
  const hz = r.frames.find((f) => f.frame === "HORIZON")!;
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
      { frame: "HORIZON", status: "survivor", pass_a: 0.8, verdict: "defend" },
    ],
    [{ id: "one", members: ["DOOR_KEEPER", "HORIZON"], survivors: ["DOOR_KEEPER", "HORIZON"], representative: "DOOR_KEEPER" }],
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
    mk("900-a", 1, [{ frame: "LEDGER", status: "survivor", pass_a: 0.8 }, { frame: "HORIZON", status: "pruned", pass_a: 0.5 }], "Do X."),
    mk("900-b", 2, [{ frame: "LEDGER", status: "survivor", pass_a: 0.8 }, { frame: "HORIZON", status: "survivor", pass_a: 0.7 }], "Do Y."),
  ] as const;
  const ok = diffRuns(clean[0], clean[1]);
  assert.equal(ok.same_problem, true);
  assert.deepEqual(ok.status_changed, [{ frame: "HORIZON", a: "pruned", b: "survivor" }]);
  assert.match(ok.text, /this change is the seed's doing/);
  assert.match(ok.text, /That is a seed effect/);
  assert.ok(!/CONFOUNDED/.test(ok.text));
  assert.equal(ok.pass_a_moved.find((m) => m.frame === "HORIZON")?.delta.toFixed(2), "0.20");

  // Different frames as well as a different seed: it is not.
  const c = mk("901-c", 3, [{ frame: "LEDGER", status: "survivor", pass_a: 0.8 }, { frame: "MECHANIC", status: "survivor", pass_a: 0.7 }], "Do Z.");
  const confounded = diffRuns(clean[0], c);
  assert.deepEqual(confounded.only_a, ["HORIZON"]);
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
  const r = diffRuns(mk("902-a", "sha256:" + "1".repeat(64)), mk("902-b", "sha256:" + "2".repeat(64)));
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
 * The case that damages a run. ACTOR_CENSUS writing "the end user behind that caller" is naming
 * an actor, not identifying itself, and the redactor removes it anyway.
 */
test("a label used by a frame that does not own it is reported with the text that matched", () => {
  const root = tmp();
  recordBranches(root, "001", {
    ACTOR_CENSUS: 'missing_actor: "The end user behind that caller, who can cancel."',
    END_USER: 'reasoning: "Whoever is waiting should get an answer or a clean failure."',
  });
  const r = labelCollisions(cfg, root);
  const c = r.collisions.find((x) => x.label === "End user")!;
  assert.equal(c.frame, "END_USER");
  assert.equal(c.foreign, 1);
  assert.equal(c.own, 0);
  // The example shows the text as it actually appeared, not the label as configured.
  assert.match(c.examples[0]!, /001\/ACTOR_CENSUS: "end user"/);
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

test("the recorded corpus reports END_USER as the worst collision", () => {
  const r = labelCollisions(cfg);
  assert.ok(r.artifacts >= 25, `only ${r.artifacts} artifacts read`);
  const worst = r.collisions[0]!;
  assert.equal(worst.frame, "END_USER");
  assert.ok(worst.foreign > worst.own, "the label is used more by frames that are not it");
  assert.equal(worst.own, 0, "END_USER has never written its own label");
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

  // The END_USER exemption, which is the whole point of the section it sits in.
  const endUser = by.get("END_USER")!;
  assert.equal(endUser.runs, endUser.pruned, "END_USER is pruned in every appearance");
  assert.equal(endUser.recommended, 0);
  assert.match(doc, /`END_USER` is the live example/);
  assert.match(doc, /through the pruned block/);

  // The never-pruned three, named as a D6 worry rather than a retirement criterion.
  const neverPruned = stats.frames.filter((f) => f.runs >= 2 && f.pruned === 0).map((f) => f.frame).sort();
  assert.deepEqual(neverPruned, ["DOOR_KEEPER", "HORIZON", "MECHANIC"]);
  for (const f of neverPruned) assert.match(doc, new RegExp(`\`${f}\``), `${f} is never pruned and the doc does not mention it`);

  // Criterion 4 rests on which traps have never fired.
  const neverFired = stats.traps.filter((t) => t.fired === 0).map((t) => t.trap).sort();
  assert.deepEqual(neverFired, ["T3", "T5"], "the doc's criterion 4 table is written against exactly these");
  for (const fr of cfg.frames.frames) {
    if (fr.attacks.every((a) => neverFired.includes(a))) assert.match(doc, new RegExp(`\`${fr.id}\`[^\n]*only`), `${fr.id} attacks only never-fired traps and the doc does not say so`);
  }
});

test("the frame the doc singles out under criterion 4 still attacks only a trap that never fires", () => {
  const stats = frameStats(cfg);
  const neverFired = new Set(stats.traps.filter((t) => t.fired === 0).map((t) => t.trap));
  const mechanic = cfg.frames.frames.find((f) => f.id === "MECHANIC")!;
  assert.deepEqual(mechanic.attacks, ["T3"]);
  assert.ok(neverFired.has("T3"), "if T3 has fired, MECHANIC's entry in RETIREMENT.md is stale");
});
