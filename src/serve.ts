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

/** A request the server refuses on purpose; carries the status the client should see. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** A brain dump is prose. Nothing this UI accepts needs more than this, and an uncapped body is a memory sink. */
export const MAX_BODY_BYTES = 1024 * 1024;

const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "[::1]"];

/** True for the addresses `adhd serve` may bind without an explicit opt-in. */
export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return void reject(new HttpError(413, "request body too large"));
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return void reject(new HttpError(413, "request body too large"));
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
  /**
   * Host names, beyond the loopback ones, that a request may address. Empty by default. Only
   * `adhd serve --allow-non-loopback` fills it, and every entry is a name the operator typed.
   */
  allowedHosts?: string[];
}

export function createDumpServer(cfg: Config, opts: ServeOptions) {
  const kernel = openKernel(cfg, opts.osRoot);
  const superAgent = openSuper(cfg, opts.superRoot);
  const pageHtml = readFileSync(join(cfg.root, "assets", "dump.html"), "utf8");

  const extraHosts = (opts.allowedHosts ?? []).map((h) => h.toLowerCase());

  /**
   * Host and Origin gate. A page on any other site can reach a loopback server two ways: a
   * cross-site request from the browser, and DNS rebinding, where its own hostname is re-pointed
   * at 127.0.0.1. The Host header exposes the second (the browser still sends the attacker's
   * name), and Origin plus Sec-Fetch-Site expose the first. There is no token here, so this is
   * the whole defence: a request that fails it is refused before any route runs.
   */
  function checkOrigin(req: IncomingMessage): HttpError | null {
    const port = req.socket.localPort;
    const allowed = new Set<string>();
    for (const name of [...LOOPBACK_NAMES, ...extraHosts]) allowed.add(`${name}:${port}`);
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowed.has(host)) return new HttpError(403, "host not allowed");
    const method = req.method ?? "GET";
    if (method === "GET" || method === "HEAD") return null;
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") return new HttpError(403, "cross-site request refused");
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let ok = false;
      try {
        const u = new URL(origin);
        ok = u.protocol === "http:" && allowed.has(u.host.toLowerCase());
      } catch {
        ok = false;
      }
      if (!ok) return new HttpError(403, "cross-origin request refused");
    }
    return null;
  }

  return createServer((req, res) => {
    const refused = checkOrigin(req);
    if (refused) return void json(res, refused.status, { error: refused.message });
    void handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return;
      if (e instanceof HttpError) {
        res.setHeader("connection", "close");
        return void json(res, e.status, { error: e.message });
      }
      json(res, 500, { error: (e as Error).message });
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
      // "dead" means a worker tried, `adhd super return` rejected the artifact against
      // checkTriageArtifact's schema, and that happened CLASS_POLICY.triage.maxAttempts times.
      // Polling forever on a stage that can never finish is the exact silent-spinner failure
      // the waiting-banner exists to avoid on the "no worker yet" side; this is its counterpart
      // on the "a worker tried and the contract kept rejecting it" side.
      if (stage.status === "dead") return void json(res, 200, { state: s.mission.state, stage: stage.status, items: null, failed: true, reason: stage.note ?? "the worker's submission kept failing its contract" });
      if (stage.status !== "done") return void json(res, 200, { state: s.mission.state, stage: stage.status, items: null, failed: false, reason: stage.status === "pending" ? stage.note : null });
      const artifactPath = join(opts.superRoot, "missions", id, stage.contract.artifact);
      const text = existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : "";
      const { result } = checkTriageArtifact(cfg, text);
      return void json(res, 200, { state: s.mission.state, stage: stage.status, items: result?.items ?? null, failed: false, reason: null });
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
