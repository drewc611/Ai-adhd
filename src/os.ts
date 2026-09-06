// The ADHD kernel. A scheduler over run directories, driven entirely by hosts that claim
// tasks and return artifacts. It never calls a model (D2). It never spawns anything. It
// owns state, leases, phase advancement, the D5 gate, and cancellation with partial results.
//
// Process model:
//   run           = a run directory (a process). States below.
//   task          = one thing a host must do: spawn an agent with a brief and return its
//                   final message. Tasks are leased to workers and re-queued on expiry.
//   syscalls      = submit, confirm, claim, return, status, result, cancel, list, reap.
//
// State lives on disk: <root>/<run_id>/os.json and <root>/journal.jsonl. Writes are atomic
// (tmp + rename) and serialised through a directory lock so several hosts can share a root.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "./config.js";
import { compile, previewText } from "./compile.js";
import { parseDecision } from "./validate.js";
import { loadPlan, phaseCritique, phaseDeepen, phaseSynth, type PhaseResult } from "./run.js";
import { ContractError, HashMismatch, RunAbort } from "./errors.js";
import { problemHash } from "./hash.js";

export const RUN_STATES = [
  "awaiting_confirm", // D5 gate: preview shown, nothing spent
  "diverge", // branch tasks pending or leased
  "critique_a", // pass A task pending or leased
  "critique_b", // pass B task pending or leased
  "deepen", // deepen tasks pending or leased
  "done", // synthesis rendered
  "done_run_level", // synthesis rendered after monoculture/scatter refused deepen
  "cancelled", // partial synthesis rendered
  "aborted", // hash mismatch, contract failure, or too many lease expiries
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const TaskSchema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    phase: z.enum(["diverge", "critique_a", "critique_b", "deepen"]),
    agent: z.string(),
    label: z.string(),
    brief_path: z.string(),
    artifact_path: z.string(),
    /** Pass B must go to the subagent that did pass A. The host maps ids to live agents. */
    continues: z.string().nullable(),
    status: z.enum(["pending", "leased", "done", "dropped"]),
    worker: z.string().nullable(),
    leased_at: z.string().nullable(),
    lease_until: z.string().nullable(),
    attempts: z.number().int(),
    returned_at: z.string().nullable(),
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;

export const RunRecordSchema = z
  .object({
    run_id: z.string(),
    state: z.enum(RUN_STATES),
    problem_hash: z.string(),
    problem_class: z.string(),
    n: z.number().int(),
    seed: z.number().int(),
    submitted_by: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    confirmed_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    estimate_tokens: z.number().int(),
    tasks: z.array(TaskSchema),
    reason: z.string().nullable(),
    /** Last phase output text, for status. */
    last_phase_text: z.string().nullable(),
  })
  .strict();
export type RunRecord = z.infer<typeof RunRecordSchema>;

export interface KernelOptions {
  root: string;
  leaseSeconds?: number;
  maxAttempts?: number;
  now?: () => Date;
}

export interface ClaimedTask extends Task {
  brief: string;
  problem_hash: string;
}

const RUN_DIR_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

export class Kernel {
  readonly root: string;
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(private readonly cfg: Config, opts: KernelOptions) {
    this.root = resolve(opts.root);
    this.leaseSeconds = opts.leaseSeconds ?? 900;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.now = opts.now ?? (() => new Date());
    mkdirSync(this.root, { recursive: true });
  }

  // ---- locking and persistence ------------------------------------------------------------

  private withLock<T>(fn: () => T): T {
    const lock = join(this.root, ".lock");
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        // Stale lock from a crashed process: older than 30s.
        try {
          if (Date.now() - statSync(lock).mtimeMs > 30_000) rmdirSync(lock);
        } catch {
          /* raced; retry */
        }
        if (Date.now() > deadline) throw new RunAbort("kernel lock held for more than 10s", "LOCK_TIMEOUT");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try {
      return fn();
    } finally {
      try {
        rmdirSync(lock);
      } catch {
        /* already gone */
      }
    }
  }

  private recordPath(runId: string) {
    return join(this.root, runId, "os.json");
  }

  private load(runId: string): RunRecord {
    if (!RUN_DIR_RE.test(runId)) throw new ContractError("kernel", [`bad run id ${runId}`]);
    const p = this.recordPath(runId);
    if (!existsSync(p)) throw new RunAbort(`no such run ${runId}`, "NO_RUN");
    const r = RunRecordSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
    if (!r.success) throw new RunAbort(`os.json for ${runId} is corrupt: ${r.error.message}`, "BAD_RECORD");
    return r.data;
  }

  private save(rec: RunRecord) {
    rec.updated_at = this.now().toISOString();
    const p = this.recordPath(rec.run_id);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
    renameSync(tmp, p);
  }

  private journal(event: string, data: Record<string, unknown>) {
    appendFileSync(join(this.root, "journal.jsonl"), JSON.stringify({ at: this.now().toISOString(), event, ...data }) + "\n");
  }

  private runDir(runId: string) {
    return join(this.root, runId);
  }

  // ---- syscalls -----------------------------------------------------------------------

  /** D5: compile and show the bill. Nothing is spent until confirm. */
  submit(problem: string, decisionRaw: unknown, opts: { by?: string; seed?: number; confirmed?: boolean; runId?: string } = {}) {
    return this.withLock(() => {
      const decision = parseDecision(this.cfg, decisionRaw);
      const result = compile(this.cfg, problem, decision, { seed: opts.seed, runId: opts.runId });
      if (result.kind === "declined") {
        this.journal("declined", { problem_hash: result.problem_hash, problem_class: result.problem_class });
        return { kind: "declined" as const, reason: result.reason, problem_hash: result.problem_hash, preview: previewText(result) };
      }
      const { plan, briefs } = result;
      const dir = this.runDir(plan.run_id);
      if (existsSync(dir)) throw new ContractError("submit", [`run ${plan.run_id} already exists`]);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "problem.txt"), Buffer.from(problem, "utf8"));
      writeFileSync(join(dir, "decision.json"), JSON.stringify(decision, null, 2) + "\n");
      writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
      for (const b of briefs) {
        const pb = plan.branches.find((x) => x.frame === b.frame)!;
        mkdirSync(join(dir, pb.brief_path, ".."), { recursive: true });
        writeFileSync(join(dir, pb.brief_path), b.text);
        mkdirSync(join(dir, pb.artifact_path, ".."), { recursive: true });
      }
      mkdirSync(join(dir, "critic"), { recursive: true });
      mkdirSync(join(dir, "deepen"), { recursive: true });
      const ts = this.now().toISOString();
      const rec: RunRecord = {
        run_id: plan.run_id,
        state: "awaiting_confirm",
        problem_hash: plan.problem_hash,
        problem_class: plan.problem_class,
        n: plan.n,
        seed: plan.seed,
        submitted_by: opts.by ?? null,
        created_at: ts,
        updated_at: ts,
        confirmed_at: null,
        finished_at: null,
        estimate_tokens: plan.estimate.tokens_total,
        tasks: [],
        reason: null,
        last_phase_text: null,
      };
      this.save(rec);
      this.journal("submitted", { run_id: rec.run_id, problem_hash: rec.problem_hash, n: rec.n, estimate_tokens: rec.estimate_tokens, by: opts.by ?? null });
      if (opts.confirmed) this.confirmLocked(rec);
      return { kind: "plan" as const, run_id: rec.run_id, state: rec.state, preview: previewText(result), estimate_tokens: rec.estimate_tokens };
    });
  }

  /** The user said yes. Branch tasks become claimable. */
  confirm(runId: string) {
    return this.withLock(() => {
      const rec = this.load(runId);
      if (rec.state !== "awaiting_confirm") throw new ContractError("confirm", [`run ${runId} is ${rec.state}, not awaiting_confirm`]);
      this.confirmLocked(rec);
      return this.summary(rec);
    });
  }

  private confirmLocked(rec: RunRecord) {
    const plan = loadPlan(this.runDir(rec.run_id));
    rec.tasks = plan.branches.map((b) => this.newTask(rec.run_id, "diverge", b.agent, b.frame, b.brief_path, b.artifact_path, null));
    rec.state = "diverge";
    rec.confirmed_at = this.now().toISOString();
    this.save(rec);
    this.journal("confirmed", { run_id: rec.run_id, tasks: rec.tasks.length });
  }

  private newTask(runId: string, phase: Task["phase"], agent: string, label: string, briefPath: string, artifactPath: string, continues: string | null): Task {
    return {
      id: `${runId}:${phase}:${label}`,
      run_id: runId,
      phase,
      agent,
      label,
      brief_path: briefPath,
      artifact_path: artifactPath,
      continues,
      status: "pending",
      worker: null,
      leased_at: null,
      lease_until: null,
      attempts: 0,
      returned_at: null,
    };
  }

  /** Hand the oldest pending task to a worker under a lease. Null when nothing is claimable. */
  claim(worker: string, opts: { runId?: string } = {}): ClaimedTask | null {
    return this.withLock(() => {
      this.reapLocked();
      const runs = opts.runId ? [this.load(opts.runId)] : this.listLocked().filter((r) => ["diverge", "critique_a", "critique_b", "deepen"].includes(r.state));
      for (const rec of runs.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        const task = rec.tasks.find((t) => t.status === "pending");
        if (!task) continue;
        const now = this.now();
        task.status = "leased";
        task.worker = worker;
        task.leased_at = now.toISOString();
        task.lease_until = new Date(now.getTime() + this.leaseSeconds * 1000).toISOString();
        task.attempts += 1;
        this.save(rec);
        this.journal("claimed", { run_id: rec.run_id, task: task.id, worker, attempt: task.attempts });
        const brief = readFileSync(join(this.runDir(rec.run_id), task.brief_path), "utf8");
        return { ...task, brief, problem_hash: rec.problem_hash };
      }
      return null;
    });
  }

  /** A worker returns a subagent's final message. The kernel writes it and advances the run. */
  return_(taskId: string, output: string, worker?: string) {
    return this.withLock(() => {
      const runId = taskId.split(":")[0]!;
      const rec = this.load(runId);
      const task = rec.tasks.find((t) => t.id === taskId);
      if (!task) throw new ContractError("return", [`no task ${taskId}`]);
      if (task.status !== "leased") throw new ContractError("return", [`task ${taskId} is ${task.status}, not leased`]);
      if (worker && task.worker !== worker) throw new ContractError("return", [`task ${taskId} is leased to ${task.worker}, not ${worker}`]);
      writeFileSync(join(this.runDir(runId), task.artifact_path), output);
      task.status = "done";
      task.returned_at = this.now().toISOString();
      this.save(rec);
      this.journal("returned", { run_id: runId, task: taskId, bytes: Buffer.byteLength(output) });
      this.advanceLocked(rec);
      return this.summary(rec);
    });
  }

  /** D5: stop spending. Whatever branches returned are rendered unscored. */
  cancel(runId: string, reason = "cancelled by user") {
    return this.withLock(() => {
      const rec = this.load(runId);
      if (["done", "done_run_level", "cancelled", "aborted"].includes(rec.state)) return this.summary(rec);
      for (const t of rec.tasks) if (t.status === "pending" || t.status === "leased") t.status = "dropped";
      const wasConfirmed = rec.confirmed_at !== null;
      rec.state = "cancelled";
      rec.reason = reason;
      rec.finished_at = this.now().toISOString();
      if (wasConfirmed) {
        try {
          const r = phaseSynth(this.cfg, this.runDir(runId), { partial: true });
          rec.last_phase_text = r.text;
        } catch (e) {
          rec.last_phase_text = `partial synthesis failed: ${(e as Error).message}`;
        }
      } else rec.last_phase_text = "cancelled before confirm; nothing was spent";
      this.save(rec);
      this.journal("cancelled", { run_id: runId, reason });
      return this.summary(rec);
    });
  }

  status(runId: string) {
    return this.withLock(() => {
      this.reapLocked();
      return this.summary(this.load(runId));
    });
  }

  /** The synthesis, when there is one. */
  result(runId: string): { state: RunState; synthesis: string | null; reason: string | null } {
    const rec = this.withLock(() => this.load(runId));
    const p = join(this.runDir(runId), "synthesis.md");
    return { state: rec.state, synthesis: existsSync(p) ? readFileSync(p, "utf8") : null, reason: rec.reason };
  }

  list() {
    return this.withLock(() => {
      this.reapLocked();
      return this.listLocked().map((r) => this.summary(r));
    });
  }

  /** Expire leases. Public so a cron can call it; also runs on every claim/status/list. */
  reap() {
    return this.withLock(() => this.reapLocked());
  }

  // ---- internals --------------------------------------------------------------------------

  private listLocked(): RunRecord[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((d) => RUN_DIR_RE.test(d) && existsSync(this.recordPath(d)))
      .map((d) => this.load(d));
  }

  private reapLocked(): { expired: string[]; aborted: string[] } {
    const now = this.now().getTime();
    const expired: string[] = [];
    const aborted: string[] = [];
    for (const rec of this.listLocked()) {
      let changed = false;
      for (const t of rec.tasks) {
        if (t.status !== "leased" || !t.lease_until) continue;
        if (Date.parse(t.lease_until) > now) continue;
        changed = true;
        if (t.attempts >= this.maxAttempts) {
          t.status = "dropped";
          rec.state = "aborted";
          rec.reason = `task ${t.id} expired ${t.attempts} times`;
          rec.finished_at = this.now().toISOString();
          aborted.push(rec.run_id);
          this.journal("aborted", { run_id: rec.run_id, reason: rec.reason });
        } else {
          t.status = "pending";
          t.worker = null;
          t.leased_at = null;
          t.lease_until = null;
          expired.push(t.id);
          this.journal("lease_expired", { run_id: rec.run_id, task: t.id, attempts: t.attempts });
        }
      }
      if (changed) this.save(rec);
    }
    return { expired, aborted };
  }

  /** When every task of the current phase is done, run the next phase and mint its tasks. */
  private advanceLocked(rec: RunRecord) {
    const phaseTasks = rec.tasks.filter((t) => t.phase === rec.state);
    if (phaseTasks.some((t) => t.status !== "done")) return;
    const dir = this.runDir(rec.run_id);
    try {
      let r: PhaseResult;
      switch (rec.state) {
        case "diverge": {
          r = phaseCritique(this.cfg, dir); // validates artifacts, writes pass A brief
          const n = r.next![0]!;
          rec.tasks.push(this.newTask(rec.run_id, "critique_a", n.agent, "pass-a", rel(dir, n.brief), rel(dir, n.artifact), null));
          rec.state = "critique_a";
          break;
        }
        case "critique_a": {
          r = phaseCritique(this.cfg, dir); // validates pass A, writes pass B brief
          const n = r.next![0]!;
          const a = rec.tasks.find((t) => t.phase === "critique_a")!;
          rec.tasks.push(this.newTask(rec.run_id, "critique_b", n.agent, "pass-b", rel(dir, n.brief), rel(dir, n.artifact), a.id));
          rec.state = "critique_b";
          break;
        }
        case "critique_b": {
          phaseCritique(this.cfg, dir); // validates pass B
          r = phaseDeepen(this.cfg, dir);
          if (r.exitCode === 2) {
            // Monoculture or scatter. Render what exists and stop.
            const s = phaseSynth(this.cfg, dir);
            rec.state = "done_run_level";
            rec.reason = r.text;
            rec.finished_at = this.now().toISOString();
            rec.last_phase_text = s.text;
            this.journal("done_run_level", { run_id: rec.run_id });
            break;
          }
          for (const n of r.next ?? []) {
            const frame = n.brief.match(/([A-Z_]+)\.brief\.md$/)![1]!;
            rec.tasks.push(this.newTask(rec.run_id, "deepen", n.agent, frame, rel(dir, n.brief), rel(dir, n.artifact), null));
          }
          rec.state = "deepen";
          break;
        }
        case "deepen": {
          r = phaseSynth(this.cfg, dir);
          rec.state = "done";
          rec.finished_at = this.now().toISOString();
          rec.last_phase_text = r.text;
          this.journal("done", { run_id: rec.run_id });
          break;
        }
        default:
          return;
      }
      if (rec.state !== "done" && rec.state !== "done_run_level") rec.last_phase_text = r!.text;
      this.save(rec);
      this.journal("advanced", { run_id: rec.run_id, state: rec.state, pending: rec.tasks.filter((t) => t.status === "pending").length });
    } catch (e) {
      // Hash mismatch, contract failure, or a phase that refused: the run is over. Never silent.
      const code = e instanceof HashMismatch ? "HASH_MISMATCH" : e instanceof RunAbort ? e.code : e instanceof ContractError ? "CONTRACT" : "ERROR";
      rec.state = "aborted";
      rec.reason = `${code}: ${(e as Error).message}`;
      rec.finished_at = this.now().toISOString();
      for (const t of rec.tasks) if (t.status === "pending" || t.status === "leased") t.status = "dropped";
      this.save(rec);
      this.journal("aborted", { run_id: rec.run_id, reason: rec.reason });
    }
  }

  summary(rec: RunRecord) {
    const count = (s: Task["status"]) => rec.tasks.filter((t) => t.status === s).length;
    return {
      run_id: rec.run_id,
      state: rec.state,
      problem_class: rec.problem_class,
      problem_hash: rec.problem_hash,
      n: rec.n,
      seed: rec.seed,
      estimate_tokens: rec.estimate_tokens,
      created_at: rec.created_at,
      updated_at: rec.updated_at,
      finished_at: rec.finished_at,
      tasks: { pending: count("pending"), leased: count("leased"), done: count("done"), dropped: count("dropped") },
      reason: rec.reason,
      last_phase_text: rec.last_phase_text,
    };
  }
}

function rel(dir: string, abs: string): string {
  return abs.startsWith(dir) ? abs.slice(dir.length + 1) : abs;
}

/** Convenience for CLI and MCP: a kernel rooted at $ADHD_OS_ROOT or ./runs. */
export function openKernel(cfg: Config, root?: string, opts: Omit<KernelOptions, "root"> = {}): Kernel {
  return new Kernel(cfg, { root: root ?? process.env.ADHD_OS_ROOT ?? "runs", ...opts });
}

export { problemHash };
