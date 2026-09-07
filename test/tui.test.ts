import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { cfg } from "./helpers.js";
import { select, ask, wizard } from "../src/tui.js";
import { UsageError } from "../src/errors.js";

/**
 * A menu is testable if you drive it with a fake terminal. `emitKeypressEvents` works on any
 * readable stream, so the only thing a real TTY provides that matters here is `isTTY` and
 * `setRawMode`, and both are cheap to stand in for.
 */
function fakeTty(isTty = true) {
  const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (m: boolean) => void; raw: boolean[] };
  const output = new PassThrough() as unknown as NodeJS.WriteStream & { text: () => string };
  const raw: boolean[] = [];
  Object.assign(input, { isTTY: isTty, setRawMode: (m: boolean) => raw.push(m), raw });
  const chunks: string[] = [];
  output.write = ((c: string | Buffer) => {
    chunks.push(c.toString());
    return true;
  }) as typeof output.write;
  Object.assign(output, { isTTY: isTty, text: () => chunks.join("") });
  return { input, output, raw };
}

/** Everything the escape codes hide, so an assertion reads what a person would see. */
const plain = (s: string) => s.replace(/\[[0-9;]*[A-Za-z]/g, "");

const key = (input: NodeJS.ReadStream, name: string) => input.emit("keypress", "", { name });

test("a menu returns the value under the cursor when enter is pressed", async () => {
  const io = fakeTty();
  const p = select(io, "Pick", [
    { value: "a", label: "first" },
    { value: "b", label: "second" },
    { value: "c", label: "third" },
  ]);
  key(io.input, "down");
  key(io.input, "down");
  key(io.input, "return");
  assert.equal(await p, "c");
});

test("j and k move the cursor as well as the arrows", async () => {
  const io = fakeTty();
  const p = select(io, "Pick", [{ value: 1, label: "one" }, { value: 2, label: "two" }]);
  key(io.input, "j");
  key(io.input, "k");
  key(io.input, "j");
  key(io.input, "return");
  assert.equal(await p, 2);
});

test("the cursor wraps at both ends rather than sticking", async () => {
  const io = fakeTty();
  const p = select(io, "Pick", [{ value: "a", label: "a" }, { value: "b", label: "b" }, { value: "c", label: "c" }]);
  key(io.input, "up"); // from the first item, wraps to the last
  key(io.input, "return");
  assert.equal(await p, "c");
});

test("q backs out and returns null, which every caller treats as cancel", async () => {
  const io = fakeTty();
  const p = select(io, "Pick", [{ value: "a", label: "a" }]);
  key(io.input, "q");
  assert.equal(await p, null);
});

test("ctrl-c backs out too, and does not leave the terminal in raw mode", async () => {
  const io = fakeTty();
  const p = select(io, "Pick", [{ value: "a", label: "a" }]);
  io.input.emit("keypress", "", { name: "c", ctrl: true });
  assert.equal(await p, null);
  assert.deepEqual(io.raw, [true, false], "raw mode must be turned back off on every exit path");
});

test("an empty menu resolves null instead of drawing nothing and waiting forever", async () => {
  assert.equal(await select(fakeTty(), "Pick", []), null);
});

test("the menu shows every label, its hint, and how to drive it", async () => {
  const io = fakeTty();
  const p = select(io, "Which run?", [
    { value: "a", label: "001-first-run", hint: "5 frames" },
    { value: "b", label: "002-kernel-enduser", hint: "pruned END_USER" },
  ]);
  key(io.input, "return");
  await p;
  const t = plain(io.output.text());
  assert.match(t, /Which run\?/);
  assert.match(t, /001-first-run/);
  assert.match(t, /pruned END_USER/);
  assert.match(t, /↑↓ move · enter choose · q back/, "a menu that does not say how to drive it is a menu you guess at");
});

/**
 * Piped or redirected, the wizard has to say so and point at the flags. Silently doing nothing,
 * or worse blocking forever on a stream that will never deliver a keypress, is the failure mode
 * that makes a tool feel broken in CI.
 */
test("without a terminal every entry point refuses with a usage error", async () => {
  const io = fakeTty(false);
  await assert.rejects(() => select(io, "Pick", [{ value: 1, label: "one" }]), UsageError);
  await assert.rejects(() => ask(io, "Name?"), UsageError);
  await assert.rejects(() => wizard(cfg, io), UsageError);
  try {
    await wizard(cfg, io);
  } catch (e) {
    assert.match((e as UsageError).message, /adhd --help/, "the refusal has to name the way forward");
  }
});

test("a prompt falls back to its default on an empty answer", async () => {
  const io = fakeTty();
  const p = ask(io, "Seed", "1");
  io.input.write("\n");
  assert.equal(await p, "1");
});

test("a prompt returns what was typed, trimmed", async () => {
  const io = fakeTty();
  const p = ask(io, "Seed", "1");
  io.input.write("  7  \n");
  assert.equal(await p, "7");
});

/** Quitting the top menu leaves rather than looping, which an off-by-one here would break. */
test("the wizard exits on the quit entry", async () => {
  const io = fakeTty();
  const done = wizard(cfg, io);
  // The quit entry is last; one up from the top wraps onto it.
  key(io.input, "up");
  key(io.input, "return");
  await done;
  assert.match(plain(io.output.text()), /Bye\./);
});

test("the wizard's opening menu offers the recorded runs it can actually see", async () => {
  const io = fakeTty();
  const done = wizard(cfg, io);
  key(io.input, "up");
  key(io.input, "return");
  await done;
  const t = plain(io.output.text());
  assert.match(t, /Read a recorded run/);
  assert.match(t, /\d+ on disk/, "the hint should count what is there, not assert a number");
  assert.match(t, /Build the run explorer page/);
  assert.match(t, /prints the command it ran/, "the point of the wizard is that the flags get learned");
});
