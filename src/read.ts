import { existsSync, readFileSync, statSync } from "node:fs";
import { ConfigError } from "./errors.js";

/**
 * Read one JSON file out of a run directory, or return null when there is nothing to read.
 *
 * Every reader in this repo used to spell this `existsSync(p) ? JSON.parse(readFileSync(p)) : null`,
 * about twenty times, and that shape has three defects that only show up on somebody else's runner.
 *
 * **An empty file is not an absent one to `existsSync`, and is not a parseable one to `JSON.parse`.**
 * `adhd run --phase deepen` writes `score.json`; a phase killed between `open` and `write`, a full
 * disk, or an interrupted `cp -r` of a run directory all leave a zero-byte file behind. A
 * half-written recording should read as a recording missing that file, which every caller here
 * already handles, rather than as a crash.
 *
 * **A parse error named no file.** `Unexpected end of JSON input` with a stack through
 * `JSON.parse (<anonymous>)` tells a user nothing about which of fifteen recordings to look at.
 * Genuine corruption is still an error — skipping it silently is how a viewer comes to disagree
 * with the synthesis it is rendering — but it says which file now.
 *
 * **A short read looks exactly like corruption, and the two want opposite responses.** CI has now
 * failed twice on files `git` checked out and nothing writes: once with zero bytes, once with 8,176
 * of a 16,190-byte `score.json`, both inside `adhd viewer`, neither reproducible locally over
 * dozens of full-suite runs. The cause on that runner is *not established* and nothing here claims
 * one. What is established is that the same byte range read again came back whole, so this re-reads
 * once before calling a file corrupt, and says what it saw either way.
 *
 * The re-read is not a retry loop and is not a fix. It is the difference between a flake that
 * reports "not valid JSON" and one that reports "read 8176 of 16190 bytes, and the same file read
 * whole on the second attempt" — which is a fact about the filesystem rather than about the
 * corpus, and which is what the next occurrence needs to say to be worth anything.
 *
 * `parse` runs after the JSON parse so a schema can reject what the syntax accepted, and its
 * failures are attributed the same way.
 */
export function readJsonIf<T>(path: string, parse: (value: unknown) => T = (v) => v as T): T | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  if (raw.trim() === "") return null;
  const value = parseOrReread(path, raw, () => readFileSync(path, "utf8"));
  try {
    return parse(value);
  } catch (e) {
    throw new ConfigError([`${path}: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

/**
 * The parse, and the one re-read. Split out because the branch that matters cannot be reached by
 * writing a file: it needs two reads of one path to return different bytes, which is the thing
 * that is not supposed to happen and is exactly what CI saw. The test supplies `reread`.
 */
export function parseOrReread(path: string, raw: string, reread: () => string): unknown {
  try {
    return JSON.parse(raw);
  } catch (first) {
    const again = reread();
    if (again === raw) throw new ConfigError([describe(path, raw, first)]);
    // The bytes changed between two reads a moment apart, so the first read was of a file in
    // motion rather than of a broken one. Take the second and say so: a command that silently
    // recovered from this is one whose report was a re-read away from having been wrong.
    let value: unknown;
    try {
      value = JSON.parse(again);
    } catch {
      throw new ConfigError([describe(path, again, first)]);
    }
    process.stderr.write(
      `warn: ${path} read short (${Buffer.byteLength(raw)} of ${Buffer.byteLength(again)} bytes) and read whole on retry. ` +
        `Nothing in this repository writes there during a command; the cause is not established.\n`,
    );
    return value;
  }
}

/** Bytes read against bytes on disk, because "position 8176" says nothing without the size. */
function describe(path: string, raw: string, cause: unknown): string {
  const read = Buffer.byteLength(raw);
  let size: number | null = null;
  try {
    size = statSync(path).size;
  } catch {
    /* the file went away between the read and the stat, which is itself worth not crashing on */
  }
  const short = size !== null && read < size ? `, read ${read} of ${size} bytes on disk` : `, ${read} bytes`;
  return `${path}: not valid JSON (${cause instanceof Error ? cause.message : String(cause)})${short}`;
}
