#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { runPhase, type Phase } from "./run.js";
import { trapsReport } from "./traps.js";
import { auditFixtures, formatEvalReport, runEval } from "./eval.js";
import { diffRuns, frameStats, labelCollisions, listFrames, orthogonality } from "./frames.js";
import { dimensionCorrelation, interRater, interRaterCorpus, raterPanel, weightSensitivity } from "./learn.js";
import { explainFrame } from "./why.js";
import { writeViewer } from "./viewer.js";
import { wizard } from "./tui.js";
import { openKernel, recordRun } from "./os.js";
import { readFileSync } from "node:fs";
import { ConfigError, ContractError, RunAbort, UsageError } from "./errors.js";

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
      const r = trapsReport(file, { expectHash: o.hash, frames: loadConfig(program.opts().root).frames.frames.map((f) => f.id) });
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
  .option("--json", "machine readable")
  .action((o) => {
    try {
      const cfg = loadConfig(program.opts().root);
      if (o.audit) {
        const a = auditFixtures(cfg, { fixturesDir: o.fixtures, recordedDir: o.recorded });
        console.log(o.json ? JSON.stringify(a.items, null, 2) : a.text);
        return;
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
      const r = diffRuns(runA, runB);
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
  .action((o) => {
    try {
      const r = kernelFor(o).submit(readFileSync(o.problem, "utf8"), o.decision, { seed: o.seed, by: o.by, confirmed: o.confirmed, runId: o.runId });
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
os.command("list").option("--os-root <dir>", "kernel root").action((o) => { try { out(kernelFor(o).list()); } catch (e) { fail(e); } });
os.command("reap").option("--os-root <dir>", "kernel root").action((o) => { try { out(kernelFor(o).reap()); } catch (e) { fail(e); } });

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

program.parse();
