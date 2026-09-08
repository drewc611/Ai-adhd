/**
 * Sandboxes: a stage that writes code gets its own tree, and nothing it wrote lands without a diff.
 *
 * This is a filesystem sandbox, not a security boundary, and the distinction is the first thing to
 * be clear about. It does not contain a hostile process — a stage with Bash can walk out of any
 * directory this module creates. What it does is make an *honest* stage's work reviewable and
 * revertible: the changes are in one place, `diff` shows them, and `promote` is the only path back
 * into the working tree.
 *
 * That is the useful property for a harness that runs for an hour. The failure it prevents is not
 * malice, it is a build stage that got most of the way there and left the repository in a state
 * nobody can reconstruct.
 *
 * Copy rather than a git worktree. A worktree is faster and shares the object store, and it also
 * requires the source to be a clean git repository at a commit — which is exactly what a mission
 * running on a dirty tree does not have. Copying works either way, and the mission's own budget
 * is what stops it being done to a 40GB directory.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { ContractError } from "../errors.js";
import type { SandboxPolicy } from "./mission.js";

/** Never copied in. Each is either enormous, regenerable, or both. */
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", "__pycache__", ".venv", ".pytest_cache", "corpora", "models"]);

export interface SandboxInfo {
  root: string;
  source: string;
  files: number;
  bytes: number;
  created_at: string;
}

export interface FileChange {
  path: string;
  change: "added" | "modified" | "removed";
  bytes: number;
}

const digest = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

function walk(root: string, base = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (SKIP.has(name)) continue;
    const p = join(root, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, base));
    else if (st.isFile()) out.push(relative(base, p));
  }
  return out;
}

/**
 * Is `candidate` inside `parent`? Resolved and separator-terminated, because a prefix comparison
 * on raw strings says `/tmp/sandbox-2` is inside `/tmp/sandbox`, and that is the check standing
 * between a stage's write and the rest of the disk.
 */
export function contains(parent: string, candidate: string): boolean {
  const p = resolve(parent);
  const c = resolve(candidate);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

export class Sandbox {
  constructor(readonly root: string, readonly policy: SandboxPolicy) {}

  static create(root: string, source: string, policy: SandboxPolicy): { sandbox: Sandbox; info: SandboxInfo } {
    if (!existsSync(source)) throw new ContractError("sandbox", [`source ${source} does not exist`]);
    if (contains(source, root)) throw new ContractError("sandbox", [`sandbox ${root} is inside its own source ${source}; the copy would recurse`]);
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    cpSync(source, root, { recursive: true, filter: (src) => !SKIP.has(relative(source, src).split(sep)[0] ?? "") && !SKIP.has(src.split(sep).pop() ?? "") });

    const files = walk(root);
    const info: SandboxInfo = {
      root,
      source,
      files: files.length,
      bytes: files.reduce((n, f) => n + statSync(join(root, f)).size, 0),
      created_at: new Date().toISOString(),
    };
    writeFileSync(join(root, ".adhd-sandbox.json"), JSON.stringify({ ...info, policy }, null, 2) + "\n");
    return { sandbox: new Sandbox(root, policy), info };
  }

  /**
   * Would the policy allow writing here? Two independent reasons to say no, and both are checked
   * because they fail differently: outside the sandbox is a bug in the caller, and outside the
   * writable list is a stage doing more than its brief asked for.
   */
  mayWrite(path: string): string | null {
    const abs = resolve(this.root, path);
    if (!contains(this.root, abs)) return `${path} resolves outside the sandbox`;
    if (!this.policy.writable.length) return null;
    const rel = relative(this.root, abs);
    return this.policy.writable.some((w) => rel === w || rel.startsWith(w.endsWith("/") ? w : w + "/"))
      ? null
      : `${rel} is not under any of the writable paths (${this.policy.writable.join(", ")})`;
  }

  /**
   * What changed against the source, by content hash rather than mtime. `cpSync` does not preserve
   * mtimes reliably across filesystems, so an mtime comparison reports the whole tree as modified
   * on some machines and nothing on others.
   */
  diff(): FileChange[] {
    const info = JSON.parse(readFileSync(join(this.root, ".adhd-sandbox.json"), "utf8")) as SandboxInfo;
    const before = new Set(walk(info.source));
    const after = new Set(walk(this.root).filter((f) => f !== ".adhd-sandbox.json"));
    const out: FileChange[] = [];
    for (const f of after) {
      const dst = join(this.root, f);
      if (!before.has(f)) out.push({ path: f, change: "added", bytes: statSync(dst).size });
      else if (digest(join(info.source, f)) !== digest(dst)) out.push({ path: f, change: "modified", bytes: statSync(dst).size });
    }
    for (const f of before) if (!after.has(f)) out.push({ path: f, change: "removed", bytes: 0 });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Run one of the allowlisted commands inside the sandbox.
   *
   * The allowlist is matched on the whole command string, not a prefix. Prefix matching on `npm`
   * lets `npm test && curl evil` through, and a verify stage runs whatever its brief said.
   */
  run(command: string, timeoutMs = 600_000): { code: number; stdout: string; stderr: string } {
    if (!this.policy.commands.includes(command))
      throw new ContractError("sandbox", [`command ${JSON.stringify(command)} is not in the policy allowlist (${this.policy.commands.join("; ") || "empty"})`]);
    try {
      const stdout = execFileSync("/bin/sh", ["-c", command], {
        cwd: this.root,
        timeout: timeoutMs,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ADHD_SANDBOX: this.root },
      });
      return { code: 0, stdout, stderr: "" };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string; message: string };
      return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message };
    }
  }

  /**
   * Copy the sandbox's changes back over the source. Never automatic and never partial-on-error:
   * every path is checked against the policy first, so a promote that would touch something the
   * stage was not allowed to write fails having moved nothing.
   */
  promote(opts: { dryRun?: boolean } = {}): { promoted: FileChange[]; refused: string[] } {
    const info = JSON.parse(readFileSync(join(this.root, ".adhd-sandbox.json"), "utf8")) as SandboxInfo;
    const changes = this.diff();
    const refused = changes.map((c) => this.mayWrite(c.path)).filter((x): x is string => x !== null);
    if (refused.length) return { promoted: [], refused };
    if (opts.dryRun) return { promoted: changes, refused: [] };
    for (const c of changes) {
      const dst = join(info.source, c.path);
      if (c.change === "removed") rmSync(dst, { force: true });
      else {
        mkdirSync(join(dst, ".."), { recursive: true });
        cpSync(join(this.root, c.path), dst);
      }
    }
    return { promoted: changes, refused: [] };
  }

  destroy(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
