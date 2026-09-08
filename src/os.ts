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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "./config.js";
import { compile, previewText } from "./compile.js";
import { parseDecision, unfence } from "./validate.js";
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

/** States with work a host can do. A run outside this set has no claimable or returnable task. */
export const ACTIVE_STATES = ["diverge", "critique_a", "critique_b", "deepen"] as const satisfies readonly RunState[];
/** States a run never leaves. Reached once, and nothing may be claimed, returned or cancelled. */
export const TERMINAL_STATES = ["done", "done_run_level", "cancelled", "aborted"] as const satisfies readonly RunState[];

const isActive = (s: RunState): boolean => (ACTIVE_STATES as readonly RunState[]).includes(s);
const isTerminal = (s: RunState): boolean => (TERMINAL_STATES as readonly RunState[]).includes(s);

export const TaskSchema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    phase: z.enum(["diverge", "critique_a", "critique_b", "deepen"]),
    agent: z.string(),
    label: z.string(),
    brief_path: z.string(),
    artifact_path: z.string(),
    /** Pass B should go to the subagent that did pass A. The host maps ids to live agents. */
    continues: z.string().nullable(),
    /** The worker that returned the predecessor. Only it may claim this task until others_after. */
    prefer_worker: z.string().nullable(),
    /** After this instant any worker may claim the task and run it as a fresh agent. */
    others_after: z.string().nullable(),
    /** Token usage the worker reported on return, if any. */
    tokens: z.number().int().nullable(),
    /**
     * `dropped` is a task the run no longer needs: cancelled, or outstanding when the run ended.
     * `dead` is a task that was tried `maxAttempts` times and never came back. The two used to
     * be one value, so a run that died because one task could not be completed looked exactly
     * like a run somebody cancelled, and the journal was the only place the difference survived.
     */
    status: z.enum(["pending", "leased", "done", "dropped", "dead"]),
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

/**
 * Lease length. A number applies to every phase; a map sets it per phase and falls back to
 * `default` for anything unnamed.
 *
 * Per-phase exists because the phases are not alike and `adhd os stats` says so: over five
 * recorded runs the mean `critique_b` task took 244s against 108s for `deepen`, and the longest
 * anything has taken is 280s. One number covering all four is either too short for the critic
 * or wasteful for the rest, and a lease that is too short hands live work to a second subagent.
 */
export type LeaseSpec = number | ({ default: number } & Partial<Record<Task["phase"], number>>);

export interface KernelOptions {
  root: string;
  leaseSeconds?: LeaseSpec;
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
  readonly leaseSeconds: LeaseSpec;
  readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(private readonly cfg: Config, opts: KernelOptions) {
    this.root = resolve(opts.root);
    this.leaseSeconds = opts.leaseSeconds ?? 900;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.now = opts.now ?? (() => new Date());
    mkdirSync(this.root, { recursive: true });
  }

  /** Seconds this phase's lease runs for. A bare number applies everywhere. */
  leaseFor(phase: Task["phase"]): number {
    return typeof this.leaseSeconds === "number" ? this.leaseSeconds : (this.leaseSeconds[phase] ?? this.leaseSeconds.default);
  }

  // ---- locking and persistence ------------------------------------------------------------

  /** No critical section here does network or model work, so anything this old is dead. */
  private static readonly LOCK_STALE_MS = 120_000;

  /**
   * Is the process that stamped this lock still running? Only meaningful on the machine that
   * wrote it, so the hostname is recorded and checked. EPERM means alive but not ours.
   */
  private static ownerAlive(owner: { pid: number; host: string } | null): boolean | null {
    if (!owner || owner.host !== hostname()) return null;
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  /**
   * Whole-root mutex. `mkdir` is atomic, so acquisition is safe; breaking a held lock is the
   * dangerous part. Breaking on age alone is a real race: a holder that is merely slow, on a
   * loaded box or a paused container, gets its lock stolen and two processes then run inside
   * it at once. So a lock is broken only when its owning process is known dead, or when it is
   * old enough that nothing legitimate could still be holding it. Every break is journalled,
   * because a broken lock is the kind of event that explains a corrupted run an hour later.
   */
  private withLock<T>(fn: () => T): T {
    const lock = join(this.root, ".lock");
    const ownerFile = join(lock, "owner.json");
    const deadline = Date.now() + 10_000;
    // Identifies this acquisition, not this process: a process that acquires, loses the lock to
    // a break, and acquires again must not mistake the older stamp for its own.
    const token = randomUUID();
    for (;;) {
      try {
        mkdirSync(lock);
        writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString(), token }));
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        let owner: { pid: number; host: string } | null = null;
        try {
          owner = JSON.parse(readFileSync(ownerFile, "utf8")) as { pid: number; host: string };
        } catch {
          /* being written right now, or written by an older version; fall back to age */
        }
        const alive = Kernel.ownerAlive(owner);
        let ageMs = 0;
        try {
          ageMs = Date.now() - statSync(lock).mtimeMs;
        } catch {
          continue; // vanished under us; retry the mkdir
        }
        const deadOwner = alive === false;
        const tooOld = ageMs > Kernel.LOCK_STALE_MS;
        if (deadOwner || tooOld) {
          try {
            rmSync(lock, { recursive: true, force: true });
            this.journal("lock_broken", { reason: deadOwner ? "owner process is gone" : `held ${Math.round(ageMs / 1000)}s`, owner });
          } catch {
            /* raced with the owner releasing it; retry */
          }
        }
        if (Date.now() > deadline) throw new RunAbort("kernel lock held for more than 10s", "LOCK_TIMEOUT");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try {
      return fn();
    } finally {
      // Acquisition guards against breaking a lock somebody still holds. Release has to guard
      // the mirror image: this process may itself be the slow holder whose lock was broken on
      // age while it worked, and the directory now sitting there belongs to whoever acquired
      // after the break. Removing it unconditionally would evict them and let a third process
      // in while they are still inside, which is the exact race the break rules exist to avoid.
      // So release only what still carries this acquisition's token.
      let mine = false;
      try {
        mine = (JSON.parse(readFileSync(ownerFile, "utf8")) as { token?: string }).token === token;
      } catch {
        /* lock or owner file already gone; nothing of ours to release */
      }
      if (mine) {
        try {
          rmSync(lock, { recursive: true, force: true });
        } catch {
          /* already gone */
        }
      } else if (existsSync(lock)) {
        this.journal("lock_lost", { note: "this lock was broken and re-acquired by another holder while we worked" });
      }
    }
  }

  /**
   * Does this artifact answer the task it was returned for? Compares the labels the artifact
   * declares about itself against what the task asked for. A parse failure is not decided here:
   * the phase validator reports malformed YAML far better than this can.
   */
  private static misdirected(task: Task, text: string): string[] {
    let doc: unknown;
    try {
      doc = parseYaml(text);
    } catch {
      return [];
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
    const d = doc as Record<string, unknown>;
    const problems: string[] = [];
    if (typeof d.frame === "string" && (task.phase === "diverge" || task.phase === "deepen") && d.frame !== task.label)
      problems.push(`task ${task.id} asked for frame ${task.label} but the artifact declares frame ${d.frame}; a worker returned one subagent's output under another's task`);
    const wantPass = task.phase === "critique_a" ? "A" : task.phase === "critique_b" ? "B" : null;
    if (wantPass && typeof d.pass === "string" && d.pass.toUpperCase() !== wantPass)
      problems.push(`task ${task.id} is critic pass ${wantPass} but the artifact declares pass ${d.pass}`);
    return problems;
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
      prefer_worker: null,
      others_after: null,
      tokens: null,
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
      // Draining: outstanding leases run to completion, nothing new is handed out. A host that
      // wants to stop the kernel without killing live subagents has no other way to do it —
      // cancelling would drop work that is already paid for and still in flight.
      if (this.draining()) return null;
      // The state filter belongs on both paths. Naming a run explicitly used to skip it, so a
      // host that tracked its own run id could be handed a task from a run that was already
      // cancelled, aborted or still sitting at the D5 gate — spending a subagent on a decision
      // the user had declined or the kernel had already given up on.
      const runs = (opts.runId ? [this.load(opts.runId)] : this.listLocked()).filter((r) => isActive(r.state));
      const nowMs = this.now().getTime();
      for (const rec of runs.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        const task = rec.tasks.find(
          (t) => t.status === "pending" && (t.prefer_worker === null || t.prefer_worker === worker || (t.others_after !== null && Date.parse(t.others_after) <= nowMs)),
        );
        if (!task) continue;
        const now = this.now();
        task.status = "leased";
        task.worker = worker;
        task.leased_at = now.toISOString();
        task.lease_until = new Date(now.getTime() + this.leaseFor(task.phase) * 1000).toISOString();
        task.attempts += 1;
        this.save(rec);
        this.journal("claimed", { run_id: rec.run_id, task: task.id, worker, attempt: task.attempts });
        const brief = readFileSync(join(this.runDir(rec.run_id), task.brief_path), "utf8");
        // A continuation claimed by a different worker runs as a fresh agent: the pass B brief
        // carries the pass A scores, so a fresh critic can do it; the preference was a saving.
        const continues = task.continues && task.prefer_worker === worker ? task.continues : null;
        return { ...task, continues, brief, problem_hash: rec.problem_hash };
      }
      return null;
    });
  }

  /** A worker returns a subagent's final message. The kernel writes it and advances the run. */
  return_(taskId: string, output: string, worker?: string, tokens?: number) {
    return this.withLock(() => {
      const runId = taskId.split(":")[0]!;
      const rec = this.load(runId);
      // A terminal run has no work left to accept. Said before the task lookup so the error
      // names the reason a host actually needs — the run ended — rather than the symptom.
      if (isTerminal(rec.state)) throw new ContractError("return", [`run ${runId} is ${rec.state}${rec.reason ? ` (${rec.reason})` : ""}; it accepts no more work`]);
      const task = rec.tasks.find((t) => t.id === taskId);
      if (!task) throw new ContractError("return", [`no task ${taskId}`]);
      if (task.status !== "leased") throw new ContractError("return", [`task ${taskId} is ${task.status}, not leased`]);
      // An omitted worker id used to skip this check entirely, so any process could return a
      // task it did not hold. A lease means one subagent owns one brief; returning someone
      // else's work silently breaks that, so the id is required whenever a lease names one.
      if (task.worker && !worker) throw new ContractError("return", [`task ${taskId} is leased to ${task.worker}; pass that worker id to return it`]);
      if (worker && task.worker !== worker) throw new ContractError("return", [`task ${taskId} is leased to ${task.worker}, not ${worker}`]);
      // The artifact file holds the YAML the phase will parse. If the worker's message carried
      // anything outside the fence (a sources line, a sign off), the message is kept whole
      // beside it so nothing a subagent said is lost.
      const clean = unfence(output);
      // A worker holds several subagents at once and maps task ids to them. One wrong entry in
      // that map returns the right YAML under the wrong task, and the artifact lands in another
      // frame's file. Nothing downstream can catch it: the run keeps going and attributes a
      // position to a frame that never held it, which is the one thing the isolation contract
      // is supposed to guarantee. The task knows what it asked for, so check it here.
      for (const p of Kernel.misdirected(task, clean)) throw new ContractError("return", [p]);
      writeFileSync(join(this.runDir(runId), task.artifact_path), clean.endsWith("\n") ? clean : clean + "\n");
      if (clean !== output) writeFileSync(join(this.runDir(runId), task.artifact_path + ".raw.md"), output);
      task.status = "done";
      task.returned_at = this.now().toISOString();
      if (tokens !== undefined && Number.isFinite(tokens)) task.tokens = Math.round(tokens);
      this.save(rec);
      this.journal("returned", { run_id: runId, task: taskId, bytes: Buffer.byteLength(output), tokens: task.tokens });
      this.advanceLocked(rec);
      return this.summary(rec);
    });
  }

  /** D5: stop spending. Whatever branches returned are rendered unscored. */
  cancel(runId: string, reason = "cancelled by user") {
    return this.withLock(() => {
      const rec = this.load(runId);
      if (isTerminal(rec.state)) return this.summary(rec);
      for (const t of rec.tasks) if (t.status === "pending" || t.status === "leased") t.status = "dropped";
      const wasConfirmed = rec.confirmed_at !== null;
      rec.state = "cancelled";
      rec.reason = reason;
      rec.finished_at = this.now().toISOString();
      if (wasConfirmed) {
        try {
          this.writeCost(rec);
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
    // The record and the file it describes are read together. Reading the record under the lock
    // and the file outside it returns a state from before a concurrent cancel and a synthesis
    // from after: the caller is told the run is still deepening and handed a partial rendering.
    return this.withLock(() => {
      const rec = this.load(runId);
      const p = join(this.runDir(runId), "synthesis.md");
      return { state: rec.state, synthesis: existsSync(p) ? readFileSync(p, "utf8") : null, reason: rec.reason };
    });
  }

  list() {
    return this.withLock(() => {
      this.reapLocked();
      return this.listLocked().map((r) => this.summary(r));
    });
  }

  // ---- drain and heartbeat ------------------------------------------------------------------

  private drainFile() {
    return join(this.root, ".draining");
  }

  /** Is this root refusing new claims? A marker file, so it survives a restart and is visible. */
  draining(): boolean {
    return existsSync(this.drainFile());
  }

  /**
   * Stop handing out work; let what is leased finish.
   *
   * The alternative a host had was cancelling every run, which drops tasks that are already
   * paid for and still in flight: the subagent finishes, returns, and the kernel refuses the
   * artifact. Draining costs nothing already spent.
   *
   * A marker file rather than memory, because the point is to survive the process that called
   * it — a host draining before a deploy is a host about to exit.
   */
  drain(reason = "draining"): { draining: true; outstanding: number; reason: string } {
    return this.withLock(() => {
      writeFileSync(this.drainFile(), JSON.stringify({ at: this.now().toISOString(), reason }) + "\n");
      const outstanding = this.listLocked().reduce((n, r) => n + r.tasks.filter((t) => t.status === "leased").length, 0);
      this.journal("drain", { reason, outstanding });
      return { draining: true as const, outstanding, reason };
    });
  }

  /** Accept claims again. */
  resume(): { draining: false } {
    return this.withLock(() => {
      if (existsSync(this.drainFile())) {
        rmSync(this.drainFile(), { force: true });
        this.journal("resume", {});
      }
      return { draining: false as const };
    });
  }

  /**
   * A worker says it is still alive and pushes its lease out.
   *
   * Without this the lease length has to cover the worst task anybody will ever run, because
   * the only signal a worker is alive is the artifact arriving. `adhd os stats` measures the
   * longest task the journal has seen at 280s against a 900s default — a margin picked by
   * guessing, and one that a genuinely slow subagent still crosses. A heartbeat lets the lease
   * be short enough to notice a dead worker quickly without punishing a live slow one.
   *
   * Only the worker holding the lease may beat it, and only while it still holds it: extending
   * a lease that already expired would take a task back from whoever legitimately re-claimed it.
   */
  heartbeat(taskId: string, worker: string): { task: string; lease_until: string; attempts: number } {
    return this.withLock(() => {
      const runId = taskId.split(":")[0]!;
      const rec = this.load(runId);
      if (isTerminal(rec.state)) throw new ContractError("heartbeat", [`run ${runId} is ${rec.state}; its leases are over`]);
      const task = rec.tasks.find((t) => t.id === taskId);
      if (!task) throw new ContractError("heartbeat", [`no task ${taskId}`]);
      if (task.status !== "leased") throw new ContractError("heartbeat", [`task ${taskId} is ${task.status}, not leased`]);
      if (task.worker !== worker) throw new ContractError("heartbeat", [`task ${taskId} is leased to ${task.worker}, not ${worker}`]);
      const now = this.now();
      if (task.lease_until && Date.parse(task.lease_until) <= now.getTime())
        throw new ContractError("heartbeat", [`task ${taskId} expired at ${task.lease_until}; extending it now would take it back from whoever re-claimed it`]);
      task.lease_until = new Date(now.getTime() + this.leaseFor(task.phase) * 1000).toISOString();
      this.save(rec);
      this.journal("heartbeat", { run_id: runId, task: taskId, worker, lease_until: task.lease_until });
      return { task: taskId, lease_until: task.lease_until, attempts: task.attempts };
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
          // Dead, not dropped: this task was tried and never came back, which is a different
          // fact from the siblings below, which the run simply no longer needs.
          t.status = "dead";
          rec.state = "aborted";
          rec.reason = `task ${t.id} expired ${t.attempts} times`;
          rec.finished_at = this.now().toISOString();
          // The abort in advanceLocked drops every outstanding task; this one used to drop only
          // the task that expired, leaving its siblings pending on a run that was already over.
          // They stayed claimable, so a host went on spending subagents on a dead run and the
          // work came back to a kernel with nowhere to put it.
          for (const s of rec.tasks) if (s.status === "pending" || s.status === "leased") s.status = "dropped";
          aborted.push(rec.run_id);
          this.journal("aborted", { run_id: rec.run_id, reason: rec.reason });
          break; // the run is over; the remaining leases were just dropped, not expired
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
          const b = this.newTask(rec.run_id, "critique_b", n.agent, "pass-b", rel(dir, n.brief), rel(dir, n.artifact), a.id);
          b.prefer_worker = a.worker;
          b.others_after = new Date(this.now().getTime() + this.leaseFor("critique_b") * 1000).toISOString();
          rec.tasks.push(b);
          rec.state = "critique_b";
          break;
        }
        case "critique_b": {
          phaseCritique(this.cfg, dir); // validates pass B
          r = phaseDeepen(this.cfg, dir);
          if (r.exitCode === 2) {
            // Monoculture or scatter. Render what exists and stop.
            this.writeCost(rec);
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
          this.writeCost(rec);
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

  /** Sum reported tokens into cost.json so the synthesis shows real spend, not the estimate. */
  private writeCost(rec: RunRecord) {
    const reported = rec.tasks.filter((t) => t.tokens !== null);
    if (!reported.length) return;
    const tokens = reported.reduce((a, t) => a + (t.tokens ?? 0), 0);
    const started = Date.parse(rec.confirmed_at ?? rec.created_at);
    const secs = Math.max(0, Math.round((this.now().getTime() - started) / 1000));
    const byPhase: Record<string, number> = {};
    for (const t of reported) byPhase[t.phase] = (byPhase[t.phase] ?? 0) + (t.tokens ?? 0);
    // Per-frame spend used to exist only in os.json, which `adhd os record` does not copy into
    // a recording, so `adhd cost` could say what a run cost and never which frame cost it.
    // Branch and deepen tasks are the ones labelled by frame; critic tasks are labelled by pass.
    const byFrame: Record<string, number> = {};
    for (const t of reported) if (t.phase === "diverge" || t.phase === "deepen") byFrame[t.label] = (byFrame[t.label] ?? 0) + (t.tokens ?? 0);
    writeFileSync(
      join(this.runDir(rec.run_id), "cost.json"),
      JSON.stringify(
        { tokens, wall: `${secs}s from confirm`, reported_tasks: reported.length, of_tasks: rec.tasks.filter((t) => t.status === "done").length, by_phase: byPhase, by_frame: byFrame },
        null,
        2,
      ) + "\n",
    );
  }

  /** Journal lines for one run. */
  log(runId: string): Record<string, unknown>[] {
    const p = join(this.root, "journal.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e["run_id"] === runId);
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
      tasks: { pending: count("pending"), leased: count("leased"), done: count("done"), dropped: count("dropped"), dead: count("dead") },
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


// ---- promote a finished run to evidence ------------------------------------------------------
import { cpSync } from "node:fs";
import { runEval } from "./eval.js";

/**
 * Copy a finished run into evals/recorded/<fixture>-<name>/ with a README generated from the
 * journal and an expected.json that records the eval outcome as observed. Never edits
 * artifacts. The human adds "what it did not surface" by hand; the skeleton says so.
 */
export function recordRun(cfg: Config, kernel: Kernel, runId: string, opts: { fixtureId: string; name: string; force?: boolean }) {
  const status = kernel.status(runId);
  if (!["done", "done_run_level", "cancelled"].includes(status.state)) throw new ContractError("record", [`run ${runId} is ${status.state}; only finished runs are recorded`]);
  const dest = join(cfg.root, "evals", "recorded", `${opts.fixtureId}-${opts.name}`);
  if (existsSync(dest) && !opts.force) throw new ContractError("record", [`${dest} exists; pass force to replace`]);
  cpSync(kernel["runDir"](runId), dest, { recursive: true });
  // Evaluate as recorded, then write the expectation that matches reality.
  const report = runEval(cfg);
  const pair = report.pairs.find((p) => p.recorded === dest);
  const outcome = pair?.outcome ?? "fail";
  const log = kernel.log(runId);
  const workers = [...new Set(log.filter((e) => e["event"] === "claimed").map((e) => String(e["worker"])))];
  const expiries = log.filter((e) => e["event"] === "lease_expired").length;
  const costPath = join(dest, "cost.json");
  const cost = existsSync(costPath) ? (JSON.parse(readFileSync(costPath, "utf8")) as { tokens?: number; wall?: string }) : {};
  writeFileSync(
    join(dest, "expected.json"),
    JSON.stringify({ outcome, note: outcome === "pass" ? `Recorded from kernel run ${runId}.` : `Recorded from kernel run ${runId}. Failing items: ${pair?.failures.join("; ") ?? "fixture not found"}. Recorded as observed, not hidden.` }, null, 2) + "\n",
  );
  const readme = [
    `# Recorded run: ${opts.fixtureId}, ${opts.name}`,
    "",
    `Run \`${runId}\`, class \`${status.problem_class}\`, seed ${status.seed}, n ${status.n}, final state \`${status.state}\`. Driven by the kernel (docs/OS.md); recorded by \`adhd os record\`.`,
    "",
    "## Provenance, from the journal",
    "",
    `- Workers: ${workers.length ? workers.join(", ") : "none recorded"}.`,
    `- Lease expiries: ${expiries}.`,
    `- Tokens: ${cost.tokens ?? "not reported"}${cost.wall ? ` over ${cost.wall}` : ""}.`,
    `- Eval outcome as recorded: ${outcome.toUpperCase()}${pair?.failures.length ? ` (${pair.failures.length} failing item${pair.failures.length === 1 ? "" : "s"})` : ""}.`,
    "",
    "## What the run surfaced",
    "",
    "_Fill in from synthesis.md. The kernel records provenance; a person records meaning._",
    "",
    "## What the run did not surface",
    "",
    pair?.failures.length ? pair.failures.map((f) => `- ${f}`).join("\n") : "_Nothing the fixture asked for was missed. Say what a reader should still know._",
    "",
  ].join("\n");
  writeFileSync(join(dest, "README.md"), readme);
  return { dest, outcome, failures: pair?.failures ?? [], workers, expiries };
}

export { problemHash };

// ---- kernel statistics over the journal (backlog 34) ----------------------------------------

export interface PhaseTiming {
  phase: Task["phase"];
  tasks: number;
  mean_seconds: number;
  median_seconds: number;
  max_seconds: number;
}

export interface KernelStats {
  runs: number;
  by_outcome: Record<string, number>;
  claims: number;
  returns: number;
  expiries: number;
  /** Expiries per claim. A worker that never dies makes this zero and the leases untested. */
  expiry_rate: number;
  lock_breaks: number;
  workers: string[];
  phases: PhaseTiming[];
  span_hours: number | null;
  text: string;
}

/**
 * Throughput and phase timing read off the append-only journal (backlog 34).
 *
 * The journal is the only record of what a kernel did rather than what it holds now, and
 * nothing has ever read it in aggregate. The numbers that matter are the ones a host would use
 * to size a lease: how long a task of each phase actually takes, and how often the current
 * lease length is wrong. A default of 900 seconds was chosen before any of this was measurable.
 */
export function kernelStats(root: string): KernelStats {
  const p = join(root, "journal.jsonl");
  const entries: Record<string, unknown>[] = existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as Record<string, unknown>];
          } catch {
            return []; // a truncated final line is ordinary on an append-only file
          }
        })
    : [];

  const str = (e: Record<string, unknown>, k: string) => (typeof e[k] === "string" ? (e[k] as string) : null);
  const at = (e: Record<string, unknown>) => Date.parse(str(e, "at") ?? "");
  const count = (event: string) => entries.filter((e) => e["event"] === event).length;

  const runIds = new Set(entries.filter((e) => e["event"] === "submitted").map((e) => str(e, "run_id")).filter((x): x is string => x !== null));
  const byOutcome: Record<string, number> = {};
  for (const ev of ["done", "done_run_level", "cancelled", "aborted"]) {
    const n = new Set(entries.filter((e) => e["event"] === ev).map((e) => str(e, "run_id"))).size;
    if (n) byOutcome[ev] = n;
  }

  // Claim to return, per task. The journal carries both events with the task id, so a task that
  // was claimed twice after an expiry is measured from its last claim, which is the one that
  // produced the artifact.
  const claimedAt = new Map<string, number>();
  const durations = new Map<Task["phase"], number[]>();
  const phaseOf = new Map<string, Task["phase"]>();
  for (const e of entries) {
    const task = str(e, "task");
    if (!task) continue;
    // Task ids are `<run>:<phase>:<label>`, and run ids cannot contain a colon.
    const phase = task.split(":")[1] as Task["phase"] | undefined;
    if (phase) phaseOf.set(task, phase);
    if (e["event"] === "claimed") claimedAt.set(task, at(e));
    else if (e["event"] === "returned") {
      const start = claimedAt.get(task);
      const ph = phaseOf.get(task);
      if (start !== undefined && ph && Number.isFinite(start)) {
        const secs = (at(e) - start) / 1000;
        if (Number.isFinite(secs) && secs >= 0) durations.set(ph, [...(durations.get(ph) ?? []), secs]);
      }
      claimedAt.delete(task);
    }
  }

  const phases: PhaseTiming[] = (["diverge", "critique_a", "critique_b", "deepen"] as const)
    .filter((ph) => (durations.get(ph) ?? []).length > 0)
    .map((ph) => {
      const d = [...durations.get(ph)!].sort((a, b) => a - b);
      return {
        phase: ph,
        tasks: d.length,
        mean_seconds: d.reduce((a, x) => a + x, 0) / d.length,
        median_seconds: d[Math.floor(d.length / 2)]!,
        max_seconds: d[d.length - 1]!,
      };
    });

  const times = entries.map(at).filter((t) => Number.isFinite(t));
  const spanHours = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 3_600_000 : null;
  const claims = count("claimed");
  const expiries = count("lease_expired");
  const workers = [...new Set(entries.filter((e) => e["event"] === "claimed").map((e) => str(e, "worker")).filter((x): x is string => x !== null))].sort();

  const lines = [`kernel journal at ${p}`];
  if (!entries.length) {
    lines.push("no journal yet. Submit a run to populate this.");
    return { runs: 0, by_outcome: {}, claims: 0, returns: 0, expiries: 0, expiry_rate: 0, lock_breaks: 0, workers: [], phases: [], span_hours: null, text: lines.join("\n") };
  }
  lines.push("");
  lines.push(`${runIds.size} run(s) submitted${spanHours === null ? "" : ` over ${spanHours.toFixed(1)}h`}: ${Object.entries(byOutcome).map(([k, v]) => `${v} ${k}`).join(", ") || "none finished"}`);
  const unfinished = runIds.size - Object.values(byOutcome).reduce((a, v) => a + v, 0);
  if (unfinished > 0) lines.push(`${unfinished} still open.`);
  lines.push(`${claims} claim(s), ${count("returned")} return(s), by ${workers.length} worker(s): ${workers.join(", ") || "-"}`);
  lines.push(`${expiries} lease expiry(ies)${claims ? `, ${((expiries / claims) * 100).toFixed(0)}% of claims` : ""}. ${count("lock_broken")} lock break(s), ${count("lock_lost")} lock loss(es).`);

  if (phases.length) {
    lines.push("");
    lines.push(`${"phase".padEnd(12)} tasks    mean   median      max  (seconds, claim to return)`);
    for (const ph of phases)
      lines.push(`${ph.phase.padEnd(12)} ${String(ph.tasks).padStart(5)}  ${ph.mean_seconds.toFixed(0).padStart(6)}  ${ph.median_seconds.toFixed(0).padStart(7)}  ${ph.max_seconds.toFixed(0).padStart(7)}`);
    const worst = phases.reduce((a, b) => (b.max_seconds > a.max_seconds ? b : a));
    lines.push("");
    lines.push(
      `The longest task the journal has seen took ${worst.max_seconds.toFixed(0)}s (${worst.phase}). A lease shorter than that hands live work to a second subagent; the default is 900s.`,
    );
  } else lines.push("no completed task has both a claim and a return in the journal, so there is nothing to time.");

  if (expiries === 0 && claims > 0) lines.push("No lease has ever expired here, so nothing in this journal exercises the reclaim path. test/concurrency.test.ts does.");

  return { runs: runIds.size, by_outcome: byOutcome, claims, returns: count("returned"), expiries, expiry_rate: claims ? expiries / claims : 0, lock_breaks: count("lock_broken"), workers, phases, span_hours: spanHours, text: lines.join("\n") };
}
