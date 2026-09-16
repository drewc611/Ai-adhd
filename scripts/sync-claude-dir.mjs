#!/usr/bin/env node
/**
 * Mirror what `plugin.json` ships into `.claude/`, so a session opened on a clone can reach it.
 *
 * `agents/` and `skills/` are the source of truth and stay that way: doctor, the tests and
 * `plugin.json` all read them. But both are plugin paths, read only where the plugin is enabled,
 * and D42 found that a session opened straight on this repository enables nothing. Claude Code
 * resolves project agents from `.claude/agents/` and project skills from `.claude/skills/`, both
 * of which outrank a plugin's own copies, so the shipped definitions are copied there.
 *
 * D44 is the second half. D42 mirrored the agents and stopped, which left the run dispatchable and
 * undrivable: `/adhd` is the procedure that spawns the agents, and it was still plugin-only.
 *
 * `--check` fails on drift instead of writing, which is what CI runs.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"));

const drifted = [];
const stale = [];

/** One mirrored tree: `from` is the plugin path, `to` is the `.claude/` path a session reads. */
function mirror(from, to, files) {
  const dest = join(root, ".claude", to);
  mkdirSync(dest, { recursive: true });
  for (const [rel, src] of files) {
    const want = readFileSync(src, "utf8");
    const at = join(dest, rel);
    mkdirSync(dirname(at), { recursive: true });
    const have = existsSync(at) ? readFileSync(at, "utf8") : null;
    if (have === want) continue;
    drifted.push(`${to}/${rel}`);
    if (!check) writeFileSync(at, want);
  }
  const keep = new Set(files.map(([rel]) => rel));
  for (const name of readdirSync(dest)) {
    const owned = [...keep].some((k) => k === name || k.startsWith(`${name}/`));
    if (owned) continue;
    stale.push(`${to}/${name}`);
    if (!check) rmSync(join(dest, name), { recursive: true });
  }
  return from;
}

mirror(
  "agents",
  "agents",
  manifest.agents.map((a) => {
    const rel = a.replace(/^\.\/agents\//, "");
    return [rel, join(root, "agents", rel)];
  }),
);

mirror(
  "skills",
  "skills",
  manifest.skills.map((s) => {
    const name = s.replace(/^\.\/skills\//, "");
    return [`${name}/SKILL.md`, join(root, "skills", name, "SKILL.md")];
  }),
);

if (check && (drifted.length || stale.length)) {
  for (const f of drifted) console.error(`.claude/${f} does not match the copy plugin.json ships`);
  for (const f of stale) console.error(`.claude/${f} is not shipped by plugin.json`);
  console.error("run: node scripts/sync-claude-dir.mjs");
  process.exit(1);
}

const n = manifest.agents.length + manifest.skills.length;
console.log(check ? `.claude is in sync (${n} definitions)` : `synced ${n} definitions into .claude`);
