import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cfg, tmp, writeProblem } from "./helpers.js";
import { buildServer } from "../src/mcp.js";

/**
 * The MCP server is one of four v0 deliverables and had no coverage, because connecting stdio at
 * module scope made the file impossible to import. These drive the real registered handlers over
 * an in-memory transport, so a schema or wiring change fails here rather than in a host.
 */
async function connect() {
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([buildServer().connect(b), client.connect(a)]);
  return client;
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
const body = (r: ToolResult) => r.content.map((c) => c.text).join("\n");

const EXPECTED = [
  "adhd_run",
  "adhd_traps",
  "adhd_eval",
  "adhd_frames",
  "adhd_submit",
  "adhd_confirm",
  "adhd_claim",
  "adhd_return",
  "adhd_log",
  "adhd_record",
  "adhd_status",
  "adhd_result",
  "adhd_cancel",
  "adhd_list",
];

test("every tool the docs promise is registered, and nothing else is", async () => {
  const client = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...EXPECTED].sort());
  await client.close();
});

test("every tool describes itself", async () => {
  const client = await connect();
  for (const t of (await client.listTools()).tools) {
    assert.ok(t.description && t.description.length > 20, `${t.name} has no usable description`);
    assert.ok(t.inputSchema, `${t.name} has no input schema`);
  }
  await client.close();
});

/**
 * `root` meant the repository root in four tools and the kernel's runs directory in ten. A host
 * passing its repo root to adhd_submit had that directory treated as the runs root, silently.
 */
test("root and os_root are distinct and documented on every kernel tool", async () => {
  const client = await connect();
  const tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]));
  for (const name of ["adhd_submit", "adhd_claim", "adhd_status", "adhd_list", "adhd_cancel", "adhd_record"]) {
    const props = (tools.get(name)!.inputSchema as { properties?: Record<string, { description?: string }> }).properties ?? {};
    assert.ok(props.os_root, `${name} has no os_root`);
    assert.match(props.os_root.description ?? "", /runs directory/);
    assert.match(props.root?.description ?? "", /config\/ and prompts\//);
  }
  // The four command tools take a repository root only. A kernel root would mean nothing to them.
  for (const name of ["adhd_run", "adhd_traps", "adhd_eval", "adhd_frames"]) {
    const props = (tools.get(name)!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    assert.ok(!props.os_root, `${name} should not take os_root`);
  }
  await client.close();
});

test("adhd_frames returns the library, and the same evidence views as the CLI", async () => {
  const client = await connect();
  assert.match(body(await call(client, "adhd_frames")), /PARTICULARIST/);
  assert.match(body(await call(client, "adhd_frames", { stats: true })), /prune/i);
  assert.match(body(await call(client, "adhd_frames", { orthogonality: true })), /co-clustered/);
  await client.close();
});

test("adhd_eval replays the recorded corpus", async () => {
  const client = await connect();
  const r = await call(client, "adhd_eval");
  assert.ok(!r.isError, body(r));
  assert.match(body(r), /001/);
  await client.close();
});

test("a failure comes back as an error result, not a thrown transport error", async () => {
  const client = await connect();
  const r = await call(client, "adhd_traps", { file: join(tmp(), "does-not-exist.yaml") });
  assert.equal(r.isError, true, "a missing file must be reported, not swallowed");
  assert.ok(body(r).length > 0);
  // The server stays usable afterwards.
  assert.match(body(await call(client, "adhd_frames")), /LEDGER/);
  await client.close();
});

test("adhd_run compiles a run and writes briefs where it says it did", async () => {
  const client = await connect();
  const dir = tmp();
  const problemPath = writeProblem(join(dir, "in"), "What timeouts should I set on this HTTP client?");
  const r = await call(client, "adhd_run", { phase: "compile", problem_path: problemPath, decision: { problem_class: "design_decision" }, runs_dir: join(dir, "runs"), seed: 1, root: cfg.root });
  assert.ok(!r.isError, body(r));
  const runDir = body(r).match(/runs\/[^\s:]+/)?.[0];
  assert.ok(runDir, `no run directory in output: ${body(r)}`);
  await client.close();
});

/** D5: nothing is spent until the user has seen the preview and agreed to it. */
test("adhd_submit returns the preview and stops at awaiting_confirm", async () => {
  const client = await connect();
  const osRoot = join(tmp(), "runs");
  const r = await call(client, "adhd_submit", {
    problem: "What timeouts should I set on this HTTP client?",
    decision: { problem_class: "design_decision" },
    seed: 1,
    os_root: osRoot,
    root: cfg.root,
  });
  assert.ok(!r.isError, body(r));
  const out = body(r);
  assert.match(out, /awaiting_confirm/);
  assert.match(out, /What timeouts should I set on this HTTP client\?/, "the preview shows the problem verbatim");
  assert.match(out, /estimate_tokens/);
  const runId = JSON.parse(out.slice(out.lastIndexOf("{"))).run_id as string;

  // Unconfirmed, so nothing is claimable: the gate is the point.
  const claim = await call(client, "adhd_claim", { worker: "w1", os_root: osRoot, root: cfg.root });
  assert.equal(body(claim).trim(), "null");

  assert.ok(!(await call(client, "adhd_confirm", { run_id: runId, os_root: osRoot, root: cfg.root })).isError);
  const after = await call(client, "adhd_claim", { worker: "w1", os_root: osRoot, root: cfg.root });
  const task = JSON.parse(body(after)) as { task_id: string; brief: string; agent: string } | null;
  assert.ok(task, "a confirmed run has claimable branch tasks");
  assert.match(task.agent, /^adhd-branch/);
  assert.ok(task.brief.length > 100, "the brief comes back inline");
  await client.close();
});

test("adhd_status, adhd_log and adhd_list see the same run", async () => {
  const client = await connect();
  const osRoot = join(tmp(), "runs");
  const args = { os_root: osRoot, root: cfg.root };
  const sub = body(await call(client, "adhd_submit", { problem: "Should we rewrite our monolith as microservices?", decision: { problem_class: "strategy" }, seed: 2, ...args }));
  const runId = JSON.parse(sub.slice(sub.lastIndexOf("{"))).run_id as string;

  assert.match(body(await call(client, "adhd_status", { run_id: runId, ...args })), /awaiting_confirm/);
  const log = JSON.parse(body(await call(client, "adhd_log", { run_id: runId, ...args }))) as { event: string }[];
  assert.deepEqual(log.map((l) => l.event), ["submitted"]);
  const list = JSON.parse(body(await call(client, "adhd_list", args))) as { run_id: string }[];
  assert.deepEqual(list.map((r) => r.run_id), [runId]);
  await client.close();
});

/** D5's other half: a cancelled run still gives the user what was already paid for. */
test("adhd_cancel drops pending work and adhd_result says there is no synthesis yet", async () => {
  const client = await connect();
  const osRoot = join(tmp(), "runs");
  const args = { os_root: osRoot, root: cfg.root };
  const sub = body(await call(client, "adhd_submit", { problem: "What timeouts should I set on this HTTP client?", decision: { problem_class: "design_decision" }, seed: 1, confirmed: true, ...args }));
  const runId = JSON.parse(sub.slice(sub.lastIndexOf("{"))).run_id as string;

  assert.match(body(await call(client, "adhd_result", { run_id: runId, ...args })), /no synthesis yet/);
  assert.ok(!(await call(client, "adhd_cancel", { run_id: runId, reason: "changed my mind", ...args })).isError);
  const status = body(await call(client, "adhd_status", { run_id: runId, ...args }));
  assert.match(status, /cancelled/);
  assert.equal(body(await call(client, "adhd_claim", { worker: "w1", ...args })).trim(), "null", "a cancelled run has nothing to claim");
  await client.close();
});

test("adhd_return refuses an artifact for a task nobody claimed", async () => {
  const client = await connect();
  const osRoot = join(tmp(), "runs");
  const r = await call(client, "adhd_return", { task_id: "no-such-task", output: "position: do it", os_root: osRoot, root: cfg.root });
  assert.equal(r.isError, true);
  await client.close();
});

test("the built server is a fresh instance each time, so tests cannot leak into each other", async () => {
  assert.notEqual(buildServer(), buildServer());
});

test("running the file directly still speaks stdio", () => {
  // The guard that stops the transport connecting on import must not stop it connecting on run.
  const src = readFileSync(join(cfg.root, "src", "mcp.ts"), "utf8");
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  assert.ok(existsSync(join(cfg.root, "dist", "src", "mcp.js")), "the built entry point exists");
});

test("adhd_frames exposes every report the CLI has, and picks one at a time", async () => {
  // The CLI grew --health and --axes; the MCP surface had stats and orthogonality only, and
  // --collisions had been missing since it shipped. A host driving this server should not have
  // a smaller view of the corpus than a terminal does.
  const client = await connect();
  const frames = (await client.listTools()).tools.find((t) => t.name === "adhd_frames")!;
  const props = Object.keys((frames.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
  for (const flag of ["stats", "orthogonality", "health", "axes", "collisions"]) assert.ok(props.includes(flag), `adhd_frames cannot ${flag}`);

  assert.match(body(await call(client, "adhd_frames", { health: true })), /against docs\/RETIREMENT\.md/);
  assert.match(body(await call(client, "adhd_frames", { axes: true })), /axis coverage/);
  assert.match(body(await call(client, "adhd_frames", { collisions: true })), /collision/i);
  assert.match(body(await call(client, "adhd_frames")), /frames, \d+ axes/);
});

/**
 * CLAUDE.md ships the MCP server as "the same four as stdio tools, so any MCP host can drive it".
 * "The same" is the claim, and it had quietly stopped being true: `adhd frames` grew `--drift` and
 * `--forbidden`, and neither reached the MCP tool, so a host could see five of the seven reports
 * this repository can produce and had no way to know two were missing.
 *
 * Read from the CLI source rather than from a list maintained beside it, because a hand-kept list
 * is a third thing to forget.
 */
test("every report mode the CLI offers is an input the MCP tool accepts", async () => {
  const cli = readFileSync(join(cfg.root, "src", "cli.ts"), "utf8");
  /** The boolean report flags on one CLI command, read from the source rather than a kept list. */
  const modesOf = (command: string) => {
    const at = cli.indexOf(`.command("${command}")`);
    assert.notEqual(at, -1, `no CLI command ${command}`);
    const block = cli.slice(at, cli.indexOf(".action", at));
    // Flags taking a value are paths and directories, not reports. `--json` is a rendering choice
    // and MCP returns text either way.
    return [...block.matchAll(/\.option\("--([a-z-]+)"(?!\s*<)/g)].map((m) => m[1]!).filter((m) => m !== "json");
  };

  const client = await connect();
  const tools = (await client.listTools()).tools;
  const propsOf = (name: string) => {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, `no MCP tool ${name}`);
    return { props: Object.keys((t!.inputSchema as { properties: Record<string, unknown> }).properties), description: t!.description ?? "" };
  };

  // `eval --update` rewrites the gate's baseline and is withheld on purpose, so it is named here
  // rather than silently skipped: a deliberate omission and a forgotten one look identical from
  // outside, and this is the file that decides which this is.
  const withheld: Record<string, string[]> = { eval: ["update"] };

  for (const [command, tool] of [["frames", "adhd_frames"], ["eval", "adhd_eval"]] as const) {
    const modes = modesOf(command).filter((m) => !(withheld[command] ?? []).includes(m));
    assert.ok(modes.length >= 3, `expected report modes on ${command}, found ${modes.join(",")}`);
    const { props, description } = propsOf(tool);
    for (const m of modes) assert.ok(props.includes(m), `adhd ${command} --${m} has no MCP equivalent; the two surfaces have drifted`);
    for (const m of modes) assert.ok(new RegExp(`\\b${m}=true`).test(description), `${tool}'s description never mentions ${m}=true`);
    for (const m of withheld[command] ?? []) assert.ok(!props.includes(m), `${tool} exposes --${m}, which this test records as withheld`);
  }
  // And the withholding is explained where a host reads, not only here.
  assert.match(propsOf("adhd_eval").description, /not available here on purpose/);
});

test("the eval report modes return their own reports through MCP", async () => {
  const client = await connect();
  const seen = new Map<string, string>();
  for (const mode of ["audit", "history", "gate"]) {
    const r = (await client.callTool({ name: "adhd_eval", arguments: { [mode]: true } })) as { content: { text: string }[]; isError?: boolean };
    assert.ok(!r.isError, `${mode} errored: ${r.content[0]!.text}`);
    seen.set(mode, r.content[0]!.text);
  }
  assert.equal(new Set(seen.values()).size, 3, "two eval modes returned identical text");
  assert.match(seen.get("audit")!, /fixture audit over/);
  assert.match(seen.get("history")!, /assertion history over/);
  assert.match(seen.get("gate")!, /regression gate over/);
});

test("each frames report mode returns its own report through MCP, not the default listing", async () => {
  const client = await connect();
  const seen = new Map<string, string>();
  for (const mode of ["stats", "health", "axes", "collisions", "drift", "forbidden", "reach"]) {
    const r = (await client.callTool({ name: "adhd_frames", arguments: { [mode]: true } })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]!.text;
    assert.ok(!r.isError, `${mode} errored: ${text}`);
    assert.ok(text.length > 40, `${mode} returned almost nothing`);
    seen.set(mode, text);
  }
  // Distinct reports, not the same one seven times: a wiring bug that fell through to the default
  // listing would pass every check above.
  assert.equal(new Set(seen.values()).size, seen.size, "two modes returned identical text");
  assert.match(seen.get("reach")!, /at that class's default n/);
  assert.match(seen.get("forbidden")!, /forbidden-list audit/);
  assert.match(seen.get("drift")!, /frame|drift/i);
});
