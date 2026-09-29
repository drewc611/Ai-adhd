import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { spawnSync } from "node:child_process";
import { cfg, tmp } from "./helpers.js";
import { createDumpServer, isLoopbackHost, MAX_BODY_BYTES } from "../src/serve.js";
import { openKernel } from "../src/os.js";
import { openSuper } from "../src/super/index.js";

async function withServer<T>(fn: (base: string, osRoot: string, superRoot: string) => Promise<T>): Promise<T> {
  const osRoot = tmp("adhd-serve-os-");
  const superRoot = tmp("adhd-serve-super-");
  const server = createDumpServer(cfg, { osRoot, superRoot });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`, osRoot, superRoot);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(osRoot, { recursive: true, force: true });
    rmSync(superRoot, { recursive: true, force: true });
  }
}

test("GET / serves the dump page", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<title>ADHD brain dump<\/title>/);
  });
});

test("POST /api/dump auto-confirms the triage mission: a stage is claimable immediately", async () => {
  await withServer(async (base, _osRoot, superRoot) => {
    const res = await fetch(base + "/api/dump", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "call mom, should I switch jobs" }),
    });
    assert.equal(res.status, 200);
    const { mission_id } = (await res.json()) as { mission_id: string };
    assert.ok(mission_id);

    const sa = openSuper(cfg, superRoot);
    const claimed = sa.claim(mission_id, "test-worker");
    assert.ok(claimed, "the triage stage was not claimable right after /api/dump: D46's auto-confirm did not happen");
    assert.equal(claimed!.kind, "triage");
  });
});

test("POST /api/dump rejects an empty dump without submitting a mission", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/api/dump", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "   " }) });
    assert.equal(res.status, 400);
  });
});

/**
 * The load-bearing assertion for the whole feature: the expensive path never bypasses D5,
 * however convenient the auto-confirmed cheap path just above is.
 */
test("POST /api/decide leaves nothing claimable until the explicit confirm endpoint is called", async () => {
  await withServer(async (base, osRoot) => {
    const res = await fetch(base + "/api/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problem: "Should we cache aggressively or invalidate eagerly?", problem_class: "design_decision" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { run_id: string; state: string; estimate_tokens: number; preview: string };
    assert.equal(body.state, "awaiting_confirm");
    assert.ok(body.estimate_tokens > 0);
    assert.match(body.preview, /problem_hash|hash/i);

    const kernel = openKernel(cfg, osRoot);
    assert.equal(kernel.claim("test-worker", { runId: body.run_id }), null, "a branch was claimable before the explicit confirm endpoint was ever called");

    const confirmRes = await fetch(base + `/api/decide/${body.run_id}/confirm`, { method: "POST" });
    assert.equal(confirmRes.status, 200);

    const claimed = kernel.claim("test-worker", { runId: body.run_id });
    assert.ok(claimed, "confirming through the HTTP endpoint did not release the run");
  });
});

test("POST /api/decide declines a decline-only class without creating a run", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/api/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problem: "What port does Postgres listen on by default?", problem_class: "factual_lookup" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { declined: boolean; reason: string };
    assert.equal(body.declined, true);
    assert.ok(body.reason.length > 0);
  });
});

test("GET /api/waiting/:id reports false until a worker claims the stage, then true", async () => {
  await withServer(async (base, _osRoot, superRoot) => {
    const res = await fetch(base + "/api/dump", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "buy groceries" }) });
    const { mission_id } = (await res.json()) as { mission_id: string };

    const before = await (await fetch(base + `/api/waiting/${mission_id}`)).json();
    assert.equal((before as { ever_claimed: boolean }).ever_claimed, false);

    openSuper(cfg, superRoot).claim(mission_id, "w");
    const after = await (await fetch(base + `/api/waiting/${mission_id}`)).json();
    assert.equal((after as { ever_claimed: boolean }).ever_claimed, true);
  });
});

test("GET /api/dump/:id reports a dead triage stage as a clear failure, not an endless spinner", async () => {
  // A stage that has hit CLASS_POLICY.triage.maxAttempts will never become `done` on its own,
  // so a client that only checks `items` would poll forever. This is the same silent-spinner
  // failure the waiting banner exists to avoid on the "no worker yet" side, checked here on the
  // "a worker tried and the contract kept rejecting it" side.
  await withServer(async (base, _osRoot, superRoot) => {
    const res = await fetch(base + "/api/dump", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "call mom" }) });
    const { mission_id } = (await res.json()) as { mission_id: string };

    const sa = openSuper(cfg, superRoot);
    const itemsPath = join(superRoot, "missions", mission_id, "items.yaml");
    for (let i = 0; i < 2; i++) {
      const claimed = sa.claim(mission_id, "w")!;
      assert.ok(claimed, `attempt ${i + 1} was not claimable`);
      writeFileSync(itemsPath, "```yaml\nitems: []\n```");
      sa.return_(mission_id, "triage", { worker: "w", goal_hash: claimed.goal_hash });
    }

    const body = (await (await fetch(base + `/api/dump/${mission_id}`)).json()) as { failed: boolean; items: unknown; reason: string };
    assert.equal(body.failed, true, "a dead stage was not reported as failed");
    assert.equal(body.items, null);
    assert.match(body.reason, /items/i, "the rejection reason from checkTriageArtifact was not surfaced");
  });
});

test("an unknown route returns 404 as JSON", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/api/nope");
    assert.equal(res.status, 404);
    assert.match((await res.json() as { error: string }).error, /not found/);
  });
});

/**
 * fetch() will not let a script set Host or Origin, and those two headers are exactly what these
 * tests are about, so they go through node:http, which sends what it is given.
 */
function raw(base: string, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; body: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const JSON_HEADERS = { "content-type": "application/json" };

test("a request whose Host is not loopback is refused before any route runs (DNS rebinding)", async () => {
  await withServer(async (base) => {
    const port = new URL(base).port;
    const r = await raw(base, "GET", "/", { host: `rebind.example:${port}` });
    assert.equal(r.status, 403);
    const wrongPort = await raw(base, "GET", "/", { host: "localhost:1" });
    assert.equal(wrongPort.status, 403);
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
      assert.equal((await raw(base, "GET", "/", { host })).status, 200, host);
    }
  });
});

test("a cross-origin POST is refused and submits no mission", async () => {
  await withServer(async (base, _osRoot, superRoot) => {
    const port = new URL(base).port;
    const body = JSON.stringify({ text: "enqueue me" });
    for (const origin of ["http://evil.example", "null", `http://127.0.0.1:${Number(port) + 1}`, `https://127.0.0.1:${port}`]) {
      const r = await raw(base, "POST", "/api/dump", { ...JSON_HEADERS, origin, host: `127.0.0.1:${port}` }, body);
      assert.equal(r.status, 403, `origin ${origin} was accepted`);
    }
    const site = await raw(base, "POST", "/api/dump", { ...JSON_HEADERS, "sec-fetch-site": "cross-site", host: `127.0.0.1:${port}` }, body);
    assert.equal(site.status, 403);
    const sameSite = await raw(base, "POST", "/api/dump", { ...JSON_HEADERS, "sec-fetch-site": "same-site", host: `127.0.0.1:${port}` }, body);
    assert.equal(sameSite.status, 403);
    assert.equal(openSuper(cfg, superRoot).list().length, 0, "a refused request still created a mission");
  });
});

test("a same-origin POST, with or without Origin, still works", async () => {
  await withServer(async (base) => {
    const port = new URL(base).port;
    const body = JSON.stringify({ text: "buy milk" });
    const withOrigin = await raw(base, "POST", "/api/dump", { ...JSON_HEADERS, origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" }, body);
    assert.equal(withOrigin.status, 200);
    const noOrigin = await raw(base, "POST", "/api/dump", JSON_HEADERS, body);
    assert.equal(noOrigin.status, 200);
  });
});

test("a request body over the cap is refused with 413 and submits no mission", async () => {
  await withServer(async (base, _osRoot, superRoot) => {
    const big = JSON.stringify({ text: "x".repeat(MAX_BODY_BYTES + 1) });
    const r = await raw(base, "POST", "/api/dump", JSON_HEADERS, big);
    assert.equal(r.status, 413);
    assert.equal(openSuper(cfg, superRoot).list().length, 0);
  });
});

test("allowedHosts admits a named host and nothing else", async () => {
  const osRoot = tmp("adhd-serve-os-");
  const superRoot = tmp("adhd-serve-super-");
  const server = createDumpServer(cfg, { osRoot, superRoot, allowedHosts: ["dump.internal"] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const port = new URL(base).port;
    assert.equal((await raw(base, "GET", "/", { host: `dump.internal:${port}` })).status, 200);
    assert.equal((await raw(base, "GET", "/", { host: `other.internal:${port}` })).status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(osRoot, { recursive: true, force: true });
    rmSync(superRoot, { recursive: true, force: true });
  }
});

test("isLoopbackHost accepts only loopback addresses", () => {
  for (const h of ["localhost", "127.0.0.1", "::1"]) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ["0.0.0.0", "::", "192.168.1.5", "example.com", ""]) assert.equal(isLoopbackHost(h), false, h);
});

test("adhd serve refuses a non-loopback --host without --allow-non-loopback", () => {
  const cli = join(cfg.root, "dist", "src", "cli.js");
  const r = spawnSync(process.execPath, [cli, "serve", "--host", "0.0.0.0", "--port", "0", "--os-root", tmp("adhd-serve-os-"), "--super-root", tmp("adhd-serve-super-")], { encoding: "utf8", cwd: cfg.root, timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /allow-non-loopback/);
});
