import { createHash } from "node:crypto";

/**
 * problem_hash is sha256 over the exact UTF-8 bytes of the problem statement. No trim, no
 * newline normalisation. Two statements that differ by a trailing newline are two problems,
 * and a host that "tidied" the text is caught by the branch echo.
 */
export function problemHash(problem: string | Uint8Array): string {
  const h = createHash("sha256");
  h.update(typeof problem === "string" ? Buffer.from(problem, "utf8") : problem);
  return `sha256:${h.digest("hex")}`;
}

export const PLACEHOLDER_HASH = "sha256:pending";

/**
 * A frame's definition, hashed (catalogue 53).
 *
 * A rename is handled by `former_ids`. A *stance* edit is not handled by anything: change what
 * PARTICULARIST is instructed to do and every recorded run still says PARTICULARIST, so the
 * corpus silently claims a frame produced a position that a differently-worded frame produced.
 * `frames --stats` would pool the two as one frame, `--orthogonality` would pool their pair
 * histories, and `docs/RETIREMENT.md`'s bar would be counted across both.
 *
 * The same argument as `rubric_version`: stamping costs nothing and makes a future change
 * legible, and the alternative is a corpus that cannot say which version of a frame it recorded.
 *
 * Hashed over exactly the fields that change what a branch is asked to do. `name` is display
 * text and `former_ids` is bookkeeping, so neither is included: renaming a frame must not read
 * as redefining it, which is the whole point of having both mechanisms.
 */
export function frameHash(frame: { axis: string; attacks: string[]; tools: string[]; stance: string; probes: string[]; forbidden: string[] }): string {
  const canonical = JSON.stringify({
    axis: frame.axis,
    attacks: [...frame.attacks].sort(),
    tools: [...frame.tools].sort(),
    stance: frame.stance,
    probes: frame.probes,
    forbidden: frame.forbidden,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16)}`;
}
