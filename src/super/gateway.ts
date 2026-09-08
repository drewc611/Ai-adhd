/**
 * The message gateway, and the reason it is a gateway rather than a bus.
 *
 * Stages that run for an hour need to be able to say things: a build stage that found the API
 * shape wrong, a research stage that finished early, an operator who wants to redirect a mission
 * without killing it. A bus would do that in twenty lines.
 *
 * A bus would also be the second channel by which a branch reaches its sibling, after memory. So
 * this routes, and every delivery passes one rule: **no message is ever delivered between two
 * `diverge` participants.** Not filtered on read, not discouraged in a prompt — refused at send,
 * with the refusal recorded in the journal, because a message that was accepted and then hidden
 * is a message the sender believes arrived.
 *
 * Addressing is `mission/stage`, plus two reserved endpoints:
 *   - `operator` — a person. May send to anything, and is the redirect path for a long mission.
 *   - `orchestrator` — the planner. May send to anything and receives stage reports. It routes;
 *     `assertNoReasoning` runs on what it sends, so it cannot use this to smuggle an answer into
 *     a brief.
 *
 * Delivery is a mailbox on disk rather than a socket. A mission that survives a restart needs its
 * undelivered messages to survive it too, and an in-memory bus loses exactly the messages sent
 * during the crash that caused the restart.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ContractError } from "../errors.js";

export const OPERATOR = "operator";
export const ORCHESTRATOR = "orchestrator";
const RESERVED = new Set([OPERATOR, ORCHESTRATOR]);

export const MessageSchema = z
  .object({
    id: z.string(),
    mission_id: z.string(),
    /** `operator`, `orchestrator`, or a stage id. */
    from: z.string(),
    to: z.string(),
    kind: z.enum(["report", "redirect", "question", "answer", "alert"]),
    body: z.string().min(1),
    sent_at: z.string(),
    read_at: z.string().nullable().default(null),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;

export interface Participant {
  id: string;
  /** The stage kind, or `operator` / `orchestrator` for the reserved endpoints. */
  kind: string;
  run_id: string | null;
}

export class GatewayRefused extends ContractError {
  constructor(from: string, to: string, why: string) {
    super("gateway", [`refused ${from} -> ${to}: ${why}`]);
    this.name = "GatewayRefused";
  }
}

/**
 * The one rule, as a pure function so a test can state it without building a mission.
 *
 * Both ends being `diverge` is the whole of it. Direction does not matter: a branch asking a
 * sibling a question leaks the question, which is a claim about what the asker thinks matters,
 * and that is an anchor as surely as the answer would be.
 */
export function deliveryRefusal(from: Participant, to: Participant): string | null {
  if (from.id === to.id) return "a stage cannot message itself";
  if (from.kind === "diverge" && to.kind === "diverge")
    return "both ends are diverge participants, and branches never see siblings";
  return null;
}

export class Gateway {
  readonly path: string;
  readonly journalPath: string;

  constructor(root: string) {
    this.path = join(root, "messages.jsonl");
    this.journalPath = join(root, "gateway.jsonl");
  }

  private journal(event: Record<string, unknown>): void {
    mkdirSync(join(this.path, ".."), { recursive: true });
    appendFileSync(this.journalPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  }

  private all(): Message[] {
    if (!existsSync(this.path)) return [];
    const out: Message[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      out.push(MessageSchema.parse(JSON.parse(line)));
    }
    return out;
  }

  /**
   * Send, or refuse. A refusal throws: the caller learns at the send that the message did not go,
   * rather than watching for a reply that was never going to come.
   */
  send(
    mission_id: string,
    from: Participant,
    to: Participant,
    kind: Message["kind"],
    body: string,
    now: () => Date = () => new Date(),
  ): Message {
    const why = deliveryRefusal(from, to);
    if (why) {
      this.journal({ event: "refused", mission_id, from: from.id, to: to.id, why });
      throw new GatewayRefused(from.id, to.id, why);
    }
    const sent_at = now().toISOString();
    const msg = MessageSchema.parse({
      id: `msg_${createHash("sha256").update(`${mission_id}${from.id}${to.id}${body}${sent_at}`).digest("hex").slice(0, 16)}`,
      mission_id,
      from: from.id,
      to: to.id,
      kind,
      body,
      sent_at,
      read_at: null,
    });
    mkdirSync(join(this.path, ".."), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(msg)}\n`);
    this.journal({ event: "sent", mission_id, id: msg.id, from: from.id, to: to.id, kind });
    return msg;
  }

  /** Unread messages for one address, oldest first. Marking read rewrites the file. */
  inbox(mission_id: string, to: string, opts: { markRead?: boolean } = {}): Message[] {
    const all = this.all();
    const mine = all.filter((m) => m.mission_id === mission_id && m.to === to && m.read_at === null);
    if (opts.markRead && mine.length) {
      const read_at = new Date().toISOString();
      const ids = new Set(mine.map((m) => m.id));
      const rewritten = all.map((m) => (ids.has(m.id) ? { ...m, read_at } : m));
      writeFileSync(this.path, rewritten.map((m) => JSON.stringify(m)).join("\n") + "\n");
      this.journal({ event: "read", mission_id, to, count: mine.length });
      return mine.map((m) => ({ ...m, read_at }));
    }
    return mine;
  }

  /** Everything for a mission, read or not. For status and for the operator. */
  thread(mission_id: string): Message[] {
    return this.all().filter((m) => m.mission_id === mission_id);
  }

  /** Refusals recorded so far. A gateway that never refuses is one whose rule is not being exercised. */
  refusals(mission_id?: string): Record<string, unknown>[] {
    if (!existsSync(this.journalPath)) return [];
    return readFileSync(this.journalPath, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e["event"] === "refused" && (!mission_id || e["mission_id"] === mission_id));
  }
}

export const operator = (): Participant => ({ id: OPERATOR, kind: OPERATOR, run_id: null });
export const orchestrator = (): Participant => ({ id: ORCHESTRATOR, kind: ORCHESTRATOR, run_id: null });

export function isReserved(id: string): boolean {
  return RESERVED.has(id);
}
