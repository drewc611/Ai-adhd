// Config overlays (backlog 71, decided in D33). Never calls a model.
//
// `adhd init` copies the shipped `config/`, which forks it: a team that scaffolds gets the library
// with seven runs of evidence behind it and then has no way to pull later improvements. An overlay
// fixes that — the base library stays the shipped one and the overlay carries only the differences.
//
// **The merge semantics are the decision, not a detail, and they are: a reused id replaces.** An
// overlay frame whose `id` matches a base frame replaces that frame *entirely*; an overlay routing
// class replaces the base class entirely; an overlay rubric dimension replaces the base dimension.
// Nothing is merged field by field, and the reason is `frame_hash`. A field-wise merge means the
// definition that ran is a function of two files and the merge order, and `adhd frames --drift`
// exists to say which definition ran. Whole replacement keeps that answerable: the loaded frame is
// one object from one file.
//
// What this costs, stated because the alternative was offered and refused: an overlay that wants to
// change one probe must restate the stance, the attacks, the tools and the forbidden list. That is
// verbose on purpose. A one-line override of a stance is exactly the edit whose provenance nobody
// can reconstruct six months later.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { FrameSchema, FramesFileSchema, RoutingFileSchema, RubricFileSchema } from "./schema.js";
import { ConfigError } from "./errors.js";
import { frameHash } from "./hash.js";

/**
 * Did this definition actually change, or is it the base one restated?
 *
 * An overlay is written by copying a list and editing one entry, so most of what it names is
 * identical to the base. Counting those as replacements makes the report say "ten dimensions
 * replaced" when one moved, and the report exists precisely because a merge nobody can see is the
 * failure mode — so a report full of non-changes is the same failure with extra words.
 *
 * Frames compare by `frame_hash`, which is already the repository's answer to "is this the same
 * definition". Everything else compares by canonical JSON.
 */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** An overlay states only what it changes, so every section is optional and so is `version`. */
export const OverlayFileSchema = z
  .object({
    frames: z.array(FrameSchema).optional(),
    routing: RoutingFileSchema.partial().optional(),
    rubric: RubricFileSchema.partial().optional(),
  })
  .strict();
export type OverlayFile = z.infer<typeof OverlayFileSchema>;

export interface OverlayApplied {
  path: string;
  /** Frame ids the overlay replaced, and ids it added. Reported so a merge is never silent. */
  replaced_frames: string[];
  added_frames: string[];
  replaced_classes: string[];
  added_classes: string[];
  replaced_dimensions: string[];
  /** sha256 over the overlay's own bytes. On the plan, so a run says which overlay produced it. */
  hash: string;
}

export function overlayHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)}`;
}

export function readOverlay(path: string): { overlay: OverlayFile; hash: string } {
  if (!existsSync(path)) throw new ConfigError([`${path}: missing`]);
  const text = readFileSync(path, "utf8");
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError([`${path}: not valid YAML (${(e as Error).message})`]);
  }
  const r = OverlayFileSchema.safeParse(raw);
  if (!r.success) throw new ConfigError(r.error.issues.map((i) => `${path}: ${i.path.join(".") || "<root>"}: ${i.message}`));
  if (!r.data.frames && !r.data.routing && !r.data.rubric)
    throw new ConfigError([`${path}: an overlay with no frames, routing or rubric changes nothing`]);
  return { overlay: r.data, hash: overlayHash(text) };
}

/**
 * Apply an overlay to the three loaded files, in place of the base definitions it names.
 *
 * Returns what it did as well as the merged files, because a merge nobody can see is the failure
 * mode: `adhd doctor` prints the report, and the plan records the overlay hash, so a run under a
 * merged library can always be traced back to the two files that made it.
 */
export function applyOverlay(
  base: { frames: z.infer<typeof FramesFileSchema>; routing: z.infer<typeof RoutingFileSchema>; rubric: z.infer<typeof RubricFileSchema> },
  overlay: OverlayFile,
  path: string,
  hash: string,
): { frames: typeof base.frames; routing: typeof base.routing; rubric: typeof base.rubric; applied: OverlayApplied } {
  const applied: OverlayApplied = {
    path,
    hash,
    replaced_frames: [],
    added_frames: [],
    replaced_classes: [],
    added_classes: [],
    replaced_dimensions: [],
  };

  let frames = base.frames;
  if (overlay.frames) {
    const byId = new Map(base.frames.frames.map((f) => [f.id, f]));
    for (const f of overlay.frames) {
      const existing = byId.get(f.id);
      if (!existing) applied.added_frames.push(f.id);
      else if (frameHash(existing) !== frameHash(f)) applied.replaced_frames.push(f.id);
      byId.set(f.id, f);
    }
    // Base order first, then anything new, so an overlay that only replaces does not reshuffle the
    // library. Dispatch order comes from a seeded shuffle, but `adhd frames` prints this order and a
    // reader comparing two installs should not see a diff the overlay did not ask for.
    const order = [...base.frames.frames.map((f) => f.id), ...applied.added_frames];
    frames = { ...base.frames, frames: order.map((id) => byId.get(id)!) };
  }

  let routing = base.routing;
  if (overlay.routing) {
    routing = { ...base.routing, ...overlay.routing };
    if (overlay.routing.classes) {
      const classes = { ...base.routing.classes };
      for (const [id, cls] of Object.entries(overlay.routing.classes)) {
        if (!(id in base.routing.classes)) applied.added_classes.push(id);
        else if (!same(base.routing.classes[id], cls)) applied.replaced_classes.push(id);
        classes[id] = cls;
      }
      routing = { ...routing, classes };
    }
    if (overlay.routing.defaults) routing = { ...routing, defaults: { ...base.routing.defaults, ...overlay.routing.defaults } };
  }

  let rubric = base.rubric;
  if (overlay.rubric) {
    rubric = { ...base.rubric, ...overlay.rubric };
    if (overlay.rubric.dimensions) {
      const byId = new Map(base.rubric.dimensions.map((d) => [d.id, d]));
      for (const d of overlay.rubric.dimensions) {
        const existing = byId.get(d.id);
        if (existing && !same(existing, d)) applied.replaced_dimensions.push(d.id);
        byId.set(d.id, d);
      }
      const order = [...base.rubric.dimensions.map((d) => d.id)];
      for (const d of overlay.rubric.dimensions) if (!order.includes(d.id)) order.push(d.id);
      rubric = { ...rubric, dimensions: order.map((id) => byId.get(id)!) };
    }
  }

  // A rubric the overlay touched without moving `version` is the one silent failure left: two
  // installs would write the same `rubric_version` into `score.json` over different weights, and
  // every cross-install comparison of a pass A total would be wrong without saying so.
  const rubricMoved = applied.replaced_dimensions.length > 0 || (overlay.rubric ? !same({ ...base.rubric, version: rubric.version }, { ...rubric }) : false);
  if (rubricMoved && (overlay.rubric?.version === undefined || overlay.rubric.version === base.rubric.version))
    throw new ConfigError([
      `${path}: the overlay changes the rubric without moving \`version\` from ${base.rubric.version}. ` +
        "`score.json` records `rubric_version`, and two installs writing the same version over different " +
        "weights makes every pass A total look comparable when it is not.",
    ]);

  return { frames, routing, rubric, applied };
}
