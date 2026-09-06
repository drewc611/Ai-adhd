#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { runPhase, type Phase } from "./run.js";
import { trapsReport } from "./traps.js";
import { formatEvalReport, runEval } from "./eval.js";
import { listFrames, orthogonality } from "./frames.js";
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
