#!/usr/bin/env node
// The same four commands as stdio MCP tools. The server never calls a model; the MCP host
// supplies inference by spawning subagents against the briefs these tools write.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { runPhase } from "./run.js";
import { trapsReport } from "./traps.js";
import { formatEvalReport, runEval } from "./eval.js";
import { frameStats, listFrames, orthogonality } from "./frames.js";
import { openKernel, recordRun } from "./os.js";

const server = new McpServer({ name: "adhd", version: "0.0.1" });
const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: s }], isError });
const wrap = async (fn: () => string) => {
  try {
    return text(fn());
  } catch (e) {
    return text(e instanceof Error ? `${e.name}: ${e.message}` : String(e), true);
  }
};

server.registerTool(
  "adhd_run",
  {
    description:
      "Drive one phase of an ADHD run directory: compile (problem_path + decision), critique, deepen, synth. Returns the preview or the next briefs to spawn. Never calls a model.",
    inputSchema: {
      phase: z.enum(["compile", "critique", "deepen", "synth"]),
      run_dir: z.string().optional(),
      problem_path: z.string().optional(),
      decision: z.record(z.string(), z.unknown()).optional().describe("enum-only routing decision, see config/routing.yaml"),
      runs_dir: z.string().optional(),
      seed: z.number().int().optional(),
      partial: z.boolean().optional(),
      root: z.string().optional(),
    },
  },
  async (a) =>
    wrap(() => {
      const cfg = loadConfig(a.root);
      const r = runPhase(cfg, a.phase, { runDir: a.run_dir, problemPath: a.problem_path, decision: a.decision, runsDir: a.runs_dir, seed: a.seed, partial: a.partial });
      return r.next ? `${r.text}\n\nnext:\n${JSON.stringify(r.next, null, 2)}` : r.text;
    }),
);

server.registerTool(
  "adhd_traps",
  { description: "Contract check and code lints over one branch artifact file.", inputSchema: { file: z.string(), expect_hash: z.string().optional() } },
  async (a) => wrap(() => trapsReport(a.file, { expectHash: a.expect_hash }).text),
);

server.registerTool(
  "adhd_eval",
  { description: "Replay recorded runs against fixture assertions.", inputSchema: { fixtures_dir: z.string().optional(), recorded_dir: z.string().optional(), root: z.string().optional() } },
  async (a) => wrap(() => formatEvalReport(runEval(loadConfig(a.root), { fixturesDir: a.fixtures_dir, recordedDir: a.recorded_dir }))),
);

server.registerTool(
  "adhd_frames",
  { description: "List the frame library; with orthogonality=true report pairwise co-clustering across recorded runs, or with stats=true report per-frame prune, fold and recommendation rates and detector fire counts (D6).", inputSchema: { orthogonality: z.boolean().optional(), stats: z.boolean().optional(), recorded_dir: z.string().optional(), root: z.string().optional() } },
  async (a) =>
    wrap(() => {
      const cfg = loadConfig(a.root);
      if (a.stats) return frameStats(cfg, a.recorded_dir).text;
      return a.orthogonality ? orthogonality(cfg, a.recorded_dir).text : listFrames(cfg);
    }),
);

// ---- the kernel: ADHD as an agent operating system (docs/OS.md) -------------------------------
const kernel = (root?: string) => openKernel(loadConfig(), root);
const json = (v: unknown) => JSON.stringify(v, null, 2);

server.registerTool(
  "adhd_submit",
  {
    description: "Submit a problem to the ADHD kernel. Compiles briefs and returns the D5 preview (verbatim problem, hash, frames, token estimate) and a run_id in state awaiting_confirm. Nothing is spent until adhd_confirm. Pass confirmed=true to skip the gate for scripted use.",
    inputSchema: {
      problem: z.string().min(1).describe("the problem statement, verbatim; it is hashed as given"),
      decision: z.record(z.string(), z.unknown()).describe("enum-only routing decision, e.g. {problem_class: 'design_decision'}"),
      by: z.string().optional(),
      seed: z.number().int().optional(),
      confirmed: z.boolean().optional(),
      root: z.string().optional(),
    },
  },
  async (a) => wrap(() => { const r = kernel(a.root).submit(a.problem, a.decision, { by: a.by, seed: a.seed, confirmed: a.confirmed }); return `${r.preview}\n\n${json(r.kind === "plan" ? { run_id: r.run_id, state: r.state, estimate_tokens: r.estimate_tokens } : { declined: true, reason: r.reason })}`; }),
);
server.registerTool(
  "adhd_confirm",
  { description: "Confirm a submitted run. The user has seen the preview and agreed to the spend. Branch tasks become claimable.", inputSchema: { run_id: z.string(), root: z.string().optional() } },
  async (a) => wrap(() => json(kernel(a.root).confirm(a.run_id))),
);
server.registerTool(
  "adhd_claim",
  {
    description: "Claim the oldest pending task under a lease. Returns the brief inline, the agent type to spawn (adhd-branch, adhd-branch-search, adhd-critic, adhd-deepen), and `continues` when the task must go to an existing subagent (pass B to the pass A critic). Returns null when nothing is claimable. Spawn the agent with the brief as its ENTIRE prompt; add nothing.",
    inputSchema: { worker: z.string().min(1), run_id: z.string().optional(), root: z.string().optional() },
  },
  async (a) => wrap(() => json(kernel(a.root).claim(a.worker, { runId: a.run_id }))),
);
server.registerTool(
  "adhd_return",
  {
    description: "Return a subagent's final message for a claimed task, unedited. The kernel validates it (hash echo, contract), writes the artifact, and advances the run when the phase is complete.",
    inputSchema: { task_id: z.string(), output: z.string(), worker: z.string().optional(), tokens: z.number().int().optional().describe("tokens the subagent reported using; summed into cost.json"), root: z.string().optional() },
  },
  async (a) => wrap(() => json(kernel(a.root).return_(a.task_id, a.output, a.worker, a.tokens))),
);
server.registerTool(
  "adhd_log",
  { description: "Journal lines for one run: submitted, confirmed, claimed, returned, lease_expired, advanced, done, cancelled, aborted.", inputSchema: { run_id: z.string(), root: z.string().optional() } },
  async (a) => wrap(() => json(kernel(a.root).log(a.run_id))),
);
server.registerTool(
  "adhd_record",
  { description: "Promote a finished run into evals/recorded/<fixture>-<name>/ with a README generated from the journal and an expected.json recording the eval outcome as observed.", inputSchema: { run_id: z.string(), fixture_id: z.string(), name: z.string(), force: z.boolean().optional(), root: z.string().optional() } },
  async (a) => wrap(() => json(recordRun(loadConfig(), kernel(a.root), a.run_id, { fixtureId: a.fixture_id, name: a.name, force: a.force }))),
);
server.registerTool(
  "adhd_status",
  { description: "State, task counts, last phase text, and abort reason for a run.", inputSchema: { run_id: z.string(), root: z.string().optional() } },
  async (a) => wrap(() => json(kernel(a.root).status(a.run_id))),
);
server.registerTool(
  "adhd_result",
  { description: "The rendered synthesis for a run, when there is one. Includes the pruned block always.", inputSchema: { run_id: z.string(), root: z.string().optional() } },
  async (a) => wrap(() => { const r = kernel(a.root).result(a.run_id); return r.synthesis ?? `no synthesis yet (state ${r.state}${r.reason ? `: ${r.reason}` : ""})`; }),
);
server.registerTool(
  "adhd_cancel",
  { description: "Cancel a run (D5). Pending and leased tasks are dropped; branches that already returned are rendered unscored with the label UNSCORED, divergence only.", inputSchema: { run_id: z.string(), reason: z.string().optional(), root: z.string().optional() } },
  async (a) => wrap(() => json(kernel(a.root).cancel(a.run_id, a.reason))),
);
server.registerTool(
  "adhd_list",
  { description: "Every run under the kernel root with its state and task counts.", inputSchema: { root: z.string().optional() } },
  async (a) => wrap(() => json(kernel(a.root).list())),
);

const transport = new StdioServerTransport();
await server.connect(transport);
