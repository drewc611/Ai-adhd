#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { runPhase, type Phase } from "./run.js";
import { trapsReport } from "./traps.js";
import { formatEvalReport, runEval } from "./eval.js";
import { listFrames, orthogonality } from "./frames.js";
import { openKernel } from "./os.js";
import { readFileSync } from "node:fs";
import { ConfigError, ContractError, RunAbort } from "./errors.js";

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
      console.log(r.text);
      process.exit(r.exitCode);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("traps <file>")
  .description("run the contract check and code lints over one branch artifact")
  .option("--hash <problem_hash>", "expected problem_hash")
  .action((file, o) => {
    try {
      const r = trapsReport(file, { expectHash: o.hash });
      console.log(r.text);
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
  .option("--json", "machine readable")
  .action((o) => {
    try {
      const cfg = loadConfig(program.opts().root);
      const r = runEval(cfg, { fixturesDir: o.fixtures, recordedDir: o.recorded });
      console.log(o.json ? JSON.stringify(r, null, 2) : formatEvalReport(r));
      process.exit(r.ok ? 0 : 1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("frames")
  .description("list the frame library, or report pairwise co-clustering across recorded runs")
  .option("--orthogonality", "D6 empirical check")
  .option("--recorded <dir>")
  .option("--json")
  .action((o) => {
    try {
      const cfg = loadConfig(program.opts().root);
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
  .option("--os-root <dir>", "kernel root")
  .action((id, o) => {
    try {
      const text = o.file ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8");
      out(kernelFor(o).return_(id, text, o.worker));
    } catch (e) { fail(e); }
  });
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
  .action(() => {
    try {
      const cfg = loadConfig(program.opts().root);
      console.log(`ok: ${cfg.frames.frames.length} frames, ${Object.keys(cfg.routing.classes).length} classes, ${cfg.rubric.dimensions.length} rubric dimensions`);
    } catch (e) {
      fail(e);
    }
  });

program.parse();
