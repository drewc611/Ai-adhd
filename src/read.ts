import { existsSync, readFileSync } from "node:fs";
import { ConfigError } from "./errors.js";

/**
 * Read one JSON file out of a run directory, or return null when there is nothing to read.
 *
 * Every reader in this repo used to spell this `existsSync(p) ? JSON.parse(readFileSync(p)) : null`,
 * about twenty times, and that shape has two defects that only show up on a corpus somebody else
 * wrote.
 *
 * **An empty file is not an absent one to `existsSync`, and is not a parseable one to `JSON.parse`.**
 * `adhd run --phase deepen` writes `score.json`; a phase killed between `open` and `write`, a full
 * disk, or an interrupted `cp -r` of a run directory all leave a zero-byte file behind. CI caught
 * exactly this on `evals/recorded` at a commit whose suite was green locally: `adhd viewer` died
 * inside `JSON.parse`. A half-written recording should read as a recording missing that file, which
 * every caller here already handles, rather than as a crash.
 *
 * **A parse error named no file.** `Unexpected end of JSON input` with a stack through
 * `JSON.parse (<anonymous>)` tells a user nothing about which of fifteen recordings to look at.
 * Genuine corruption is still an error — skipping it silently is how a viewer comes to disagree
 * with the synthesis it is rendering — but it says which file now.
 *
 * `parse` runs after the JSON parse so a schema can reject what the syntax accepted, and its
 * failures are attributed the same way.
 */
export function readJsonIf<T>(path: string, parse: (value: unknown) => T = (v) => v as T): T | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  if (raw.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError([`${path}: not valid JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  try {
    return parse(value);
  } catch (e) {
    throw new ConfigError([`${path}: ${e instanceof Error ? e.message : String(e)}`]);
  }
}
