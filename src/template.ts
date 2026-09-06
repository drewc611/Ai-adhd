/**
 * A tiny mustache-shaped renderer with exactly three constructs:
 *   {{path}}                      lookup, dotted; arrays join with "\n"; null/undefined -> ""
 *   {{#each path}}...{{/each}}    iterate; inside, {{this}} is the item and fields resolve on it
 *   {{#if path}}...{{/if}}        truthy test (non-empty arrays and strings are truthy)
 *
 * The template is tokenised once and values are inserted without rescanning. That is the
 * property the compiler relies on: a problem statement containing "{{" is passed through
 * byte for byte.
 */
type Ctx = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined;

type Token =
  | { kind: "text"; text: string }
  | { kind: "var"; path: string }
  | { kind: "each"; path: string; body: Token[] }
  | { kind: "if"; path: string; body: Token[] };

// One quantifier, and it cannot match a brace. The previous spelling put an optional
// directive alternation and two `\s*` around a lazy `[^{}]*?`, all of which can match the
// same characters, so the engine had to try every split: quadratic on template text.
// The directive is a prefix of the captured body, so code reads it instead of the pattern.
const TAG = /\{\{([^{}]*)\}\}/g;
const DIRECTIVES = ["#each", "#if", "/each", "/if"] as const;

/** Split "{{#each xs}}" into its directive and its expression. */
function splitTag(inner: string): { directive: string; expr: string } {
  const t = inner.trim();
  for (const d of DIRECTIVES)
    if (t === d || t.startsWith(`${d} `)) return { directive: d, expr: t.slice(d.length).trim() };
  return { directive: "", expr: t };
}

export function tokenize(tpl: string): Token[] {
  const root: Token[] = [];
  const stack: { kind: "each" | "if"; path: string; body: Token[]; parent: Token[] }[] = [];
  let cur = root;
  let last = 0;
  for (const m of tpl.matchAll(TAG)) {
    const idx = m.index ?? 0;
    if (idx > last) cur.push({ kind: "text", text: tpl.slice(last, idx) });
    last = idx + m[0].length;
    const { directive: op, expr: arg } = splitTag(m[1] ?? "");
    if (op === "#each" || op === "#if") {
      const frame = { kind: op.slice(1) as "each" | "if", path: arg, body: [] as Token[], parent: cur };
      stack.push(frame);
      cur = frame.body;
    } else if (op === "/each" || op === "/if") {
      const frame = stack.pop();
      if (!frame || frame.kind !== op.slice(1)) throw new Error(`template: unbalanced ${op}`);
      cur = frame.parent;
      cur.push({ kind: frame.kind, path: frame.path, body: frame.body } as Token);
    } else {
      cur.push({ kind: "var", path: arg });
    }
  }
  if (stack.length) throw new Error(`template: unclosed block ${stack[stack.length - 1]!.kind}`);
  if (last < tpl.length) cur.push({ kind: "text", text: tpl.slice(last) });
  return root;
}

function lookup(ctx: Ctx, path: string, scopes: Ctx[]): unknown {
  if (path === "this") return scopes[scopes.length - 1];
  const parts = path.split(".");
  // Innermost scope first, then outward, then root.
  for (let s = scopes.length - 1; s >= -1; s--) {
    let v: unknown = s >= 0 ? scopes[s] : ctx;
    let ok = true;
    for (const p of parts) {
      if (v !== null && typeof v === "object" && p in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        ok = false;
        break;
      }
    }
    if (ok) return v;
  }
  return undefined;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(str).join("\n");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.length > 0;
  return Boolean(v);
}

function renderTokens(tokens: Token[], ctx: Ctx, scopes: Ctx[]): string {
  let out = "";
  for (const t of tokens) {
    if (t.kind === "text") out += t.text;
    else if (t.kind === "var") out += str(lookup(ctx, t.path, scopes));
    else if (t.kind === "if") {
      if (truthy(lookup(ctx, t.path, scopes))) out += renderTokens(t.body, ctx, scopes);
    } else {
      const v = lookup(ctx, t.path, scopes);
      if (Array.isArray(v)) for (const item of v) out += renderTokens(t.body, ctx, [...scopes, item as Ctx]);
    }
  }
  return out;
}

export function render(tpl: string, ctx: Record<string, unknown>): string {
  return renderTokens(tokenize(tpl), ctx, []);
}
