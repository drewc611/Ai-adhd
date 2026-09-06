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
import { listFrames, orthogonality } from "./frames.js";

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
  { description: "List the frame library, or with orthogonality=true report pairwise co-clustering across recorded runs (D6).", inputSchema: { orthogonality: z.boolean().optional(), recorded_dir: z.string().optional(), root: z.string().optional() } },
  async (a) =>
    wrap(() => {
      const cfg = loadConfig(a.root);
      return a.orthogonality ? orthogonality(cfg, a.recorded_dir).text : listFrames(cfg);
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
