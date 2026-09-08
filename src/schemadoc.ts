// docs/CONFIG.md, generated from the zod schemas (catalogue 57). Never calls a model.
//
// A hand-written schema reference is a document that describes the config as it was when
// somebody last remembered to edit it. This repository has already had that failure twice: the
// README's layout block omitted three directories, and `docs/RETIREMENT.md`'s standing table
// missed a frame the tooling had put on its own list. Both were caught by a test comparing the
// prose to the thing it described, which is the same shape as this: the doc is generated, and a
// test fails when the checked-in copy differs from what the schemas now produce.
//
// What it cannot do is explain *why* a field exists. That reasoning lives in the JSDoc beside
// each field and in `docs/DECISIONS.md`, and this file says so rather than pretending the
// generated table is the whole story.
import { z } from "zod";
import {
  FrameSchema,
  FramesFileSchema,
  RunClassSchema,
  DeclineClassSchema,
  RoutingDefaultsSchema,
  RoutingFileSchema,
  DimensionSchema,
  HardRulesSchema,
  RubricFileSchema,
} from "./schema.js";

interface FieldDoc {
  name: string;
  type: string;
  required: boolean;
  default: string | null;
  constraints: string[];
}

/** zod v4 keeps the useful shape on `_def`. Unwrapped here rather than at every call site. */
function describe(schema: z.ZodTypeAny): { type: string; required: boolean; def: string | null; constraints: string[] } {
  const d = (schema as unknown as { _def: Record<string, unknown> })._def;
  const kind = String(d["type"] ?? "");
  const constraints: string[] = [];

  if (kind === "default" || kind === "optional" || kind === "nullable") {
    const inner = describe(d["innerType"] as z.ZodTypeAny);
    let def: string | null = inner.def;
    if (kind === "default") {
      const raw = d["defaultValue"];
      const value = typeof raw === "function" ? (raw as () => unknown)() : raw;
      def = JSON.stringify(value);
    }
    return { type: kind === "nullable" ? `${inner.type} or null` : inner.type, required: false, def, constraints: inner.constraints };
  }

  for (const c of (d["checks"] as { _zod?: { def?: Record<string, unknown> } }[] | undefined) ?? []) {
    const cd = c._zod?.def;
    if (!cd) continue;
    const check = String(cd["check"] ?? "");
    if (check === "min_length") constraints.push(`min length ${cd["minimum"]}`);
    else if (check === "max_length") constraints.push(`max length ${cd["maximum"]}`);
    else if (check === "greater_than") constraints.push(`> ${cd["value"]}`);
    else if (check === "less_than") constraints.push(`< ${cd["value"]}`);
    else if (check === "string_format" && cd["pattern"]) constraints.push(`matches \`${String(cd["pattern"])}\``);
    // "number format" is what zod calls "this is an int", which the type column already says.
    else if (check && check !== "number_format") constraints.push(check.replace(/_/g, " "));
  }

  if (kind === "array") {
    const el = describe(d["element"] as z.ZodTypeAny);
    // An enum element needs bracketing, or `A \| B[]` reads as "A, or a list of B".
    return { type: el.type.includes("\\|") ? `(${el.type})[]` : `${el.type}[]`, required: true, def: null, constraints };
  }
  if (kind === "enum") {
    const values = Object.keys((d["entries"] as Record<string, unknown>) ?? {});
    return { type: values.map((v) => `\`${v}\``).join(" \\| "), required: true, def: null, constraints };
  }
  if (kind === "record") return { type: "map", required: true, def: null, constraints };
  if (kind === "object") return { type: "object", required: true, def: null, constraints };
  if (kind === "union") return { type: "one of several shapes", required: true, def: null, constraints };
  if (kind === "literal") return { type: `\`${JSON.stringify((d["values"] as unknown[])?.[0])}\``, required: true, def: null, constraints };
  return { type: kind || "unknown", required: true, def: null, constraints };
}

function fields(schema: z.ZodObject<z.ZodRawShape>): FieldDoc[] {
  return Object.entries(schema.shape).map(([name, s]) => {
    const d = describe(s as z.ZodTypeAny);
    return { name, type: d.type, required: d.required, default: d.def, constraints: d.constraints };
  });
}

function table(title: string, file: string, schema: z.ZodObject<z.ZodRawShape>, note?: string): string[] {
  const out = [`### ${title}`, ""];
  if (note) out.push(note, "");
  out.push(`Read from \`${file}\`.`, "", "| field | type | required | default | constraints |", "|---|---|---|---|---|");
  for (const f of fields(schema))
    out.push(`| \`${f.name}\` | ${f.type} | ${f.required ? "yes" : "no"} | ${f.default ?? "—"} | ${f.constraints.join(", ") || "—"} |`);
  out.push("");
  return out;
}

export function configDoc(): string {
  const out: string[] = [
    "# Config reference",
    "",
    "**Generated from the zod schemas in `src/schema.ts` by `adhd schema-doc`. Do not edit by hand:",
    "a test fails when this file and the schemas disagree.**",
    "",
    "Every field below is validated before any command runs, and `crossCheck` in `src/config.ts`",
    "adds the rules a per-field schema cannot express — an unknown frame in a routing class, two",
    "primary frames sharing an axis, `n` over `hard_cap`, a `former_id` two frames both claim.",
    "Those raise `ConfigError` and exit 4.",
    "",
    "This table says what a field *is*. It cannot say why it exists: that reasoning is in the JSDoc",
    "beside each field in `src/schema.ts`, in the comments at the top of each `config/` file, and in",
    "`docs/DECISIONS.md`. A generated reference is honest about its shape and silent about its intent.",
    "",
    "## config/frames.yaml",
    "",
  ];
  out.push(...table("File", "config/frames.yaml", FramesFileSchema));
  out.push(
    ...table(
      "A frame",
      "config/frames.yaml",
      FrameSchema,
      "`stance`, `probes` and `forbidden` are the product. `former_ids` forwards a rename so recorded runs keep resolving (D6); it is bookkeeping and is deliberately excluded from the `frame_hash` that detects a *redefinition*, so renaming a frame never reads as redefining it.",
    ),
  );
  out.push("## config/routing.yaml", "");
  out.push(...table("File", "config/routing.yaml", RoutingFileSchema));
  out.push(...table("Defaults", "config/routing.yaml", RoutingDefaultsSchema));
  out.push(
    ...table(
      "A class that runs",
      "config/routing.yaml",
      RunClassSchema,
      "`frames` is the preferred set and `alternates` fills the shortfall. A class that cannot reach its own `n` from both lists together is an error `adhd doctor` reports, because the plan would claim `n` and dispatch fewer.",
    ),
  );
  out.push(
    ...table(
      "A class that declines",
      "config/routing.yaml",
      DeclineClassSchema,
      "A decline is a first-class outcome. `reason` is non-empty because a decline the user cannot learn anything from has rotted even while still declining.",
    ),
  );
  out.push("## config/critic-rubric.yaml", "");
  out.push(...table("File", "config/critic-rubric.yaml", RubricFileSchema));
  out.push(
    ...table(
      "A dimension",
      "config/critic-rubric.yaml",
      DimensionSchema,
      "`pass_a` is a weighted total across every dimension, so all of them must use the same anchor range: one on a wider scale counts for more than its weight states. `adhd doctor` checks that, along with anchors being contiguous from zero.",
    ),
  );
  out.push(...table("Hard rules", "config/critic-rubric.yaml", HardRulesSchema));
  out.push("---", "", "Regenerate with `adhd schema-doc > docs/CONFIG.md`.");
  return out.join("\n") + "\n";
}
