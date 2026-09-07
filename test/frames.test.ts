import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cfg, tmp } from "./helpers.js";
import { diffRuns, frameStats, orthogonality } from "../src/frames.js";

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
