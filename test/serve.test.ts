import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { cfg, tmp } from "./helpers.js";
import { createDumpServer } from "../src/serve.js";
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

test("an unknown route returns 404 as JSON", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/api/nope");
    assert.equal(res.status, 404);
    assert.match((await res.json() as { error: string }).error, /not found/);
  });
});
