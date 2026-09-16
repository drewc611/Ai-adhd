#!/usr/bin/env node
/**
 * Mirror the agents plugin.json ships into `.claude/agents/`.
 *
 * `agents/` is the source of truth and stays that way: doctor, the tests and plugin.json all
 * read it. But an agent definition under `agents/` is only loaded when the plugin is installed,
 * and D42 found that a session opened straight on this repository — every Claude Code web and
 * remote session — installs nothing, so `adhd-branch` and the rest resolve to no agent at all
 * and the spawn is refused before any permit is consulted.
 *
 * `.claude/agents/` is the one directory such a session reads without an install, so the shipped
 * agents are copied there. `--check` fails on drift instead of writing, which is what CI runs.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, ".claude", "agents");
const check = process.argv.includes("--check");

const shipped = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")).agents.map((a) =>
  a.replace(/^\.\/agents\//, ""),
);

mkdirSync(dest, { recursive: true });
const stale = readdirSync(dest).filter((f) => f.endsWith(".md") && !shipped.includes(f));
const drifted = [];

for (const file of shipped) {
  const want = readFileSync(join(root, "agents", file), "utf8");
  let have = null;
  try {
    have = readFileSync(join(dest, file), "utf8");
  } catch {
    /* absent */
  }
  if (have === want) continue;
  drifted.push(file);
  if (!check) writeFileSync(join(dest, file), want);
}

if (!check) for (const file of stale) rmSync(join(dest, file));

if (check && (drifted.length || stale.length)) {
  for (const f of drifted) console.error(`.claude/agents/${f} does not match agents/${f}`);
  for (const f of stale) console.error(`.claude/agents/${f} is not shipped by plugin.json`);
  console.error("run: node scripts/sync-claude-agents.mjs");
  process.exit(1);
}

console.log(check ? `.claude/agents is in sync (${shipped.length} agents)` : `synced ${shipped.length} agents into .claude/agents`);
