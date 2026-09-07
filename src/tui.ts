// `adhd wizard`: the commands without the flags.
//
// Every verb here already exists. What did not exist was a way to use them without knowing
// that `--decision` takes JSON, that `--phase` has four values, or which of thirteen frames
// routing will pick for a strategy question. That is a lot to hold in mind for a tool you
// reach for a few times a week.
//
// It calls no model, holds no state of its own, and spawns nothing. It picks arguments and
// then either runs an existing function or prints the exact command it would have run, so
// anything learned here transfers straight back to the flags.
//
// No dependency for the menu. A select list is about eighty lines of raw-mode readline, and
// a prompt library is a supply chain for something this small.
import { createInterface } from "node:readline";
import { emitKeypressEvents } from "node:readline";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "./config.js";
import { UsageError } from "./errors.js";
import { compile, previewText } from "./compile.js";
import { explainFrame } from "./why.js";
import { frameStats, labelCollisions, listFrames, orthogonality } from "./frames.js";
import { dimensionCorrelation, interRaterCorpus, weightSensitivity } from "./learn.js";
import { formatEvalReport, runEval } from "./eval.js";
import { writeViewer } from "./viewer.js";

const ESC = "[";
const dim = (s: string) => `${ESC}2m${s}${ESC}0m`;
const bold = (s: string) => `${ESC}1m${s}${ESC}0m`;
const cyan = (s: string) => `${ESC}36m${s}${ESC}0m`;

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

interface Io {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

function requireTty(io: Io): void {
  if (!io.input.isTTY || !io.output.isTTY)
    throw new UsageError("the wizard needs an interactive terminal. Piped or redirected, use the flags directly: `adhd --help`.");
}

/**
 * Arrow keys or j/k to move, enter to choose, q or ctrl-c to leave. The list is redrawn in
 * place rather than reprinted, so a long session does not bury the terminal in menus.
 */
export async function select<T>(io: Io, title: string, choices: Choice<T>[]): Promise<T | null> {
  // async, so the refusal rejects rather than throwing synchronously out of a function that
  // returns a promise. A caller writing `select(...).catch(...)` would otherwise get an
  // uncaught throw, which is the kind of thing that only shows up in someone else's CI.
  requireTty(io);
  if (!choices.length) return null;
  return new Promise((resolve) => {
    let i = 0;
    let drawn = 0;
    const width = Math.max(...choices.map((c) => c.label.length));

    const draw = () => {
      if (drawn) io.output.write(`${ESC}${drawn}A`);
      const lines = [`${bold(title)}  ${dim("↑↓ move · enter choose · q back")}`];
      choices.forEach((c, n) => {
        const mark = n === i ? cyan("❯ ") : "  ";
        const label = n === i ? bold(c.label.padEnd(width)) : c.label.padEnd(width);
        lines.push(`${mark}${label}${c.hint ? "  " + dim(c.hint) : ""}`);
      });
      io.output.write(lines.map((l) => `${ESC}2K${l}`).join("\n") + "\n");
      drawn = lines.length;
    };

    emitKeypressEvents(io.input);
    io.input.setRawMode(true);
    io.input.resume();

    const onKey = (_: string, key: { name?: string; ctrl?: boolean }) => {
      if (!key) return;
      if (key.name === "down" || key.name === "j") { i = (i + 1) % choices.length; draw(); return; }
      if (key.name === "up" || key.name === "k") { i = (i - 1 + choices.length) % choices.length; draw(); return; }
      if (key.name === "return" || key.name === "space") { done(choices[i]!.value); return; }
      if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) { done(null); return; }
    };

    const done = (value: T | null) => {
      io.input.off("keypress", onKey);
      if (io.input.isTTY) io.input.setRawMode(false);
      io.input.pause();
      // Wipe the menu; what the user chose is echoed by the caller, which reads better than a
      // trail of dead menus above every result.
      io.output.write(`${ESC}${drawn}A${ESC}0J`);
      resolve(value);
    };

    io.input.on("keypress", onKey);
    draw();
  });
}

export async function ask(io: Io, question: string, fallback = ""): Promise<string> {
  requireTty(io);
  const rl = createInterface({ input: io.input, output: io.output });
  return new Promise((resolve) => {
    rl.question(`${bold(question)}${fallback ? dim(` [${fallback}]`) : ""} `, (a) => {
      rl.close();
      resolve(a.trim() || fallback);
    });
  });
}

const recordedRuns = (cfg: Config): string[] => {
  const dir = join(cfg.root, "evals", "recorded");
  return existsSync(dir) ? readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()).sort() : [];
};

/** The whole point: the command that would have produced this, so the flags get learned. */
const echo = (io: Io, cmd: string) => io.output.write(`${dim("$")} ${cmd}\n\n`);

async function startRun(cfg: Config, io: Io): Promise<void> {
  const classes = Object.entries(cfg.routing.classes).map(([id, c]) => ({
    value: id,
    label: id,
    hint: c.action === "decline" ? "declined: " + c.reason : `${"n" in c ? c.n : "?"} frames`,
  }));
  const cls = await select(io, "What kind of problem is this?", classes);
  if (!cls) return;

  const problem = await ask(io, "The problem, verbatim (it is hashed exactly as typed):");
  if (!problem) {
    io.output.write(dim("Nothing entered; nothing compiled.\n"));
    return;
  }
  const seed = Number(await ask(io, "Seed", "1")) || 1;

  const result = compile(cfg, problem, { problem_class: cls }, { seed });
  io.output.write("\n" + previewText(result) + "\n\n");

  const file = join(tmpdir(), `adhd-problem-${Date.now()}.txt`);
  writeFileSync(file, problem);
  echo(io, `adhd run --phase compile --problem ${file} --decision '{"problem_class":"${cls}"}' --seed ${seed}`);

  if (result.kind === "declined") {
    io.output.write(dim("Declined, so nothing was compiled and nothing is spent.\n"));
    return;
  }

  // The wizard stops here on purpose. Spawning branches is the host's job, and a wizard that
  // pretended otherwise would be the inference client D2 forbids.
  io.output.write(
    `${bold("Nothing has been spent.")} The wizard cannot spawn branches; that is the host's job.\n` +
      `To run it: use the kernel (${cyan("adhd os submit")}) or the ${cyan("adhd")} skill in Claude Code,\n` +
      `then drive the four phases. ${dim("docs/OS.md has the syscall table.")}\n\n`,
  );
}

async function explore(cfg: Config, io: Io): Promise<void> {
  const runs = recordedRuns(cfg);
  if (!runs.length) {
    io.output.write(dim("No recorded runs under evals/recorded.\n"));
    return;
  }
  const run = await select(io, "Which run?", runs.map((r) => ({ value: r, label: r })));
  if (!run) return;
  const dir = join(cfg.root, "evals", "recorded", run);

  for (;;) {
    const frames = cfg.frames.frames
      .map((f) => ({ f, r: explainFrame(cfg, dir, f.id) }))
      .filter((x) => x.r.dispatched)
      .map(({ f, r }) => ({
        value: f.id,
        label: f.id,
        hint: r.fired.length ? `pruned: ${r.fired.map((t) => t.trap).join(" ")}` : r.standing.representative ? "survivor, represented its cluster" : "survivor",
      }));
    const frame = await select(io, `${run} — which frame?`, frames);
    if (!frame) return;
    io.output.write("\n" + explainFrame(cfg, dir, frame).text + "\n\n");
    echo(io, `adhd why evals/recorded/${run} ${frame}`);
  }
}

async function evidence(cfg: Config, io: Io): Promise<void> {
  const pick = await select(io, "What do you want to know?", [
    { value: "frames", label: "The frame library", hint: "13 frames, one axis each" },
    { value: "stats", label: "How each frame has behaved", hint: "prune, fold and recommendation rates" },
    { value: "ortho", label: "Which frames are duplicates in practice", hint: "D6 pairwise co-clustering" },
    { value: "collisions", label: "Which frame names are also ordinary prose", hint: "what redaction removes by accident" },
    { value: "sensitivity", label: "Do the rubric weights change anything", hint: "and how wide each decision was" },
    { value: "correlation", label: "Do two dimensions measure the same thing", hint: "plus what sits at the ceiling" },
    { value: "agreement", label: "Do two critics ship the same answer", hint: "pooled across the corpus" },
    { value: "eval", label: "Replay every recorded run against its fixture", hint: "" },
  ]);
  if (!pick) return;

  const out = (text: string, cmd: string) => {
    io.output.write("\n" + text + "\n\n");
    echo(io, cmd);
  };
  if (pick === "frames") out(listFrames(cfg), "adhd frames");
  else if (pick === "stats") out(frameStats(cfg).text, "adhd frames --stats");
  else if (pick === "ortho") out(orthogonality(cfg).text, "adhd frames --orthogonality");
  else if (pick === "collisions") out(labelCollisions(cfg).text, "adhd frames --collisions");
  else if (pick === "sensitivity") out(weightSensitivity(cfg).text, "adhd learn --sensitivity");
  else if (pick === "correlation") out(dimensionCorrelation(cfg).text, "adhd learn --correlation");
  else if (pick === "agreement") out(interRaterCorpus(cfg).text, "adhd learn --agreement-all");
  else if (pick === "eval") out(formatEvalReport(runEval(cfg)), "adhd eval");
}

async function buildPage(cfg: Config, io: Io): Promise<void> {
  const out = await ask(io, "Write the page to", "adhd-runs.html");
  const r = writeViewer(cfg, out);
  io.output.write(`\nWrote ${bold(r.path)} (${(r.bytes / 1024).toFixed(0)} KB): ${r.runs} run(s), ${r.frames} frame(s).\n`);
  io.output.write(dim("Self-contained. Open it from disk; there is nothing to serve.\n\n"));
  echo(io, `adhd viewer --out ${out}`);
}

export async function wizard(cfg: Config, io: Io = { input: process.stdin, output: process.stdout }): Promise<void> {
  requireTty(io);
  io.output.write(`\n${bold("ADHD")} ${dim("· every screen prints the command it ran, so the flags get learned")}\n\n`);
  for (;;) {
    const pick = await select(io, "What do you want to do?", [
      { value: "explore", label: "Read a recorded run", hint: `${recordedRuns(cfg).length} on disk` },
      { value: "viewer", label: "Build the run explorer page", hint: "one self-contained HTML file" },
      { value: "evidence", label: "Ask what the corpus says", hint: "frames, rubric, critic agreement" },
      { value: "run", label: "Start a run", hint: "compile and preview, spends nothing" },
      { value: "quit", label: "Quit", hint: "" },
    ]);
    if (!pick || pick === "quit") {
      io.output.write(dim("\nBye.\n"));
      return;
    }
    if (pick === "explore") await explore(cfg, io);
    else if (pick === "viewer") await buildPage(cfg, io);
    else if (pick === "evidence") await evidence(cfg, io);
    else if (pick === "run") await startRun(cfg, io);
  }
}
