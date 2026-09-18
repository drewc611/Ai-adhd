import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./helpers.js";
import { parseOrReread, readJsonIf } from "../src/read.js";
import { ConfigError } from "../src/errors.js";

function file(name: string, body: string): string {
  const dir = tmp();
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

/** Capture what a call writes to stderr, so a silent recovery cannot pass as a clean read. */
function captureStderr(fn: () => void): string {
  const original = process.stderr.write.bind(process.stderr);
  let seen = "";
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    seen += s;
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
  }
  return seen;
}

test("an absent file reads as absent rather than throwing", () => {
  assert.equal(readJsonIf(join(tmp(), "nothing.json")), null);
});

/*
 * `existsSync` says yes to a zero-byte file and `JSON.parse` says no. A phase killed between open
 * and write, a full disk, or an interrupted `cp -r` of a run directory all leave one behind, and
 * every caller already handles a recording missing that file.
 */
test("an empty file reads as absent, not as corruption", () => {
  assert.equal(readJsonIf(file("score.json", "")), null);
  assert.equal(readJsonIf(file("score.json", "   \n\t ")), null, "whitespace is not content either");
});

test("a malformed file names itself and says how much of it was read", () => {
  const p = file("score.json", '{"a": 1,');
  assert.throws(
    () => readJsonIf(p),
    (e: Error) => e instanceof ConfigError && e.message.includes(p) && / 8 bytes/.test(e.message),
    "the error carries the path and the size, because a byte position alone says nothing",
  );
});

test("a schema rejection is attributed to the file the same way a syntax error is", () => {
  const p = file("score.json", '{"a": 1}');
  assert.throws(
    () => readJsonIf(p, () => {
      throw new Error("frames must be an array");
    }),
    (e: Error) => e instanceof ConfigError && e.message.includes(p) && e.message.includes("frames must be an array"),
  );
});

test("a file that parses on the first read is not re-read at all", () => {
  let rereads = 0;
  const v = parseOrReread("/x/score.json", '{"n": 5}', () => {
    rereads++;
    return "";
  });
  assert.deepEqual(v, { n: 5 });
  assert.equal(rereads, 0, "a healthy read must not pay for the flake path");
});

/*
 * The CI flake this exists for. Twice a file git checked out and nothing writes came back short
 * inside `adhd viewer`: once at zero bytes, once at 8,176 of 16,190. The cause on that runner is
 * not established, and a short read must not be reported as a corrupt corpus.
 */
test("a path whose two reads differ is re-read, taken, and reported", () => {
  let value: unknown;
  const warned = captureStderr(() => {
    value = parseOrReread("/x/score.json", '{"frames":', () => '{"frames": [], "n": 5}');
  });
  assert.deepEqual(value, { frames: [], n: 5 });
  assert.match(warned, /read short \(10 of 22 bytes\) and read whole on retry/);
  assert.match(warned, /the cause is not established/, "a recovery that claims a diagnosis is worse than one that does not");
});

test("a path whose two reads agree is corrupt, and is still an error", () => {
  const warned = captureStderr(() => {
    assert.throws(
      () => parseOrReread("/x/score.json", "{ not json", () => "{ not json"),
      (e: Error) => e instanceof ConfigError && e.message.includes("/x/score.json"),
    );
  });
  assert.equal(warned, "", "corruption is thrown, not warned about");
});

test("a second read that is different and also broken is corruption, not a recovery", () => {
  assert.throws(
    () => parseOrReread("/x/score.json", "{ not", () => "{ not json either"),
    (e: Error) => e instanceof ConfigError && /not valid JSON/.test(e.message),
  );
});
