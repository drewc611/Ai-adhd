/**
 * `adhd serve`: a local HTTP UI over the kernel and the mission scheduler. Nothing here calls a
 * model — it is a thin JSON API wrapping `openKernel`/`openSuper`, the same two functions
 * `src/mcp.ts` already wraps as stdio tools, plus one static page.
 *
 * Starting this is not starting a product. Nothing is claimable without a worker: a Claude Code
 * session running `/superagent` (for the `triage` mission this UI submits) and one running
 * `/adhd-worker` (for a decision run this UI's user confirms) both have to be pointed at the same
 * `--os-root`/`--super-root`, or every mission and run here sits at `pending` forever. See D46.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { openKernel } from "./os.js";
import { openSuper } from "./super/index.js";
import { checkTriageArtifact } from "./triage.js";

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return void resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error(`body is not JSON: ${(e as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}

/** Every claim event ever journalled for one mission, read straight off disk: no new library API for one boolean. */
function missionEverClaimed(superRoot: string, missionId: string): boolean {
  const p = join(superRoot, "missions", missionId, "journal.jsonl");
  if (!existsSync(p)) return false;
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .some((line) => {
      try {
        return (JSON.parse(line) as { event?: string }).event === "claimed";
      } catch {
        return false;
      }
    });
}

let dumpMissionSeq = 0;
function newMissionId(): string {
  dumpMissionSeq += 1;
  return `dump-${Date.now()}-${dumpMissionSeq}`;
}

export interface ServeOptions {
  osRoot: string;
  superRoot: string;
}

export function createDumpServer(cfg: Config, opts: ServeOptions) {
  const kernel = openKernel(cfg, opts.osRoot);
  const superAgent = openSuper(cfg, opts.superRoot);
  const pageHtml = readFileSync(join(cfg.root, "assets", "dump.html"), "utf8");

  return createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(pageHtml);
      return;
    }

    if (method === "POST" && path === "/api/dump") {
      const body = (await readBody(req)) as { text?: unknown };
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return void json(res, 400, { error: "text is empty" });
      const missionId = newMissionId();
      // Auto-confirmed here, and only here: one subagent, budget-capped by CLASS_POLICY.triage,
      // triggered by the user's own submit click. D46 records why this is the one place D5's
      // preview-then-confirm is collapsed to a single step, and why nowhere else is.
      superAgent.submit({ mission_id: missionId, goal: text, mission_class: "triage" });
      superAgent.confirm(missionId);
      return void json(res, 200, { mission_id: missionId });
    }

    let m = path.match(/^\/api\/dump\/([^/]+)$/);
    if (method === "GET" && m) {
      const id = m[1]!;
      const s = superAgent.status(id);
      const stage = s.mission.stages[0]!;
      if (stage.status !== "done") return void json(res, 200, { state: s.mission.state, stage: stage.status, items: null });
      const artifactPath = join(opts.superRoot, "missions", id, stage.contract.artifact);
      const text = existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : "";
      const { result } = checkTriageArtifact(cfg, text);
      return void json(res, 200, { state: s.mission.state, stage: stage.status, items: result?.items ?? null });
    }

    if (method === "POST" && path === "/api/decide") {
      const body = (await readBody(req)) as { problem?: unknown; problem_class?: unknown };
      const problem = typeof body.problem === "string" ? body.problem : "";
      const problemClass = typeof body.problem_class === "string" ? body.problem_class : "";
      if (!problem.trim() || !problemClass) return void json(res, 400, { error: "problem and problem_class are required" });
      const r = kernel.submit(problem, { problem_class: problemClass });
      if (r.kind === "declined") return void json(res, 200, { declined: true, reason: r.reason, preview: r.preview });
      return void json(res, 200, { run_id: r.run_id, state: r.state, estimate_tokens: r.estimate_tokens, preview: r.preview });
    }

    m = path.match(/^\/api\/decide\/([^/]+)\/confirm$/);
    if (method === "POST" && m) {
      kernel.confirm(m[1]!);
      return void json(res, 200, { confirmed: true });
    }

    m = path.match(/^\/api\/decide\/([^/]+)$/);
    if (method === "GET" && m) {
      const status = kernel.status(m[1]!);
      const result = kernel.result(m[1]!);
      return void json(res, 200, { ...status, synthesis: result.synthesis });
    }

    m = path.match(/^\/api\/waiting\/([^/]+)$/);
    if (method === "GET" && m) {
      return void json(res, 200, { ever_claimed: missionEverClaimed(opts.superRoot, m[1]!) });
    }

    json(res, 404, { error: "not found" });
  }
}
