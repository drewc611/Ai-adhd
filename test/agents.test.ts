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

/**
 * An allowlist, not a denylist. Naming the tools that must not appear leaves every tool nobody
 * thought of passing silently, and the ones that would hurt most are the ones a future edit is
 * most likely to reach for: Agent and SendMessage reach other agents, TaskCreate and TaskOutput
 * reach other tasks, and any MCP tool reaches whatever its server does. "Branches never see
 * siblings" is a CLAUDE.md non-negotiable, so a new grant has to be argued for here first.
 *
 * TaskList is the launch permit from D4: Claude Code refuses to launch an agent with zero tools.
 * It is read only and reaches no file and no network. What it reveals about sibling tasks is
 * unverified; see D4. It is the one grant on this list that rests on an untested claim.
 */
const PERMITTED: Record<string, string[]> = {
  "adhd-branch.md": ["TaskList"],
  "adhd-critic.md": ["TaskList"],
  "adhd-deepen.md": ["TaskList"],
  "adhd-branch-search.md": ["WebFetch", "WebSearch"],
};

/**
 * The maintenance agents are a different category and a separate allowlist, because giving them
 * one entry in PERMITTED would quietly relax the rule that produced it. They never take part in a
 * run: they are dispatched by the scheduled workflows, they read build artifacts and records, and
 * nothing they write is read during a run. So filesystem tools are correct for them and would be
 * a hole in any of the four above.
 *
 * The governor has no Bash on purpose. A ceiling that can run the job it caps eventually runs it
 * "just to check", and the check is the cost it exists to prevent.
 */
const MAINTENANCE: Record<string, string[]> = {
  "adhd-trainer.md": ["Bash", "Glob", "Grep", "Read"],
  "adhd-governor.md": ["Glob", "Grep", "Read"],
};

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

test("every agent grants exactly the tools it is permitted, and nothing else", () => {
  const dir = join(cfg.root, "agents");
  const files = readdirSync(dir).filter((x) => x.endsWith(".md"));
  const allowed = { ...PERMITTED, ...MAINTENANCE };
  assert.deepEqual(files.sort(), Object.keys(allowed).sort(), "a new agent file needs an entry in PERMITTED or MAINTENANCE");
  for (const f of files) {
    const t = tools(frontmatter(join(dir, f))).sort();
    assert.deepEqual(t, [...allowed[f]!].sort(), `${f}: tool grant changed. Argue for it in D4 before changing the allowlist.`);
  }
});

/** The two categories that matter most, named separately so a failure says which line was crossed. */
test("no run agent carries a filesystem tool, and only the search agent carries network", () => {
  const dir = join(cfg.root, "agents");
  for (const f of Object.keys(PERMITTED)) {
    const t = tools(frontmatter(join(dir, f)));
    for (const bad of FILESYSTEM) assert.ok(!t.includes(bad), `${f} grants ${bad}: a channel to sibling artifacts`);
    const net = t.filter((x) => NETWORK.includes(x));
    if (f === "adhd-branch-search.md") assert.deepEqual(net.sort(), ["WebFetch", "WebSearch"]);
    else assert.deepEqual(net, [], `${f} grants network tools`);
  }
});

/**
 * What the maintenance agents must never gain. Network would let a scheduled job fetch a corpus
 * or a set of weights, which is the one way this repository acquires an inference client without
 * anyone deciding to. Agent-spawning would let it start a run, and a run started by a job that
 * can read the run directory is not isolated.
 */
test("no maintenance agent can reach the network or start a run", () => {
  const dir = join(cfg.root, "agents");
  for (const f of Object.keys(MAINTENANCE)) {
    const t = tools(frontmatter(join(dir, f)));
    for (const bad of [...NETWORK, "Task", "Agent", "SendMessage", "TaskCreate", "Write", "Edit"])
      assert.ok(!t.includes(bad), `${f} grants ${bad}`);
  }
});

/**
 * Every tool that reaches another agent, another task, or another server. Listed by name as well
 * as caught by the allowlist above, so a failure here says what the grant would have opened.
 */
test("no agent carries a tool that reaches another agent, task, or server", () => {
  const REACHING = ["Agent", "Task", "SendMessage", "ListAgents", "TaskCreate", "TaskUpdate", "TaskOutput", "TaskStop", "TaskGet", "Skill", "Workflow", "AskUserQuestion"];
  const dir = join(cfg.root, "agents");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const t = tools(frontmatter(join(dir, f)));
    for (const bad of REACHING) assert.ok(!t.includes(bad), `${f} grants ${bad}: branches never see siblings`);
    for (const tool of t) assert.ok(!tool.startsWith("mcp__"), `${f} grants the MCP tool ${tool}, which reaches whatever its server does`);
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

test("plugin.json ships the four run agents and nothing that maintains this repository", () => {
  const p = JSON.parse(readFileSync(join(cfg.root, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(p["skills"], ["./skills/adhd", "./skills/adhd-worker"]);

  // Not `./agents`. That directory also holds adhd-trainer and adhd-governor, which maintain this
  // repository's background model and would arrive at a plugin user as two agents referencing
  // paths they do not have.
  const shipped = p["agents"] as string[];
  assert.deepEqual([...shipped].sort(), Object.keys(PERMITTED).map((f) => `./agents/${f}`).sort());
  for (const rel of shipped) assert.ok(existsSync(join(cfg.root, rel)), `plugin.json ships ${rel}, which is not there`);
  for (const m of Object.keys(MAINTENANCE))
    assert.ok(!shipped.includes(`./agents/${m}`), `plugin.json ships ${m}, a maintenance agent`);
});

/**
 * `dist/` is gitignored, so a plugin installed from the git source has no built MCP server. The
 * launcher exists to turn ERR_MODULE_NOT_FOUND with a path inside the host's plugin cache into a
 * sentence naming the two commands that fix it.
 */
test("the MCP entry goes through the launcher, which is committed and diagnoses a missing build", () => {
  const p = JSON.parse(readFileSync(join(cfg.root, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  const mcp = (p["mcpServers"] as Record<string, { command: string; args: string[] }>)["adhd"]!;
  assert.equal(mcp.command, "node");
  assert.match(mcp.args[0]!, /bin\/adhd-mcp\.mjs$/);

  const launcher = join(cfg.root, "bin", "adhd-mcp.mjs");
  assert.ok(existsSync(launcher), "bin/adhd-mcp.mjs is not committed, so the plugin points at nothing");
  const body = readFileSync(launcher, "utf8");
  assert.match(body, /npm install && npm run build/, "the launcher does not say how to fix a missing build");
  assert.ok(!/execSync|spawn|child_process/.test(body), "the launcher builds on the user's behalf; hosts start servers without asking");
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
