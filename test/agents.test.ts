// The plugin surface cannot be exercised without installing the plugin, so the agent and skill
// definitions are checked mechanically: frontmatter shape, tool grants, and the D4 rule that
// no branch, critic, or deepen agent ever carries a filesystem or network channel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { cfg } from "./helpers.js";
import { STAGE_AGENT, STAGE_TOOLS, type StageKind } from "../src/super/index.js";

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
 * The launch permit, D4 as amended by D36, D38 and now D41: the host refuses to launch an agent
 * with no tools, so an isolated agent has to carry one, and the permit has to satisfy two things
 * at once. It must not reach what another agent in the run wrote, and it must actually resolve.
 *
 * `TodoWrite` and `TaskList` satisfied the first and failed the second, and the failure was total:
 * this host answers "unrecognized [TodoWrite]; recognized but matched no tools in this session
 * [TaskList]" and refuses the spawn. D36 and D38 knew, and accepted a fallback to
 * `adhd-branch-search`. What that costs was never priced: the fallback swaps the *system prompt*
 * too, so `adhd-critic.md` — "run every detector mechanically, eight records per branch, no gaps" —
 * has never executed in any recorded run. A critic scoring without its own instructions is the
 * most economical explanation on offer for item 4's finding that the trap sweep does not reproduce
 * while divergence does.
 *
 * So the permit is the web pair for all four. It resolves — `adhd-branch-search` has spawned on
 * exactly this list — and it cannot open a sibling's artifact, which is the guarantee CLAUDE.md
 * calls non-negotiable. The property given up is narrower and is named rather than hidden: a frame
 * with no `tools` grant is now dispatched to an agent that *could* search. The brief tells it not
 * to, and T3, the citation trap, is the mechanical detector for a branch that did. That is the same
 * trade D38 wrote down as rung 2 of its fallback ladder; D41 promotes it into the definitions so
 * rung 1 resolves and the ladder goes away.
 */
const PERMITTED: Record<string, string[]> = {
  "adhd-branch.md": ["WebFetch", "WebSearch"],
  "adhd-critic.md": ["WebFetch", "WebSearch"],
  "adhd-deepen.md": ["WebFetch", "WebSearch"],
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

/**
 * The SuperAgent's stage agents, derived rather than listed.
 *
 * `STAGE_TOOLS` is what the scheduler actually hands a host when it dispatches a stage, so writing
 * the expected grants out again here would test a copy. Deriving them means a stage kind that
 * gains a tool fails this test until the agent that runs it declares the same one, which is the
 * D4 property applied to stages.
 */
const MISSION: Record<string, string[]> = Object.fromEntries(
  Object.entries(STAGE_AGENT)
    .filter(([, agent]) => agent !== null)
    .map(([kind, agent]) => [`${agent}.md`, [...STAGE_TOOLS[kind as StageKind]].sort()]),
);

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
  const allowed = { ...PERMITTED, ...MAINTENANCE, ...MISSION };
  assert.deepEqual(files.sort(), Object.keys(allowed).sort(), "a new agent file needs an entry in PERMITTED, MAINTENANCE, or a stage kind in STAGE_AGENT");
  for (const f of files) {
    const t = tools(frontmatter(join(dir, f))).sort();
    assert.deepEqual(t, [...allowed[f]!].sort(), `${f}: tool grant changed. Argue for it in D4 before changing the allowlist.`);
  }
});

/**
 * The line that actually matters, and the one that does not.
 *
 * Filesystem access is the one to hold: it is the only channel by which one isolated agent can
 * read what another wrote, and "branches never see siblings" is the CLAUDE.md non-negotiable.
 * Network access is not that channel — nothing in a run is published — so D41 spends it to buy a
 * permit that launches. Keeping the old rule would have kept a cleaner-looking allowlist and three
 * agents that cannot start.
 */
test("no run agent carries a filesystem tool, and every permit is one that resolves", () => {
  const dir = join(cfg.root, "agents");
  for (const f of Object.keys(PERMITTED)) {
    const t = tools(frontmatter(join(dir, f)));
    for (const bad of FILESYSTEM) assert.ok(!t.includes(bad), `${f} grants ${bad}: a channel to sibling artifacts`);
    assert.ok(t.length > 0, `${f}: the host refuses to launch an agent with zero tools`);
    assert.deepEqual(
      t.filter((x) => !NETWORK.includes(x)),
      [],
      `${f} grants a permit outside the web pair. D41: a permit must both resolve and reach nothing the run wrote, and no other name is known to do both`,
    );
  }
});

/**
 * The regression that matters more than the allowlist. `TodoWrite` and `TaskList` are the two
 * names that shipped, looked inert, passed every check, and could not launch. Naming them keeps a
 * future edit from reaching for the same class of tool because it reads as harmless.
 */
test("the two permits that silently failed to launch never come back", () => {
  const dir = join(cfg.root, "agents");
  for (const f of Object.keys(PERMITTED)) {
    const t = tools(frontmatter(join(dir, f)));
    for (const dead of ["TodoWrite", "TaskList"])
      assert.ok(!t.includes(dead), `${f} grants ${dead}, which does not resolve in a Claude Code remote session. The agent would not start and the dispatch would silently fall back to another agent's system prompt`);
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

test("plugin.json ships the run and mission agents, and nothing that maintains this repository", () => {
  const p = JSON.parse(readFileSync(join(cfg.root, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(p["skills"], ["./skills/adhd", "./skills/adhd-worker", "./skills/superagent"]);

  // Not `./agents`. That directory also holds adhd-trainer and adhd-governor, which maintain this
  // repository's background model and would arrive at a plugin user as two agents referencing
  // paths they do not have.
  const shipped = p["agents"] as string[];
  const expected = [...Object.keys(PERMITTED), ...Object.keys(MISSION)].map((f) => `./agents/${f}`).sort();
  assert.deepEqual([...shipped].sort(), expected);
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

/**
 * Mission agents legitimately carry filesystem tools; the run agents' ban does not apply to them.
 * What does apply is the ban that made them separate agents in the first place.
 */
test("no mission agent can reach the network or start a run, and only the builder can write", () => {
  const dir = join(cfg.root, "agents");
  for (const f of Object.keys(MISSION)) {
    const t = tools(frontmatter(join(dir, f)));
    for (const bad of ["Task", "Agent", "SendMessage", "TaskCreate"]) assert.ok(!t.includes(bad), `${f} grants ${bad}`);
    if (f !== "adhd-researcher.md") for (const bad of NETWORK) assert.ok(!t.includes(bad), `${f} grants ${bad}`);
  }
  // A verify stage that can edit what it just checked is not a check, which is why the build and
  // verify kinds are two agents rather than one. `adhd doctor` found that; this keeps it found.
  const verifier = tools(frontmatter(join(dir, "adhd-verifier.md")));
  assert.ok(!verifier.includes("Write") && !verifier.includes("Edit"), "the verifier can edit what it verifies");
  assert.ok(verifier.includes("Bash"), "the verifier cannot run the checks");
  const reviewer = tools(frontmatter(join(dir, "adhd-reviewer.md")));
  assert.ok(!reviewer.includes("Write") && !reviewer.includes("Bash"), "a reviewer that can fix what it finds never writes the objection down");
});

/**
 * D42. `agents/` is only read when the plugin is installed. A session opened straight on this
 * repository installs nothing, so every dispatch name in `skills/adhd/SKILL.md` resolved to no
 * agent at all and the spawn was refused before any permit was looked at — which is why D41's
 * permit fix could not be observed to change anything. `.claude/agents/` is the directory such a
 * session reads, so the shipped agents are mirrored into it by `scripts/sync-claude-agents.mjs`.
 *
 * The mirror is a copy, so it can drift. This is the check that says so.
 */
test("the shipped agents are mirrored into .claude/agents, byte for byte", () => {
  const p = JSON.parse(readFileSync(join(cfg.root, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
  const shipped = (p["agents"] as string[]).map((a) => a.replace(/^\.\/agents\//, ""));
  const dir = join(cfg.root, ".claude", "agents");

  assert.ok(existsSync(dir), ".claude/agents does not exist, so a session on this repository has no adhd agents");
  for (const file of shipped) {
    const mirror = join(dir, file);
    assert.ok(existsSync(mirror), `.claude/agents/${file} is missing; run node scripts/sync-claude-agents.mjs`);
    assert.equal(
      readFileSync(mirror, "utf8"),
      readFileSync(join(cfg.root, "agents", file), "utf8"),
      `.claude/agents/${file} has drifted from agents/${file}; run node scripts/sync-claude-agents.mjs`,
    );
  }

  // The maintenance agents stay out for the same reason plugin.json leaves them out: adhd-trainer
  // has Bash and adhd-governor reads this repository's training records, and neither belongs in
  // the agent list of a session that merely opened the clone.
  const mirrored = readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.deepEqual(mirrored.sort(), [...shipped].sort());
});
