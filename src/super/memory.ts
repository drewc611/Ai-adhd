/**
 * Memory across missions, and the one thing it must never do.
 *
 * A harness that researches for an hour and forgets it by the next mission is doing the research
 * twice. So findings persist: append-only JSONL, content-addressed, every entry carrying where it
 * came from.
 *
 * The hard part is not storage. **Memory is exactly the mechanism by which a sibling's output
 * would reach a branch.** "Branches never see siblings" is a CLAUDE.md non-negotiable, and it is
 * a property of separate context windows — but a memory store that hands a branch what another
 * branch wrote five minutes ago has re-created the channel that isolation existed to remove, and
 * done it through a component nobody was watching.
 *
 * So `forBrief` refuses. Not by convention and not by a note in a prompt: an entry whose
 * provenance is a `diverge` participant is withheld from any `diverge` brief, mechanically, and
 * the refusal is counted so a caller can see it happened. Global scope does not exempt it. Being
 * old does not exempt it. `adhd super memory --audit` reports the rule's effect on the store as
 * it stands.
 *
 * Append-only because a memory that can be edited in place is a memory whose provenance is a
 * claim rather than a record, and provenance is the whole basis of the refusal above.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ContractError } from "../errors.js";

export const MemoryEntrySchema = z
  .object({
    id: z.string(),
    /** `global`, or a mission id. Scope narrows retrieval; it does not grant it. */
    scope: z.string(),
    kind: z.enum(["finding", "decision", "artifact", "failure", "note"]),
    text: z.string().min(1),
    tags: z.array(z.string()).default([]),
    /**
     * Where this came from, and the field the isolation rule reads. `stage_kind` is what decides
     * whether an entry is sibling output, so it is not optional and not free text.
     */
    provenance: z
      .object({
        mission_id: z.string(),
        stage_id: z.string(),
        stage_kind: z.string(),
        run_id: z.string().nullable().default(null),
        label: z.string().nullable().default(null),
      })
      .strict(),
    created_at: z.string(),
  })
  .strict();
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export interface Withheld {
  id: string;
  why: string;
}

export interface Recall {
  entries: MemoryEntry[];
  withheld: Withheld[];
}

const entryId = (e: Omit<MemoryEntry, "id">): string =>
  `mem_${createHash("sha256")
    .update(`${e.scope} ${e.kind} ${e.text} ${e.provenance.mission_id} ${e.provenance.stage_id}`)
    .digest("hex")
    .slice(0, 16)}`;

export class Memory {
  readonly path: string;

  constructor(root: string) {
    this.path = join(root, "memory.jsonl");
  }

  private all(): MemoryEntry[] {
    if (!existsSync(this.path)) return [];
    const out: MemoryEntry[] = [];
    const lines = readFileSync(this.path, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      const parsed = MemoryEntrySchema.safeParse(JSON.parse(line));
      // A corrupt line is a contract failure, not something to skip. Skipping turns a truncated
      // write into a memory that silently forgot one thing, which is the failure mode hardest to
      // notice and worst to debug.
      if (!parsed.success)
        throw new ContractError("memory", [`${this.path}:${i + 1} does not parse: ${parsed.error.issues[0]?.message}`]);
      out.push(parsed.data);
    }
    return out;
  }

  /** Append, deduplicating on content. Returns the entry, new or existing. */
  write(e: Omit<MemoryEntry, "id" | "created_at"> & { created_at?: string }): MemoryEntry {
    const created_at = e.created_at ?? new Date().toISOString();
    const draft = { ...e, created_at } as Omit<MemoryEntry, "id">;
    const entry = MemoryEntrySchema.parse({ ...draft, id: entryId(draft) });
    const existing = this.all().find((x) => x.id === entry.id);
    if (existing) return existing;
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  /** Everything matching, with no isolation applied. For operators and reports, never for briefs. */
  query(opts: { scope?: string; kind?: MemoryEntry["kind"]; tags?: string[]; text?: string } = {}): MemoryEntry[] {
    return this.all().filter((e) => {
      if (opts.scope && e.scope !== opts.scope && e.scope !== "global") return false;
      if (opts.kind && e.kind !== opts.kind) return false;
      if (opts.tags?.length && !opts.tags.every((t) => e.tags.includes(t))) return false;
      if (opts.text && !e.text.toLowerCase().includes(opts.text.toLowerCase())) return false;
      return true;
    });
  }

  /**
   * What a stage's brief is allowed to contain, which is not the same set.
   *
   * The rule, stated once so the code below is only its implementation: **nothing a `diverge`
   * participant produced may reach a `diverge` brief.** A branch reading what any branch
   * concluded is not isolated, whatever the delivery mechanism, and a memory store is a delivery
   * mechanism with a database's air of neutrality about it. A branch of an earlier run is still a
   * branch, and its conclusion on a related question is the anchor this architecture exists to
   * defeat, so the rule does not stop at the run boundary.
   *
   * Non-diverge stages are unrestricted. A `create` stage summarising what the branches found is
   * the whole point of a synthesis, and it happens after the isolation has done its work.
   */
  forBrief(target: { stage_kind: string; run_id: string | null }, opts: { scope?: string; tags?: string[] } = {}): Recall {
    const candidates = this.query(opts);
    if (target.stage_kind !== "diverge") return { entries: candidates, withheld: [] };

    const entries: MemoryEntry[] = [];
    const withheld: Withheld[] = [];
    for (const e of candidates) {
      if (e.provenance.stage_kind === "diverge") {
        const sameRun = target.run_id !== null && e.provenance.run_id === target.run_id;
        withheld.push({
          id: e.id,
          why: sameRun
            ? `written by a diverge participant of run ${target.run_id}`
            : "written by a diverge participant; a branch conclusion is an anchor",
        });
        continue;
      }
      entries.push(e);
    }
    return { entries, withheld };
  }

  /** What the rule would do to the store as it stands. `adhd super memory --audit` prints this. */
  audit(run_id: string | null = null): { total: number; visible_to_diverge: number; withheld: Withheld[] } {
    const all = this.all();
    const { entries, withheld } = this.forBrief({ stage_kind: "diverge", run_id });
    return { total: all.length, visible_to_diverge: entries.length, withheld };
  }
}
