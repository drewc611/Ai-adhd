#!/usr/bin/env node
import { Command } from "commander";
import { knownFrameIds, loadConfig } from "./config.js";
import { runPhase, type Phase } from "./run.js";
import { trapsReport } from "./traps.js";
import { auditFixtures, formatEvalReport, runEval } from "./eval.js";
import { axisCoverage, diffRuns, frameDrift, frameHealth, frameStats, labelCollisions, listFrames, orthogonality } from "./frames.js";
import { costReport } from "./cost.js";
import { replayAll, replayRun } from "./replay.js";
import { doctor } from "./doctor.js";
import { assertionHistory, lintFixtures, regressionGate } from "./fixtures.js";
import { comparisonMatrix, exportRun, runTree } from "./report.js";
import { completions, initConfig } from "./scaffold.js";
import { configDoc } from "./schemadoc.js";
import { Progress, colourEnabled, statusLine } from "./tty.js";
import { dimensionCorrelation, interRater, interRaterCorpus, raterPanel, weightSensitivity } from "./learn.js";
import { explainFrame } from "./why.js";
import { writeViewer } from "./viewer.js";
import { wizard } from "./tui.js";
import { kernelStats, openKernel, recordRun } from "./os.js";
import { readFileSync } from "node:fs";
import { ConfigError, ContractError, RunAbort, UsageError } from "./errors.js";
import { join } from "node:path";
import { MISSION_CLASSES, Sandbox, missionPreview, openSuper, operator, type MissionClass } from "./super/index.js";

const program = new Command();
program
  .name("adhd")
  .description("Anchoring Defeat by Heterogeneous Divergence. Compiles, validates, scores, evals. Never calls a model.")
  .option("--root <dir>", "repo root holding config/ and prompts/ (default: the package root or $ADHD_ROOT)")
  .showHelpAfterError();

function fail(e: unknown): never {
  if (e instanceof RunAbort) {
    console.error(`ABORT [${e.code}] ${e.message}`);
    process.exit(3);
  }
  if (e instanceof ContractError) {
    console.error(`CONTRACT ${e.message}`);
    process.exit(2);
  }
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(4);
  }
  if (e instanceof UsageError) {
    console.error(`usage: ${e.message}`);
    process.exit(5);
  }
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
}

program
  .command("run")
  .description("drive one phase of a run directory")
  .requiredOption("--phase <phase>", "compile | critique | deepen | synth")
  .option("--run <dir>", "run directory (critique, deepen, synth)")
  .option("--problem <file>", "verbatim problem statement (compile)")
  .option("--decision <json>", "routing decision JSON, enum values only (compile)")
  .option("--runs-dir <dir>", "where compile creates run directories", "runs")
  .option("--seed <n>", "override the shuffle seed (compile)", (v) => Number.parseInt(v, 10))
  .option("--run-id <id>", "override the generated run id (compile)")
  .option("--yes", "compile only: acknowledge the plan preview non-interactively (the CLI never blocks anyway; this records intent)")
  .option("--partial", "synth only: render returned branches unscored (D5 cancel path)")
  .option("--json")
  .action((o) => {
    const phase = o.phase as Phase;
    if (!["compile", "critique", "deepen", "synth"].includes(phase)) fail(new ContractError("run", [`unknown phase ${phase}`]));
    try {
      const cfg = loadConfig(program.opts().root);
      const r = runPhase(cfg, phase, {
        runDir: o.run,
        problemPath: o.problem,
        decision: o.decision,
        runsDir: o.runsDir,
        seed: o.seed,
        runId: o.runId,
        partial: o.partial,
      });
      // `next` is the whole point for a driver: it names the briefs to spawn and where their
      // artifacts go. Printing it as text means parsing prose to find a path.
      console.log(o.json ? JSON.stringify({ phase, exit_code: r.exitCode, run_dir: r.runDir ?? null, next: r.next ?? null, text: r.text }, null, 2) : r.text);
      process.exit(r.exitCode);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("traps <file>")
  .description("run the contract check and code lints over one branch artifact")
  .option("--hash <problem_hash>", "expected problem_hash")
  .option("--json")
  .action((file, o: { hash?: string; json?: boolean }) => {
    try {
      const r = trapsReport(file, { expectHash: o.hash, frames: knownFrameIds(loadConfig(program.opts().root)) });
      // The exit code is the contract a script branches on, so --json carries it too rather
      // than replacing it. A caller that only reads stdout still gets the verdict.
      console.log(o.json ? JSON.stringify({ file, ok: r.exitCode === 0, exit_code: r.exitCode, report: r.text }, null, 2) : r.text);
      process.exit(r.exitCode);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("eval")
  .description("replay recorded runs against fixture assertions")
  .option("--fixtures <dir>")
  .option("--recorded <dir>")
  .option("--audit", "report which assertions discriminate a real run from the negative control")
  .option("--history", "which runs have ever held each assertion")
  .option("--gate", "fail when an assertion that used to hold on a run stops holding on it")
  .option("--update", "with --gate, rewrite evals/assertion-baseline.json to what holds now")
  .option("--json", "machine readable")
  .action((o) => {
    try {
      const cfg = loadConfig(program.opts().root);
      if (o.audit) {
        const a = auditFixtures(cfg, { fixturesDir: o.fixtures, recordedDir: o.recorded });
        console.log(o.json ? JSON.stringify(a.items, null, 2) : a.text);
        return;
      }
      if (o.history) {
        console.log(assertionHistory(cfg, { fixturesDir: o.fixtures, recordedDir: o.recorded }).text);
        return;
      }
      if (o.gate) {
        const g = regressionGate(cfg, { fixturesDir: o.fixtures, recordedDir: o.recorded, update: Boolean(o.update) });
        console.log(g.text);
        process.exit(g.regressions.length ? 1 : 0);
      }
      const r = runEval(cfg, { fixturesDir: o.fixtures, recordedDir: o.recorded });
      console.log(o.json ? JSON.stringify(r, null, 2) : formatEvalReport(r));
      process.exit(r.ok ? 0 : 1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("frames")
  .description("list the frame library, or report how it has behaved across recorded runs")
  .option("--orthogonality", "D6 empirical check: pairwise co-clustering")
  .option("--stats", "per-frame prune, fold and recommendation rates, and detector fire counts")
  .option("--collisions", "which frame labels are also ordinary prose, so the redactor removes real text")
  .option("--health", "docs/RETIREMENT.md's bar, counted: which frames meet criteria for examination")
  .option("--axes", "frames per axis, and which axes no recorded run has exercised")
  .option("--drift", "which recorded runs used a frame whose definition has changed since")
  .option("--recorded <dir>")
  .option("--json")
  .action((o) => {
    try {
      const cfg = loadConfig(program.opts().root);
      if (o.stats) {
        const r = frameStats(cfg, o.recorded);
        console.log(o.json ? JSON.stringify({ runs: r.runs, frames: r.frames, traps: r.traps }, null, 2) : r.text);
        return;
      }
      if (o.health) {
        const r = frameHealth(cfg, o.recorded);
        console.log(o.json ? JSON.stringify({ runs: r.runs, classes: r.classes, frames: r.frames, candidates: r.candidates.map((c) => c.frame) }, null, 2) : r.text);
        return;
      }
      if (o.drift) {
        const r = frameDrift(cfg, o.recorded);
        console.log(o.json ? JSON.stringify({ rows: r.rows, changed: r.changed, unknown: r.unknown.length }, null, 2) : r.text);
        process.exit(r.changed.length ? 1 : 0);
      }
      if (o.axes) {
        const r = axisCoverage(cfg, o.recorded);
        console.log(o.json ? JSON.stringify({ runs: r.runs, axes: r.axes }, null, 2) : r.text);
        return;
      }
      if (o.collisions) {
        const r = labelCollisions(cfg, o.recorded);
        console.log(o.json ? JSON.stringify(r, null, 2) : r.text);
        return;
      }
      if (o.orthogonality) {
        const r = orthogonality(cfg, o.recorded);
        console.log(o.json ? JSON.stringify(r.pairs, null, 2) : r.text);
        process.exit(r.flagged.length ? 1 : 0);
      }
      console.log(listFrames(cfg, Boolean(o.json)));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("diff")
  .description("compare two recorded runs of the same fixture: what survived, what moved, what was the seed")
  .argument("<runA>", "a recorded run directory")
  .argument("<runB>", "another recorded run directory")
  .option("--json")
  .action((runA: string, runB: string, o: { json?: boolean }) => {
    try {
      const r = diffRuns(loadConfig(program.opts().root), runA, runB);
      console.log(o.json ? JSON.stringify(r, null, 2) : r.text);
      // A mismatched problem_hash means the two are not runs of one problem, so the comparison
      // is meaningless rather than merely uninteresting. Say so with an exit code.
      process.exit(r.same_problem ? 0 : 1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("learn")
  .description("what the recorded runs say about the rubric itself. Reads runs; never calls a model")
  .option("--sensitivity", "do small weight changes send different positions to deepen?")
  .option("--correlation", "do two dimensions measure the same thing?")
  .option("--agreement <passA.yaml>", "a second blind pass A over the same pack; needs --run")
  .option("--run <dir>", "the recorded run whose pass A the second scoring is compared against")
  .option("--agreement-all", "pool every run that has a second scoring on disk")
  .option("--panel", "three or more critics on one pack; needs --run. Separates an ambiguous rubric from an odd critic")
  .option("--recorded <dir>")
  .option("--delta <n>", "weight perturbation for --sensitivity", "1")
  .option("--json")
  .action((o: { sensitivity?: boolean; correlation?: boolean; agreement?: string; agreementAll?: boolean; panel?: boolean; run?: string; recorded?: string; delta: string; json?: boolean }) => {
    try {
      const cfg = loadConfig(program.opts().root);
      if (o.agreement && !o.run) throw new UsageError("--agreement needs --run: a second scoring is only meaningful against the run it re-scores");
      if (o.panel) {
        if (!o.run) throw new UsageError("--panel needs --run: a panel scores one artifact pack");
        const r = raterPanel(cfg, o.run);
        console.log(o.json ? JSON.stringify(r, null, 2) : r.text);
        return;
      }
      if (o.agreementAll) {
        const r = interRaterCorpus(cfg, o.recorded);
        console.log(o.json ? JSON.stringify(r, null, 2) : r.text);
        return;
      }
      if (o.agreement) {
        const r = interRater(cfg, o.run!, o.agreement);
        console.log(o.json ? JSON.stringify(r, null, 2) : r.text);
        return;
      }
      const want = { sensitivity: Boolean(o.sensitivity), correlation: Boolean(o.correlation) };
      // Neither flag means both: the two answer one question between them, which is whether the
      // rubric is deciding anything the weights are not.
      if (!want.sensitivity && !want.correlation) {
        want.sensitivity = true;
        want.correlation = true;
      }
      const out: Record<string, unknown> = {};
      const texts: string[] = [];
      if (want.sensitivity) {
        const r = weightSensitivity(cfg, o.recorded, Number(o.delta));
        out.sensitivity = r;
        texts.push(r.text);
      }
      if (want.correlation) {
        const r = dimensionCorrelation(cfg, o.recorded);
        out.correlation = r;
        texts.push(r.text);
      }
      console.log(o.json ? JSON.stringify(out, null, 2) : texts.join("\n\n" + "-".repeat(72) + "\n\n"));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("why")
  .argument("<run>", "a run directory")
  .argument("<frame>", "the frame to explain")
  .description("everything that happened to one frame in one run, from the files the run wrote")
  .option("--json")
  .action((run: string, frame: string, o: { json?: boolean }) => {
    try {
      const r = explainFrame(loadConfig(program.opts().root), run, frame);
      console.log(o.json ? JSON.stringify(r, null, 2) : r.text);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("wizard")
  .description("the commands without the flags: menus over the same verbs, each printing what it ran")
  .action(async () => {
    try {
      await wizard(loadConfig(program.opts().root));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("viewer")
  .description("build one self-contained HTML page over the recorded runs. Reads runs; never calls a model")
  .option("--out <file>", "where to write it", "adhd-runs.html")
  .option("--recorded <dir>")
  .option("--json")
  .action((o: { out: string; recorded?: string; json?: boolean }) => {
    try {
      const r = writeViewer(loadConfig(program.opts().root), o.out, { recordedDir: o.recorded });
      if (o.json) return void console.log(JSON.stringify(r, null, 2));
      console.log(
        `wrote ${r.path} (${(r.bytes / 1024).toFixed(0)} KB): ${r.runs} run(s), ${r.frames} frame(s).`,
        "\nSelf-contained. Open it from disk; there is nothing to serve and nothing to fetch.",
      );
    } catch (e) {
      fail(e);
    }
  });

const os = program.command("os").description("the kernel: submit, confirm, claim, return, status, result, cancel, list, reap. Never calls a model.");
const kernelFor = (o: { osRoot?: string; lease?: number }) => openKernel(loadConfig(program.opts().root), o.osRoot, { leaseSeconds: o.lease });
const out = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

os.command("submit")
  .description("compile a problem into a run; prints the D5 preview; state awaiting_confirm")
  .requiredOption("--problem <file>", "verbatim problem statement")
  .requiredOption("--decision <json>", "enum-only routing decision")
  .option("--os-root <dir>", "kernel root (default $ADHD_OS_ROOT or ./runs)")
  .option("--seed <n>", "shuffle seed", (v) => Number.parseInt(v, 10))
  .option("--by <who>", "who submitted")
  .option("--run-id <id>")
  .option("--confirmed", "skip the gate (scripted use)")
  .option("--budget <tokens>", "halt the run and render partial once reported tokens pass this", (v) => Number.parseInt(v, 10))
  .option("--priority <n>", "higher goes first; ties fall back to submission order", (v) => Number.parseInt(v, 10))
  .action((o) => {
    try {
      const r = kernelFor(o).submit(readFileSync(o.problem, "utf8"), o.decision, { seed: o.seed, by: o.by, confirmed: o.confirmed, runId: o.runId, budgetTokens: o.budget, priority: o.priority });
      out(r.preview);
      out(r.kind === "plan" ? { run_id: r.run_id, state: r.state, estimate_tokens: r.estimate_tokens } : { declined: true, reason: r.reason });
      process.exit(r.kind === "plan" ? 0 : 2);
    } catch (e) {
      fail(e);
    }
  });
os.command("confirm <run_id>").option("--os-root <dir>", "kernel root").action((id, o) => { try { out(kernelFor(o).confirm(id)); } catch (e) { fail(e); } });
os.command("claim")
  .requiredOption("--worker <id>")
  .option("--run <run_id>", "only from this run")
  .option("--os-root <dir>", "kernel root")
  .option("--lease <seconds>", "lease length", (v) => Number.parseInt(v, 10))
  .action((o) => {
    try {
      const t = kernelFor(o).claim(o.worker, { runId: o.run });
      if (!t) { console.log("null"); process.exit(3); }
      out(t);
    } catch (e) { fail(e); }
  });
os.command("return <task_id>")
  .description("return a subagent's final message; reads it from --file or stdin")
  .option("--file <path>")
  .option("--worker <id>")
  .option("--tokens <n>", "tokens the subagent reported using", (v) => Number.parseInt(v, 10))
  .option("--os-root <dir>", "kernel root")
  .action((id, o) => {
    try {
      const text = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8");
      out(kernelFor(o).return_(id, text, o.worker, o.tokens));
    } catch (e) { fail(e); }
  });
os.command("log <run_id>").description("journal lines for one run").option("--os-root <dir>", "kernel root").action((id, o) => { try { for (const e of kernelFor(o).log(id)) console.log(JSON.stringify(e)); } catch (e) { fail(e); } });
os.command("record <run_id>")
  .description("promote a finished run into evals/recorded/<fixture>-<name>/ with generated provenance")
  .requiredOption("--fixture <id>", "fixture id, e.g. 001")
  .requiredOption("--name <name>", "short name, e.g. kernel-run")
  .option("--force", "replace an existing recording")
  .option("--os-root <dir>", "kernel root")
  .action((id, o) => { try { out(recordRun(loadConfig(program.opts().root), kernelFor(o), id, { fixtureId: o.fixture, name: o.name, force: o.force })); } catch (e) { fail(e); } });
os.command("status <run_id>").option("--os-root <dir>", "kernel root").action((id, o) => { try { out(kernelFor(o).status(id)); } catch (e) { fail(e); } });
os.command("result <run_id>").option("--os-root <dir>", "kernel root").action((id, o) => {
  try { const r = kernelFor(o).result(id); out(r.synthesis ?? `no synthesis yet (state ${r.state}${r.reason ? `: ${r.reason}` : ""})`); process.exit(r.synthesis ? 0 : 3); } catch (e) { fail(e); }
});
os.command("cancel <run_id>").option("--reason <text>").option("--os-root <dir>", "kernel root").action((id, o) => { try { out(kernelFor(o).cancel(id, o.reason)); } catch (e) { fail(e); } });
os.command("list")
  .option("--os-root <dir>", "kernel root")
  .option("--json", "the full summaries rather than one line per run")
  .action((o) => {
    try {
      const runs = kernelFor(o).list();
      if (o.json || !runs.length) { out(runs); return; }
      for (const r of runs) console.log(statusLine(r, colourEnabled()));
    } catch (e) { fail(e); }
  });
os.command("watch <run_id>")
  .description("redraw a run's status as it advances; one line per change when piped")
  .option("--os-root <dir>", "kernel root")
  .option("--interval <ms>", "poll interval", (v) => Number.parseInt(v, 10), 1000)
  .option("--max <seconds>", "give up after this long", (v) => Number.parseInt(v, 10), 3600)
  .action(async (id, o) => {
    try {
      const k = kernelFor(o);
      const p = new Progress();
      const deadline = Date.now() + o.max * 1000;
      const terminal = ["done", "done_run_level", "cancelled", "aborted"];
      for (;;) {
        const s = k.status(id);
        p.render(statusLine(s, colourEnabled()));
        if (terminal.includes(s.state)) { p.done(); process.exit(s.state === "aborted" ? 3 : 0); }
        if (Date.now() > deadline) { p.done(); console.error(`still ${s.state} after ${o.max}s`); process.exit(1); }
        await new Promise((r) => setTimeout(r, Math.max(50, o.interval)));
      }
    } catch (e) { fail(e); }
  });
os.command("reap").option("--os-root <dir>", "kernel root").action((o) => { try { out(kernelFor(o).reap()); } catch (e) { fail(e); } });
os.command("gc")
  .description("delete finished run directories older than --days; dry unless --yes")
  .option("--days <n>", "age threshold in days", (v) => Number.parseInt(v, 10), 30)
  .option("--yes", "actually delete. A run directory is the only copy of its artifacts")
  .option("--os-root <dir>", "kernel root")
  .option("--json")
  .action((o) => {
    try {
      const r = kernelFor(o).gc({ days: o.days, apply: Boolean(o.yes) });
      console.log(o.json ? JSON.stringify({ eligible: r.eligible, removed: r.removed, skipped_active: r.skipped_active, applied: r.applied }, null, 2) : r.text);
    } catch (e) { fail(e); }
  });
os.command("compact")
  .description("move journal lines belonging to finished runs into a dated archive beside the journal")
  .option("--keep-lines <n>", "leave the journal alone below this many lines", (v) => Number.parseInt(v, 10), 1000)
  .option("--os-root <dir>", "kernel root")
  .option("--json")
  .action((o) => {
    try {
      const r = kernelFor(o).compactJournal({ keepLines: o.keepLines });
      console.log(o.json ? JSON.stringify({ before: r.before, kept: r.kept, archived: r.archived, archive: r.archive }, null, 2) : r.text);
    } catch (e) { fail(e); }
  });
os.command("drain")
  .description("stop handing out tasks; outstanding leases run to completion")
  .option("--reason <text>")
  .option("--os-root <dir>", "kernel root")
  .action((o) => { try { out(kernelFor(o).drain(o.reason)); } catch (e) { fail(e); } });
os.command("resume").description("accept claims again").option("--os-root <dir>", "kernel root").action((o) => { try { out(kernelFor(o).resume()); } catch (e) { fail(e); } });
os.command("heartbeat <task_id>")
  .description("a worker says it is still alive; pushes its lease out by the phase's lease length")
  .requiredOption("--worker <id>")
  .option("--os-root <dir>", "kernel root")
  .action((id, o) => { try { out(kernelFor(o).heartbeat(id, o.worker)); } catch (e) { fail(e); } });
os.command("stats")
  .description("throughput, phase timing and lease expiry rate across the journal")
  .option("--os-root <dir>", "kernel root")
  .option("--json")
  .action((o) => {
    try {
      const root = o.osRoot ?? process.env.ADHD_OS_ROOT ?? "runs";
      const r = kernelStats(root);
      console.log(o.json ? JSON.stringify({ ...r, text: undefined }, null, 2) : r.text);
    } catch (e) { fail(e); }
  });

program
  .command("schema-doc")
  .description("docs/CONFIG.md, generated from the zod schemas; a test fails when the checked-in copy drifts")
  .option("--json", "the same document wrapped, for a caller that wants it alongside its destination")
  .action((o) => {
    try {
      const markdown = configDoc();
      if (o.json) console.log(JSON.stringify({ path: "docs/CONFIG.md", markdown }, null, 2));
      else process.stdout.write(markdown);
    } catch (e) { fail(e); }
  });

program
  .command("init <dir>")
  .description("scaffold config/ and prompts/ from the shipped ones, to extend rather than start blank")
  .option("--force", "replace files that are already there")
  .option("--json")
  .action((dir, o) => {
    try {
      const r = initConfig(loadConfig(program.opts().root), dir, { force: o.force });
      console.log(o.json ? JSON.stringify({ dest: r.dest, written: r.written, skipped: r.skipped }, null, 2) : r.text);
    } catch (e) { fail(e); }
  });

program
  .command("completions <shell>")
  .description("a bash or zsh completion script, generated from the real command list")
  .option("--json")
  .action((shell, o) => {
    try {
      const verbs = program.commands.map((c) => c.name()).sort();
      const osVerbs = (program.commands.find((c) => c.name() === "os")?.commands ?? []).map((c) => c.name()).sort();
      const script = completions(shell, verbs, osVerbs);
      console.log(o.json ? JSON.stringify({ shell, verbs, os_verbs: osVerbs, script }, null, 2) : script);
    } catch (e) { fail(e); }
  });

program
  .command("matrix")
  .description("every assertion against every run of its fixture, as a grid")
  .option("--fixtures <dir>")
  .option("--recorded <dir>")
  .option("--json")
  .action((o) => {
    try {
      const r = comparisonMatrix(loadConfig(program.opts().root), { fixturesDir: o.fixtures, recordedDir: o.recorded });
      console.log(o.json ? JSON.stringify({ runs: r.runs, items: r.items, cells: r.cells }, null, 2) : r.text);
    } catch (e) { fail(e); }
  });

program
  .command("export <run_dir>")
  .description("one run as a single self-contained Markdown file, on stdout")
  .option("--json", "the same document wrapped, for a caller that wants the path alongside it")
  .action((runDir, o) => {
    try {
      const markdown = exportRun(loadConfig(program.opts().root), runDir);
      console.log(o.json ? JSON.stringify({ run: runDir, markdown }, null, 2) : markdown);
    } catch (e) { fail(e); }
  });

program
  .command("open <run_dir>")
  .description("what a run directory holds, with sizes, and what its absences mean")
  .option("--json")
  .action((runDir, o) => {
    try {
      const r = runTree(runDir);
      console.log(o.json ? JSON.stringify({ entries: r.entries, bytes: r.bytes }, null, 2) : r.text);
    } catch (e) { fail(e); }
  });

program
  .command("lint [fixture]")
  .description("check a fixture's patterns before recording against it: do they compile, can they fail, do they use a bare dot as a separator")
  .option("--fixtures <dir>")
  .option("--json")
  .action((fixture, o) => {
    try {
      const r = lintFixtures(loadConfig(program.opts().root), { fixturesDir: o.fixtures, only: fixture });
      console.log(o.json ? JSON.stringify({ errors: r.errors, warnings: r.warnings, fixtures: r.fixtures }, null, 2) : r.text);
      process.exit(r.errors.length ? 1 : 0);
    } catch (e) { fail(e); }
  });

program
  .command("doctor")
  .description("check that config, prompts, the plugin manifest, the tool grants and the build output agree with each other")
  .option("--json")
  .action((o) => {
    try {
      const r = doctor(loadConfig(program.opts().root));
      console.log(o.json ? JSON.stringify({ errors: r.errors, warnings: r.warnings, checked: r.checked }, null, 2) : r.text);
      process.exit(r.errors.length ? 1 : 0);
    } catch (e) { fail(e); }
  });

program
  .command("replay [run_dir]")
  .description("re-render a run's synthesis from its artifacts and report whether it still matches; no argument replays every recorded run")
  .option("--recorded <dir>")
  .option("--print", "print the re-rendered synthesis instead of the comparison")
  .option("--write", "overwrite synthesis.md with the current rendering (never the default: a recording is evidence)")
  .option("--json")
  .action((runDir, o) => {
    try {
      const cfg = loadConfig(program.opts().root);
      if (runDir) {
        const r = replayRun(cfg, runDir, { write: o.write });
        if (o.print) { console.log(r.rendered); return; }
        console.log(o.json ? JSON.stringify({ ...r, rendered: undefined }, null, 2) : `${r.run}: ${r.error ? `ERROR ${r.error}` : !r.had_recorded ? "no synthesis.md recorded" : r.same ? "same" : `DRIFTED, first differs at line ${r.first_diff_line}`}`);
        process.exit(r.error || (r.had_recorded && !r.same && !r.expected_drift) ? 1 : 0);
      }
      const rep = replayAll(cfg, o.recorded, { write: o.write });
      console.log(o.json ? JSON.stringify({ runs: rep.runs.map((x) => ({ ...x, rendered: undefined })), drifted: rep.drifted.map((x) => x.run), expected: rep.expected.map((x) => x.run), stale_baseline: rep.stale_baseline, failed: rep.failed.map((x) => x.run) }, null, 2) : rep.text);
      process.exit(rep.drifted.length || rep.failed.length || rep.stale_baseline.length ? 1 : 0);
    } catch (e) { fail(e); }
  });

program
  .command("cost")
  .description("token spend across recorded runs, by phase and by frame, against the estimate the D5 gate showed")
  .option("--recorded <dir>")
  .option("--json")
  .action((o) => {
    try {
      const r = costReport(loadConfig(program.opts().root), o.recorded);
      console.log(o.json ? JSON.stringify({ runs: r.runs, total: r.total, total_estimate: r.total_estimate, by_phase: r.by_phase, unbroken: r.unbroken }, null, 2) : r.text);
    } catch (e) { fail(e); }
  });

program
  .command("validate")
  .description("load and validate config/ and prompts/ (the first thing every other command does)")
  .option("--json")
  .action((o: { json?: boolean }) => {
    try {
      const cfg = loadConfig(program.opts().root);
      const summary = {
        ok: true,
        frames: cfg.frames.frames.length,
        classes: Object.keys(cfg.routing.classes).length,
        dimensions: cfg.rubric.dimensions.length,
      };
      if (o.json) return void console.log(JSON.stringify(summary, null, 2));
      console.log(`ok: ${summary.frames} frames, ${summary.classes} classes, ${summary.dimensions} rubric dimensions`);
    } catch (e) {
      fail(e);
    }
  });

const superCmd = program
  .command("super")
  .description("the SuperAgent: missions that take minutes to hours, with sandboxes, memory, a message gateway and stages. Never calls a model.");
const superFor = (o: { superRoot?: string }) => openSuper(o.superRoot ?? process.env["ADHD_SUPER_ROOT"] ?? "./missions");

superCmd
  .command("plan")
  .description("compile a goal into a stage graph; prints the preview; state awaiting_confirm")
  .requiredOption("--goal <file>", "verbatim goal statement")
  .requiredOption("--id <mission_id>")
  .option("--class <cls>", "quick | standard | deep", "standard")
  .option("--super-root <dir>", "mission root (default $ADHD_SUPER_ROOT or ./missions)")
  .option("--writable <paths>", "comma-separated sandbox paths the build stage may write")
  .option("--allow <commands>", "semicolon-separated commands verify may run")
  .option("--budget <tokens>", "ceiling on reported tokens for the whole mission", (v) => Number.parseInt(v, 10))
  .action((o) => {
    try {
      const cls = o.class as MissionClass;
      if (!(MISSION_CLASSES as readonly string[]).includes(cls)) throw new UsageError(`--class must be one of ${MISSION_CLASSES.join(", ")}`);
      const m = superFor(o).submit({
        mission_id: o.id,
        goal: readFileSync(o.goal, "utf8"),
        mission_class: cls,
        budget_tokens: o.budget,
        sandbox: {
          writable: o.writable ? String(o.writable).split(",").map((x: string) => x.trim()).filter(Boolean) : [],
          commands: o.allow ? String(o.allow).split(";").map((x: string) => x.trim()).filter(Boolean) : [],
        },
      });
      out(missionPreview(m));
      out({ mission_id: m.mission_id, state: m.state, stages: m.stages.length, budget_tokens: m.budget_tokens });
    } catch (e) {
      fail(e);
    }
  });

superCmd.command("confirm <mission_id>").option("--super-root <dir>").action((id, o) => { try { out(superFor(o).confirm(id)); } catch (e) { fail(e); } });

superCmd
  .command("claim <mission_id>")
  .description("lease the next unblocked stage and print its brief")
  .requiredOption("--worker <id>")
  .option("--super-root <dir>")
  .option("--brief-only", "print the brief and nothing else")
  .action((id, o) => {
    try {
      const c = superFor(o).claim(id, o.worker);
      if (!c) { out({ claimed: null }); return; }
      if (o.briefOnly) { console.log(c.brief); return; }
      out({ stage: c.id, kind: c.kind, agent: c.agent, tools: c.tools, sandbox: c.sandbox, lease_until: c.lease_until, goal_hash: c.goal_hash });
      console.log("\n---\n");
      console.log(c.brief);
    } catch (e) { fail(e); }
  });

superCmd
  .command("return <mission_id> <stage_id>")
  .description("check the stage artifact against its contract and advance the mission")
  .requiredOption("--worker <id>")
  .requiredOption("--goal-hash <hash>")
  .option("--tokens <n>", "reported tokens", (v) => Number.parseInt(v, 10))
  .option("--note <text>")
  .option("--super-root <dir>")
  .action((id, stage, o) => {
    try { out(superFor(o).return_(id, stage, { worker: o.worker, goal_hash: o.goalHash, tokens: o.tokens, note: o.note })); } catch (e) { fail(e); }
  });

superCmd.command("status <mission_id>").option("--super-root <dir>").action((id, o) => { try { out(superFor(o).status(id)); } catch (e) { fail(e); } });
superCmd.command("list").option("--super-root <dir>").action((o) => { try { out(superFor(o).list().map((m) => ({ mission_id: m.mission_id, state: m.state, class: m.mission_class, spent: m.spent_tokens, budget: m.budget_tokens }))); } catch (e) { fail(e); } });
superCmd.command("cancel <mission_id>").option("--reason <text>").option("--super-root <dir>").action((id, o) => { try { out(superFor(o).cancel(id, o.reason)); } catch (e) { fail(e); } });

superCmd
  .command("memory")
  .description("read the memory store, or audit what the isolation rule withholds from a diverge brief")
  .option("--super-root <dir>")
  .option("--scope <mission_id>")
  .option("--text <substring>")
  .option("--audit", "what a diverge brief would not be shown, and why")
  .action((o) => {
    try {
      const s = superFor(o);
      out(o.audit ? s.memory.audit() : s.memory.query({ scope: o.scope, text: o.text }));
    } catch (e) { fail(e); }
  });

superCmd
  .command("gateway <mission_id>")
  .description("the message thread, and every delivery the isolation rule refused")
  .option("--super-root <dir>")
  .option("--send <body>", "send as the operator")
  .option("--to <stage_id>")
  .action((id, o) => {
    try {
      const s = superFor(o);
      if (o.send) {
        if (!o.to) throw new UsageError("--send needs --to");
        out(s.gateway.send(id, operator(), s.participant(s.read(id), o.to), "redirect", o.send));
        return;
      }
      out({ thread: s.gateway.thread(id), refused: s.gateway.refusals(id) });
    } catch (e) { fail(e); }
  });

superCmd
  .command("sandbox <mission_id>")
  .description("create a sandbox from a source tree, diff it, or promote it back")
  .option("--super-root <dir>")
  .option("--create <source>", "copy this tree into the mission sandbox")
  .option("--diff", "what changed against the source")
  .option("--promote", "copy the changes back, refusing anything outside the writable paths")
  .option("--dry-run", "with --promote, list what would move and move nothing")
  .action((id, o) => {
    try {
      const s = superFor(o);
      const m = s.read(id);
      const box = join(s.root, "missions", id, "sandbox");
      if (o.create) { out(Sandbox.create(box, o.create, m.sandbox).info); return; }
      const sb = new Sandbox(box, m.sandbox);
      if (o.promote) { out(sb.promote({ dryRun: o.dryRun })); return; }
      out(sb.diff());
    } catch (e) { fail(e); }
  });

program.parse();
