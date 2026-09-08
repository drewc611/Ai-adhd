// Terminal colour and a progress line (catalogue 30). Never calls a model.
//
// Two rules, both about not lying to a pipe:
//
//   - Colour only when stdout is a TTY and NO_COLOR is unset. A redirected report full of
//     escape codes is a report nobody can grep, and this repository's output is read by tests
//     and by CI step summaries as often as by a person.
//   - A progress line only when stdout is a TTY. Carriage-returning into a log file produces a
//     single unreadable line, which is worse than no progress at all.
//
// Everything here degrades to plain text rather than to nothing, so a piped `adhd os watch`
// still says what happened, one line per change.

const CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  grey: "\u001b[90m",
} as const;

export type Colour = keyof typeof CODES;

/**
 * Is colour wanted here? `NO_COLOR` is honoured because it is the convention every other tool
 * on the machine follows, and `FORCE_COLOR` because CI is not a TTY and sometimes wants it.
 */
export function colourEnabled(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "" && env["FORCE_COLOR"] !== "0") return true;
  return Boolean(stream.isTTY);
}

export function paint(text: string, colour: Colour, enabled = colourEnabled()): string {
  return enabled ? `${CODES[colour]}${text}${CODES.reset}` : text;
}

/** The colour a run state should read in. Terminal states are the ones worth spotting. */
export function stateColour(state: string): Colour {
  if (state === "done" || state === "done_run_level") return "green";
  if (state === "aborted") return "red";
  if (state === "cancelled") return "yellow";
  if (state === "awaiting_confirm") return "blue";
  return "grey";
}

export interface StatusLike {
  run_id: string;
  state: string;
  problem_class: string;
  n: number;
  priority?: number;
  tasks: { pending: number; leased: number; done: number; dropped: number; dead: number };
  reason: string | null;
}

/** One line per run, coloured by state. The same text without colour when piped. */
export function statusLine(s: StatusLike, enabled = colourEnabled()): string {
  const t = s.tasks;
  const total = t.pending + t.leased + t.done + t.dropped + t.dead;
  const bar = `${t.done}/${total} done`;
  const extra = [t.leased ? `${t.leased} leased` : "", t.pending ? `${t.pending} pending` : "", t.dead ? paint(`${t.dead} dead`, "red", enabled) : ""].filter(Boolean).join(", ");
  const prio = s.priority ? paint(` p${s.priority}`, "bold", enabled) : "";
  return `${s.run_id.padEnd(22)} ${paint(s.state.padEnd(16), stateColour(s.state), enabled)} ${s.problem_class.padEnd(18)} n=${s.n}${prio}  ${bar}${extra ? `  (${extra})` : ""}${s.reason ? `  ${paint(s.reason, "dim", enabled)}` : ""}`;
}

/**
 * A progress renderer that redraws in place on a terminal and appends one line per change
 * anywhere else.
 *
 * The change detection is the point. A watcher that reprints an unchanged status every second
 * fills a log with noise and buries the one line that mattered; this prints only when the text
 * it would print has changed.
 */
export class Progress {
  private last = "";
  private lines = 0;
  constructor(
    private readonly write: (s: string) => void = (s) => process.stdout.write(s),
    private readonly tty: boolean = Boolean(process.stdout.isTTY),
  ) {}

  render(text: string): void {
    if (text === this.last) return;
    this.last = text;
    if (!this.tty) {
      this.write(text.endsWith("\n") ? text : text + "\n");
      return;
    }
    // Move up over what was drawn last time and clear each line, then draw.
    const up = this.lines ? `\u001b[${this.lines}A` : "";
    const cleared = text
      .split("\n")
      .map((l) => `\u001b[2K${l}`)
      .join("\n");
    this.write(`${up}\r${cleared}\n`);
    this.lines = text.split("\n").length;
  }

  /** Leave the cursor somewhere sane and stop owning the lines above it. */
  done(): void {
    this.lines = 0;
    this.last = "";
  }
}
