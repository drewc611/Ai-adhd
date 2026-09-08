/**
 * The SuperAgent: the thing that holds a mission together for an hour without reasoning about it.
 *
 * It does five jobs and none of them is thinking. It plans a stage graph from the mission class,
 * shows the plan and stops (D5, one level up), hands stages out under a lease, compiles each
 * stage's brief from memory and mailbox, and checks each returned artifact against a contract
 * that was written before the stage ran.
 *
 * The reason it never reasons is not modesty. An orchestrator that formed a view would put that
 * view in every brief it compiled, and every stage downstream would be reasoning from a premise
 * nobody scored — which is the anchor this whole repository is built to defeat, arriving through
 * the one component that talks to everything. So `compileBrief` runs `assertNoReasoning` on its
 * own output and throws on a hit, and the test suite fails the build if that check is removed.
 *
 * Everything is on disk. A mission that takes an hour will outlive the process that started it,
 * so the record is the truth and the object is a view of it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ContractError, RunAbort } from "../errors.js";
import { problemHash } from "../hash.js";
import { Gateway, ORCHESTRATOR, orchestrator, type Participant } from "./gateway.js";
import { Memory } from "./memory.js";
import { Sandbox } from "./sandbox.js";
import {
  CLASS_POLICY,
  MissionSchema,
  SandboxPolicySchema,
  STAGE_AGENT,
  STAGE_TOOLS,
  assertNoReasoning,
  planProblems,
  stageById,
  unblocked,
  type Mission,
  type MissionClass,
  type Stage,
  type StageKind,
} from "./mission.js";

const MISSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

export interface SuperOptions {
  root: string;
  now?: () => Date;
}

export interface ClaimedStage extends Stage {
  mission_id: string;
  goal_hash: string;
  brief: string;
  /** Null for `diverge`, which submits a run rather than spawning an agent. See STAGE_AGENT. */
  agent: string | null;
  tools: readonly string[];
  sandbox: string | null;
}

interface StageTemplate {
  id: string;
  kind: StageKind;
  label: string;
  after: string[];
  contract: { artifact: string; requires: string[]; command: string | null; min_words: number };
}

/**
 * The stage graphs, one per class, and the difference between them is the actual meaning of
 * "minutes to hours".
 *
 * `quick` is one research pass and a write-up: a question with an answer somebody already knows.
 * `standard` adds a divergent decision and a build behind it. `deep` adds a second research pass
 * after the divergence, because an hour-long mission's most common failure is committing to a
 * direction chosen before the hard part was understood, and the second pass is where the branches'
 * disagreement gets checked against the world rather than against each other.
 *
 * A `diverge` stage is where this stops being a generic harness. It submits an ordinary run to the
 * kernel: N isolated frames, a blind critic, the trap sweep. That is the repository's own machine,
 * used by the harness rather than reimplemented inside it.
 */
export function template(cls: MissionClass): StageTemplate[] {
  const research = (id: string, label: string, after: string[]): StageTemplate => ({
    id,
    kind: "research",
    label,
    after,
    contract: { artifact: `${id}.md`, requires: ["## Findings", "## Sources", "## What is still unknown"], command: null, min_words: 120 },
  });

  if (cls === "quick")
    return [
      research("research", "gather what is already known", []),
      {
        id: "create",
        kind: "create",
        label: "write the deliverable",
        after: ["research"],
        contract: { artifact: "deliverable.md", requires: ["## What this is", "## What it does not cover"], command: null, min_words: 150 },
      },
    ];

  const common: StageTemplate[] = [
    research("research", "gather what is already known", []),
    {
      id: "decide",
      kind: "diverge",
      label: "run the question through isolated frames",
      after: ["research"],
      contract: { artifact: "synthesis.md", requires: ["## Recommendation", "## Pruned"], command: null, min_words: 200 },
    },
    {
      id: "build",
      kind: "build",
      label: "implement it in a sandbox",
      after: ["decide"],
      contract: { artifact: "build.md", requires: ["## Changed", "## Why"], command: null, min_words: 60 },
    },
    {
      id: "verify",
      kind: "verify",
      label: "run the checks in the sandbox",
      after: ["build"],
      contract: { artifact: "verify.md", requires: ["## Command", "## Result"], command: null, min_words: 30 },
    },
    {
      id: "create",
      kind: "create",
      label: "write the deliverable",
      after: ["verify"],
      contract: { artifact: "deliverable.md", requires: ["## What this is", "## What it does not cover"], command: null, min_words: 150 },
    },
  ];

  if (cls === "standard") return common;

  const deep = [...common];
  deep.splice(2, 0, research("research_2", "check the branches' disagreement against the world", ["decide"]));
  const build = deep.find((s) => s.id === "build")!;
  build.after = ["research_2"];
  deep.push({
    id: "review",
    kind: "review",
    label: "the strongest objection to what was built",
    after: ["create"],
    contract: { artifact: "review.md", requires: ["## Strongest objection", "## Does it stand"], command: null, min_words: 80 },
  });
  return deep;
}

export class SuperAgent {
  readonly root: string;
  readonly memory: Memory;
  readonly gateway: Gateway;
  private readonly now: () => Date;

  constructor(opts: SuperOptions) {
    this.root = opts.root;
    this.now = opts.now ?? (() => new Date());
    mkdirSync(this.root, { recursive: true });
    this.memory = new Memory(this.root);
    this.gateway = new Gateway(this.root);
  }

  private dir(id: string): string {
    if (!MISSION_ID_RE.test(id)) throw new ContractError("mission", [`${id} is not a usable directory name`]);
    return join(this.root, "missions", id);
  }

  private journal(id: string, event: Record<string, unknown>): void {
    mkdirSync(this.dir(id), { recursive: true });
    appendFileSync(join(this.dir(id), "journal.jsonl"), `${JSON.stringify({ at: this.now().toISOString(), ...event })}\n`);
  }

  read(id: string): Mission {
    const p = join(this.dir(id), "mission.json");
    if (!existsSync(p)) throw new ContractError("mission", [`no mission ${id}`]);
    return MissionSchema.parse(JSON.parse(readFileSync(p, "utf8")));
  }

  private write(m: Mission): Mission {
    const next = MissionSchema.parse({ ...m, updated_at: this.now().toISOString() });
    mkdirSync(this.dir(next.mission_id), { recursive: true });
    writeFileSync(join(this.dir(next.mission_id), "mission.json"), JSON.stringify(next, null, 2) + "\n");
    return next;
  }

  list(): Mission[] {
    const d = join(this.root, "missions");
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter((x) => existsSync(join(d, x, "mission.json")))
      .map((x) => this.read(x))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /**
   * Plan and stop. D5 said a system that spawns seven subagents and gives the user no way out
   * fails its own fixture, and a mission that may run for an hour across a dozen stages is that
   * objection with an order of magnitude on it. Nothing is claimable until `confirm`.
   */
  submit(opts: {
    mission_id: string;
    goal: string;
    mission_class: MissionClass;
    sandbox?: Partial<{ writable: string[]; network: boolean; commands: string[] }>;
    budget_tokens?: number;
  }): Mission {
    if (existsSync(join(this.dir(opts.mission_id), "mission.json"))) throw new ContractError("mission", [`${opts.mission_id} already exists`]);
    if (!opts.goal.trim()) throw new ContractError("mission", ["the goal is empty"]);

    const policy = CLASS_POLICY[opts.mission_class];
    const stages: Stage[] = template(opts.mission_class).map((t, i) => ({
      ...t,
      status: i === 0 && t.after.length === 0 ? "pending" : "blocked",
      run_id: null,
      worker: null,
      lease_until: null,
      attempts: 0,
      tokens: null,
      started_at: null,
      finished_at: null,
      note: null,
    }));
    const problems = planProblems(stages);
    if (problems.length) throw new ContractError("mission plan", problems);

    const at = this.now().toISOString();
    const m = MissionSchema.parse({
      mission_id: opts.mission_id,
      goal: opts.goal,
      goal_hash: problemHash(opts.goal),
      mission_class: opts.mission_class,
      state: "awaiting_confirm",
      created_at: at,
      updated_at: at,
      confirmed_at: null,
      finished_at: null,
      budget_tokens: opts.budget_tokens ?? policy.budgetTokens,
      spent_tokens: 0,
      sandbox: SandboxPolicySchema.parse(opts.sandbox ?? {}),
      stages,
      reason: null,
    });
    this.journal(m.mission_id, { event: "submitted", mission_class: m.mission_class, stages: stages.length });
    return this.write(m);
  }

  confirm(id: string): Mission {
    const m = this.read(id);
    if (m.state !== "awaiting_confirm") throw new ContractError("mission", [`${id} is ${m.state}, not awaiting_confirm`]);
    this.journal(id, { event: "confirmed" });
    return this.write({ ...m, state: "running", confirmed_at: this.now().toISOString() });
  }

  /**
   * The brief a stage receives. Everything it is allowed to know, and nothing else.
   *
   * Memory arrives through `forBrief`, so a diverge stage gets the isolation-filtered set and the
   * count of what was withheld — the count and not the content, because a list of titles is a list
   * of what siblings thought worth writing down.
   */
  compileBrief(m: Mission, s: Stage): string {
    const recall = this.memory.forBrief({ stage_kind: s.kind, run_id: s.run_id }, { scope: m.mission_id });
    const inbox = this.gateway.inbox(m.mission_id, s.id);
    // `null` is a line that does not apply; `""` is a blank line that does. Collapsing the two
    // strips every paragraph break in the brief, which reads as one wall of text to whatever has
    // to act on it.
    const lines: (string | null)[] = [
      `# ${s.label}`,
      "",
      `mission: ${m.mission_id}   stage: ${s.id}   kind: ${s.kind}`,
      `goal_hash: ${m.goal_hash}`,
      "",
      "## Goal, verbatim",
      "",
      m.goal,
      "",
      "## Your contract",
      "",
      `Write \`${s.contract.artifact}\` in the mission directory. It must contain, literally:`,
      ...s.contract.requires.map((r) => `  - ${r}`),
      s.contract.min_words ? `It must be at least ${s.contract.min_words} words.` : null,
      s.contract.command ? `\`${s.contract.command}\` must exit zero.` : null,
      "",
      `Tools available to this stage: ${STAGE_TOOLS[s.kind].join(", ") || "none"}.`,
      "",
    ];

    if (s.kind === "diverge") {
      lines.push(
        "## Isolation",
        "",
        `${recall.withheld.length} memory entr(ies) were withheld from this brief because a diverge`,
        "participant wrote them. That is not an oversight and asking for them is not available.",
        "Reason from the goal and from what you are given.",
        "",
      );
    } else if (recall.entries.length) {
      lines.push("## What earlier stages recorded", "");
      for (const e of recall.entries) lines.push(`- [${e.kind}] ${e.text}  (${e.provenance.stage_id})`);
      lines.push("");
    }

    if (inbox.length) {
      lines.push("## Messages", "");
      for (const msg of inbox) lines.push(`- from ${msg.from} (${msg.kind}): ${msg.body}`);
      lines.push("");
    }

    const text = lines.filter((l): l is string => l !== null).join("\n") + "\n";
    const leaked = assertNoReasoning(`brief for ${m.mission_id}/${s.id}`, text);
    if (leaked.length) throw new ContractError("orchestrator", leaked);
    return text;
  }

  /** Hand out one stage under a lease, oldest unblocked first. */
  claim(id: string, worker: string): ClaimedStage | null {
    let m = this.read(id);
    if (m.state !== "running") return null;
    if (m.spent_tokens >= m.budget_tokens) {
      this.journal(id, { event: "budget_exhausted", spent: m.spent_tokens, budget: m.budget_tokens });
      this.write({ ...m, state: "blocked", reason: `budget exhausted: ${m.spent_tokens} >= ${m.budget_tokens}` });
      return null;
    }

    m = this.expire(m);
    for (const s of unblocked(m)) s.status = "pending";
    const next = m.stages.find((s) => s.status === "pending");
    if (!next) {
      m = this.settle(m);
      this.write(m);
      return null;
    }

    const policy = CLASS_POLICY[m.mission_class];
    const at = this.now();
    next.status = "leased";
    next.worker = worker;
    next.attempts += 1;
    next.started_at = next.started_at ?? at.toISOString();
    next.lease_until = new Date(at.getTime() + policy.leaseSeconds * 1000).toISOString();
    const saved = this.write(m);
    this.journal(id, { event: "claimed", stage: next.id, worker, attempt: next.attempts });

    return {
      ...next,
      mission_id: saved.mission_id,
      goal_hash: saved.goal_hash,
      brief: this.compileBrief(saved, next),
      agent: STAGE_AGENT[next.kind],
      tools: STAGE_TOOLS[next.kind],
      sandbox: ["build", "verify"].includes(next.kind) ? join(this.dir(id), "sandbox") : null,
    };
  }

  /**
   * Take a stage back. The artifact is checked against the contract that was written before the
   * stage ran, and `goal_hash` is checked because a worker returning against a paraphrased goal
   * is the mission-level version of the drift `problem_hash` exists to catch.
   */
  return_(id: string, stage_id: string, opts: { worker: string; goal_hash: string; tokens?: number; note?: string }): Mission {
    const m = this.read(id);
    if (m.goal_hash !== opts.goal_hash) throw new RunAbort(`goal_hash mismatch on ${id}/${stage_id}: the stage worked from a different goal`, "GOAL_HASH_MISMATCH");
    const s = stageById(m, stage_id);
    if (!s) throw new ContractError("mission", [`${id} has no stage ${stage_id}`]);
    if (s.status !== "leased") throw new ContractError("mission", [`${stage_id} is ${s.status}, not leased`]);
    if (s.worker !== opts.worker) throw new ContractError("mission", [`${stage_id} is leased to ${s.worker}, not ${opts.worker}`]);

    const problems = this.verifyStage(m, s);
    if (problems.length) {
      const policy = CLASS_POLICY[m.mission_class];
      s.status = s.attempts >= policy.maxAttempts ? "dead" : "pending";
      s.worker = null;
      s.lease_until = null;
      s.note = problems.join("; ");
      this.journal(id, { event: "rejected", stage: stage_id, problems, status: s.status });
      const after = s.status === "dead" ? { ...m, state: "blocked" as const, reason: `stage ${stage_id} failed its contract ${s.attempts} times` } : m;
      return this.write(after);
    }

    s.status = "done";
    s.worker = null;
    s.lease_until = null;
    s.finished_at = this.now().toISOString();
    s.tokens = opts.tokens ?? null;
    s.note = opts.note ?? null;
    const spent = m.spent_tokens + (opts.tokens ?? 0);
    this.journal(id, { event: "returned", stage: stage_id, tokens: opts.tokens ?? 0 });

    this.memory.write({
      scope: m.mission_id,
      kind: s.kind === "research" ? "finding" : s.kind === "diverge" ? "decision" : "artifact",
      text: `${s.label}: ${s.contract.artifact}`,
      tags: [s.kind, m.mission_class],
      provenance: { mission_id: m.mission_id, stage_id: s.id, stage_kind: s.kind, run_id: s.run_id, label: s.label },
    });

    const advanced = { ...m, spent_tokens: spent };
    for (const u of unblocked(advanced)) u.status = "pending";
    return this.write(this.settle(advanced));
  }

  /**
   * The contract, run rather than judged. A missing heading is a missing heading; nobody decides
   * whether the artifact is good, because "good" is what the review stage and the critic are for
   * and a gate that asks for it is a gate that passes whatever it is given.
   */
  verifyStage(m: Mission, s: Stage): string[] {
    const p = join(this.dir(m.mission_id), s.contract.artifact);
    if (!existsSync(p)) return [`${s.contract.artifact} was not written`];
    const body = readFileSync(p, "utf8");
    const out: string[] = [];
    for (const r of s.contract.requires) if (!body.includes(r)) out.push(`${s.contract.artifact} is missing ${JSON.stringify(r)}`);
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words < s.contract.min_words) out.push(`${s.contract.artifact} has ${words} words, contract says at least ${s.contract.min_words}`);
    if (s.contract.command) {
      const box = join(this.dir(m.mission_id), "sandbox");
      if (!existsSync(box)) out.push(`the contract runs ${JSON.stringify(s.contract.command)} and there is no sandbox`);
      else {
        const r = new Sandbox(box, m.sandbox).run(s.contract.command);
        if (r.code !== 0) out.push(`${JSON.stringify(s.contract.command)} exited ${r.code}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" / ")}`);
      }
    }
    return out;
  }

  /** Expired leases go back to pending, or to dead once the class's attempts are used up. */
  private expire(m: Mission): Mission {
    const nowMs = this.now().getTime();
    const policy = CLASS_POLICY[m.mission_class];
    for (const s of m.stages) {
      if (s.status !== "leased" || !s.lease_until) continue;
      if (Date.parse(s.lease_until) > nowMs) continue;
      s.status = s.attempts >= policy.maxAttempts ? "dead" : "pending";
      s.worker = null;
      s.lease_until = null;
      this.journal(m.mission_id, { event: "lease_expired", stage: s.id, attempts: s.attempts, status: s.status });
    }
    return m;
  }

  private settle(m: Mission): Mission {
    if (m.stages.every((s) => s.status === "done")) {
      this.journal(m.mission_id, { event: "done", spent: m.spent_tokens });
      return { ...m, state: "done", finished_at: this.now().toISOString() };
    }
    if (m.stages.some((s) => s.status === "dead")) {
      const dead = m.stages.filter((s) => s.status === "dead").map((s) => s.id);
      return { ...m, state: "blocked", reason: `dead stage(s): ${dead.join(", ")}` };
    }
    return m;
  }

  cancel(id: string, reason?: string): Mission {
    const m = this.read(id);
    if (["done", "cancelled", "aborted"].includes(m.state)) throw new ContractError("mission", [`${id} is already ${m.state}`]);
    for (const s of m.stages) if (["pending", "blocked", "leased"].includes(s.status)) s.status = "dropped";
    this.journal(id, { event: "cancelled", reason: reason ?? null });
    return this.write({ ...m, state: "cancelled", reason: reason ?? null, finished_at: this.now().toISOString() });
  }

  /** A stage's own participant record, which is what the gateway's rule reads. */
  participant(m: Mission, stage_id: string): Participant {
    const s = stageById(m, stage_id);
    if (!s) throw new ContractError("mission", [`${m.mission_id} has no stage ${stage_id}`]);
    return { id: s.id, kind: s.kind, run_id: s.run_id };
  }

  status(id: string): {
    mission: Mission;
    ready: string[];
    waiting: string[];
    messages: number;
    withheld_from_diverge: number;
  } {
    const m = this.expire(this.read(id));
    return {
      mission: m,
      ready: m.stages.filter((s) => s.status === "pending").map((s) => s.id),
      waiting: m.stages.filter((s) => s.status === "blocked").map((s) => s.id),
      messages: this.gateway.thread(id).length,
      withheld_from_diverge: this.memory.audit().withheld.length,
    };
  }

  /** Orchestrator-to-stage messages, checked the same way a brief is. */
  notify(id: string, stage_id: string, body: string): void {
    const leaked = assertNoReasoning(`${ORCHESTRATOR} message to ${stage_id}`, body);
    if (leaked.length) throw new ContractError("orchestrator", leaked);
    const m = this.read(id);
    this.gateway.send(id, orchestrator(), this.participant(m, stage_id), "report", body, this.now);
  }
}

/**
 * What the operator sees before anything is spent. D5's preview, for a unit of work an order of
 * magnitude larger than a run: a mission may hold a dozen stages and one of them may itself be a
 * seven-branch run, so the estimate that matters is stages and ceiling, not tokens alone.
 */
export function missionPreview(m: Mission): string {
  const policy = CLASS_POLICY[m.mission_class];
  const lines = [
    `mission ${m.mission_id}  (${m.mission_class})`,
    "",
    `${m.stages.length} stages. Lease ${policy.leaseSeconds}s per stage, ${policy.maxAttempts} attempts each.`,
    `Budget ${m.budget_tokens.toLocaleString()} reported tokens. Nothing is claimable until \`adhd super confirm ${m.mission_id}\`.`,
    "",
  ];
  for (const s of m.stages) {
    const waits = s.after.length ? `after ${s.after.join(", ")}` : "starts immediately";
    lines.push(`  ${s.id.padEnd(12)} ${s.kind.padEnd(9)} ${waits}`);
    lines.push(`  ${" ".repeat(12)} ${" ".repeat(9)} writes ${s.contract.artifact}, needs ${s.contract.requires.length} heading(s), ${s.contract.min_words} words`);
    if (s.kind === "diverge") lines.push(`  ${" ".repeat(12)} ${" ".repeat(9)} this one submits a run: N isolated frames, blind critic, trap sweep`);
  }
  const box = m.sandbox;
  lines.push(
    "",
    `Sandbox: ${box.writable.length ? `writable ${box.writable.join(", ")}` : "whole sandbox writable"}; ` +
      `${box.commands.length ? `${box.commands.length} allowed command(s)` : "no commands allowed"}; network ${box.network ? "on" : "off"}.`,
    "Nothing a stage writes reaches the working tree without `adhd super sandbox --promote`.",
  );
  return lines.join("\n");
}

export function openSuper(root: string, opts: Omit<SuperOptions, "root"> = {}): SuperAgent {
  return new SuperAgent({ root, ...opts });
}
