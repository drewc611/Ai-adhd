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
