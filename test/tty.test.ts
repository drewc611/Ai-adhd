import { test } from "node:test";
import assert from "node:assert/strict";
import { Progress, colourEnabled, paint, stateColour, statusLine, type StatusLike } from "../src/tty.js";

const ESC = "\u001b";
const strip = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

const run = (over: Partial<StatusLike> = {}): StatusLike => ({
  run_id: "r1",
  state: "diverge",
  problem_class: "design_decision",
  n: 5,
  priority: 0,
  tasks: { pending: 3, leased: 1, done: 1, dropped: 0, dead: 0 },
  reason: null,
  ...over,
});

test("colour is off when piped, off under NO_COLOR, and forceable for CI", () => {
  // A redirected report full of escape codes is a report nobody can grep, and this repository's
  // output is read by tests and CI step summaries as often as by a person.
  assert.equal(colourEnabled({ isTTY: false }, {}), false);
  assert.equal(colourEnabled({ isTTY: true }, {}), true);
  assert.equal(colourEnabled({ isTTY: true }, { NO_COLOR: "1" }), false, "NO_COLOR is the convention every other tool follows");
  assert.equal(colourEnabled({ isTTY: true }, { NO_COLOR: "" }), true, "an empty NO_COLOR is not set");
  // CI is not a TTY and sometimes wants colour anyway.
  assert.equal(colourEnabled({ isTTY: false }, { FORCE_COLOR: "1" }), true);
  assert.equal(colourEnabled({ isTTY: false }, { FORCE_COLOR: "0" }), false);
  // NO_COLOR wins: turning colour off is the safer direction to be wrong in.
  assert.equal(colourEnabled({ isTTY: true }, { NO_COLOR: "1", FORCE_COLOR: "1" }), false);
});

test("a status line is the same text with and without colour", () => {
  const plain = statusLine(run(), false);
  assert.equal(strip(statusLine(run(), true)), plain, "colour changed the text, not just its appearance");
  assert.match(plain, /r1\s+diverge\s+design_decision\s+n=5\s+1\/5 done\s+\(1 leased, 3 pending\)/);
  assert.ok(!plain.includes(ESC), "an escape code reached the uncoloured path");
});

test("terminal states are the ones worth spotting, and dead tasks are called out", () => {
  assert.equal(stateColour("done"), "green");
  assert.equal(stateColour("aborted"), "red");
  assert.equal(stateColour("cancelled"), "yellow");
  assert.equal(stateColour("awaiting_confirm"), "blue");
  assert.equal(stateColour("diverge"), "grey");

  // `dead` is distinct from `dropped` in the kernel and stays distinct here: a run that died
  // because a task could never be completed is not a run somebody cancelled.
  const line = statusLine(run({ state: "aborted", tasks: { pending: 0, leased: 0, done: 1, dropped: 3, dead: 1 }, reason: "task expired 3 times" }), false);
  assert.match(line, /1 dead/);
  assert.match(line, /task expired 3 times/);
  assert.ok(!/dropped/.test(line), "dropped siblings are noise on a line about what went wrong");
});

test("priority shows only when it is not the default", () => {
  assert.ok(!statusLine(run({ priority: 0 }), false).includes("p0"), "every run would carry p0 and the flag would mean nothing");
  assert.match(statusLine(run({ priority: 5 }), false), /n=5 p5/);
});

test("progress redraws in place on a terminal and appends one line per change when piped", () => {
  // Carriage-returning into a log file produces one unreadable line, which is worse than no
  // progress at all.
  const piped: string[] = [];
  const p = new Progress((s) => piped.push(s), false);
  p.render("a");
  p.render("a");
  p.render("b");
  assert.deepEqual(piped, ["a\n", "b\n"], "an unchanged status was reprinted, or a change was swallowed");

  const tty: string[] = [];
  const q = new Progress((s) => tty.push(s), true);
  q.render("one");
  q.render("two");
  assert.ok(tty[0]!.includes("one"));
  assert.ok(tty[1]!.includes(`${ESC}[1A`), "the second draw did not move up over the first");
  assert.ok(tty[1]!.includes(`${ESC}[2K`), "the second draw did not clear the line it overwrites");
});

test("paint is a no-op when colour is off, so nothing has to branch at the call site", () => {
  assert.equal(paint("x", "red", false), "x");
  assert.equal(paint("x", "red", true), `${ESC}[31mx${ESC}[0m`);
});
