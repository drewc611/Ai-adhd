// The plugin surface cannot be exercised without installing the plugin, so the agent and skill
// definitions are checked mechanically: frontmatter shape, tool grants, and the D4 rule that
// no branch, critic, or deepen agent ever carries a filesystem or network channel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { cfg } from "./helpers.js";

function frontmatter(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${path}: no frontmatter`);
  return parse(m![1]!) as Record<string, unknown>;
}

function tools(fm: Record<string, unknown>): string[] {
  const t = fm["tools"];
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === "string") return t.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

const FILESYSTEM = ["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "Bash", "NotebookEdit", "LS"];
const NETWORK = ["WebSearch", "WebFetch"];

test("every agent file has a name matching its filename, a description, and at least one tool", () => {
  const dir = join(cfg.root, "agents");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const fm = frontmatter(join(dir, f));
    assert.equal(fm["name"], f.replace(/\.md$/, ""), `${f}: name does not match filename`);
    assert.ok(typeof fm["description"] === "string" && (fm["description"] as string).length > 20, `${f}: description`);
    assert.ok(tools(fm).length > 0, `${f}: Claude Code refuses to launch an agent with zero tools`);
  }
});

test("no branch, critic, or deepen agent carries a filesystem tool; only adhd-branch-search has network", () => {
  const dir = join(cfg.root, "agents");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const t = tools(frontmatter(join(dir, f)));
    for (const bad of FILESYSTEM) assert.ok(!t.includes(bad), `${f} grants ${bad}: a channel to sibling artifacts`);
    const net = t.filter((x) => NETWORK.includes(x));
    if (f === "adhd-branch-search.md") assert.deepEqual(net.sort(), ["WebFetch", "WebSearch"]);
    else assert.deepEqual(net, [], `${f} grants network tools`);
  }
});

test("the search agent's grant equals the routing allowlist and matches the compiler's agent choice", () => {
  const t = tools(frontmatter(join(cfg.root, "agents", "adhd-branch-search.md")));
  assert.deepEqual(t.sort(), [...cfg.routing.defaults.branch_tools_allowed].sort());
  for (const fr of cfg.frames.frames) {
    if (fr.tools.length) assert.deepEqual([...fr.tools].sort(), t.sort(), `${fr.id} grants tools the search agent does not carry`);
  }
});

test("the skill has a name and a description that says when not to use it", () => {
  const fm = frontmatter(join(cfg.root, "skills", "adhd", "SKILL.md"));
  assert.equal(fm["name"], "adhd");
  assert.match(String(fm["description"]), /Do not use/i);
});

test("plugin.json points at existing skill, agents, and MCP entry", () => {
  const p = JSON.parse(readFileSync(join(cfg.root, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(p["skills"], ["./skills/adhd", "./skills/adhd-worker"]);
  assert.deepEqual(p["agents"], ["./agents"]);
  const mcp = (p["mcpServers"] as Record<string, { command: string; args: string[] }>)["adhd"]!;
  assert.equal(mcp.command, "node");
  assert.match(mcp.args[0]!, /dist\/src\/mcp\.js$/);
});

test("every path package.json publishes exists after a build", () => {
  // The package shipped with bin, main and two scripts all pointing at dist/cli.js and
  // friends, while the build emits dist/src/. `npm i -g adhd && adhd` would have failed.
  // Nothing caught it because everything in development runs dist/src/cli.js directly.
  const root = cfg.root;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    bin: Record<string, string>;
    main: string;
    types?: string;
    exports?: Record<string, Record<string, string> | string>;
    scripts: Record<string, string>;
    files: string[];
  };
  const mustExist = new Set<string>([...Object.values(pkg.bin), pkg.main]);
  if (pkg.types) mustExist.add(pkg.types);
  for (const entry of Object.values(pkg.exports ?? {}))
    if (typeof entry === "object") for (const v of Object.values(entry)) mustExist.add(v.replace(/^\.\//, ""));
  // Scripts that launch a built file are entry points too, and were wrong in the same way.
  for (const cmd of Object.values(pkg.scripts)) {
    const m = cmd.match(/node (dist\/\S+\.js)/);
    if (m) mustExist.add(m[1]!);
  }
  assert.ok(mustExist.size >= 4, "expected several published entry points to check");
  for (const rel of mustExist) assert.ok(existsSync(join(root, rel)), `package.json points at ${rel}, which does not exist after a build`);
  // And the tarball must actually carry them: a correct path into an unshipped directory is
  // the same failure wearing a different hat.
  for (const rel of mustExist)
    assert.ok(
      pkg.files.some((f) => rel === f || rel.startsWith(f.replace(/\/$/, "") + "/")),
      `${rel} is an entry point but no "files" entry ships it`,
    );
});
