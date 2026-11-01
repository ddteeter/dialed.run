/**
 * Assembles the plan-survey page from the four agents' JSON.
 *
 *     npm run plan-survey -- <survey-dir> <out.html> [--previous <data.json | page.html>]
 *     npm run plan-survey -- --extract <page.html> <previous-deferred.json>
 *
 * The `plan-survey` skill's build step (`.claude/skills/plan-survey/`, whose
 * `template.html` this fills). It lives here rather than beside the skill
 * because TypeScript's globs skip dot-directories, so nothing would lint or
 * typecheck it there.
 *
 * `<survey-dir>` holds initial-plan.json, deferred.json, design.json,
 * journey.json and narrative.json (shapes in the skill's agents.md and
 * SKILL.md, and below). Writes `<out.html>` and, beside it,
 * `<out>.data.json`: the data the page embeds, which the next run passes
 * back as `--previous`. `--extract` pulls the deferred list out of a
 * published page, for the deferred agent's stable-id step.
 *
 * **Every input is agent output**, so each is parsed, not trusted: a brief
 * that drifted from its shape fails here, naming the file, rather than
 * rendering a page with holes in it.
 *
 * **The brand is read, not copied.** The page takes its palette, roles and
 * faces from `src/ui/tokens.css` at build time — the `:root` block as the
 * light theme, `@utility ground-ink` as the dark one — so a palette change
 * in the app reaches the survey with no one keeping the two in step.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { z } from "zod";

const repoRoot = path.resolve(import.meta.dirname, "..");
const TEMPLATE = path.join(
  repoRoot,
  ".claude/skills/plan-survey/template.html",
);
const FIRST_DAY = Date.parse("2026-08-30");
const DAY_MS = 86_400_000;

// ---- the agents' shapes (agents.md) ---------------------------------------

const deferredClass = z.enum([
  "open-tracked",
  "open-orphaned",
  "done-later",
  "register-stale",
]);
const severity = z.enum(["launch-blocker", "important", "minor"]);
const deferredItem = z.object({
  id: z.string(),
  title: z.string(),
  what: z.string(),
  deferred_on: z.string().nullish(),
  source: z.string(),
  class: deferredClass,
  status_in_register: z.string().nullish(),
  evidence: z.string(),
  area: z.string(),
  severity,
  age_days: z.number().nullish(),
  verified: z.boolean().optional(),
});
type DeferredItem = z.infer<typeof deferredItem>;
const deferredFile = z.object({ items: z.array(deferredItem) });

/**
 * The rest of the agents' rows, as agents.md writes them: the text fields,
 * the ones that may be missing, and each status field's scale. The page
 * only serialises these, so one table and one builder describe them, not a
 * hand-written schema per row that drifts from the brief on its own.
 */
interface RowShape {
  readonly text: readonly string[];
  readonly optional?: readonly string[];
  readonly scales?: Readonly<Record<string, readonly [string, ...string[]]>>;
  readonly numbers?: readonly string[];
}

function field(name: string, type: z.ZodType): readonly [string, z.ZodType] {
  return [name, type];
}

function row(shape: RowShape) {
  const scaled = Object.entries(shape.scales ?? {});
  const entries: (readonly [string, z.ZodType])[] = [
    ...shape.text.map((name) => field(name, z.string())),
    ...(shape.optional ?? []).map((name) => field(name, z.string().nullish())),
    ...(shape.numbers ?? []).map((name) => field(name, z.number())),
    ...scaled.map(([name, scale]) => field(name, z.enum(scale))),
  ];
  const fields: Record<string, z.ZodType> = Object.fromEntries(entries);
  // Loose: an agent that adds a field has not broken anything the page reads.
  return z.looseObject(fields);
}

const ROWS = {
  planItem: {
    text: ["title", "planned", "evidence"],
    optional: ["notes"],
    scales: { status: ["shipped", "partial", "changed", "not-built"] },
  },
  lane: { text: ["id", "name", "summary"] },
  techPivot: { text: ["from", "to", "why"], optional: ["ref"] },
  screen: {
    text: ["code", "name"],
    optional: ["route", "notes"],
    scales: {
      status: [
        "built",
        "partial",
        "built-differently",
        "not-built",
        "post-mvp",
      ],
    },
  },
  deltaTheme: { text: ["theme", "example"], numbers: ["count"] },
  deltaFollowup: { text: ["title", "source", "evidence"] },
  phase: { text: ["name", "start", "end", "summary"] },
  pivot: {
    text: ["date", "title", "why", "ref"],
    scales: { kind: ["cut", "added", "changed"] },
  },
  launchItem: {
    text: ["plan", "id", "title", "evidence"],
    scales: {
      status: ["done", "open", "partial"],
      owner: ["engineering", "human"],
    },
  },
  epic: {
    text: ["id", "name", "evidence"],
    optional: ["notes"],
    scales: { status: ["not-started", "seams-only", "partial"] },
  },
  stats: { text: [], numbers: ["merged_prs", "commits", "decisions"] },
} satisfies Record<string, RowShape>;

const lane = row(ROWS.lane).extend({ items: z.array(row(ROWS.planItem)) });
const initialPlan = z.object({
  lanes: z.array(lane),
  tech_plan_pivots: z.array(row(ROWS.techPivot)),
});
const design = z.object({
  screens: z.array(row(ROWS.screen)),
  delta_themes: z.array(row(ROWS.deltaTheme)),
  delta_followups_open: z.array(row(ROWS.deltaFollowup)),
});
const journey = z.object({
  phases: z.array(row(ROWS.phase)),
  pivots: z.array(row(ROWS.pivot)),
  launch_items: z.array(row(ROWS.launchItem)),
  post_mvp_epics: z.array(row(ROWS.epic)),
  stats: row(ROWS.stats),
});

// ---- the coordinator's words (SKILL.md step 4) ----------------------------

const tone = z.enum(["good", "warn", "bad"]);
const tldrCard = z.tuple([tone, z.string(), z.string()]);
const narrative = z.object({
  as_of: z.iso.date(),
  verified: z.array(z.string()).default([]),
  extra_deferred: z.array(deferredItem).default([]),
  tldr: z.array(tldrCard),
  text: z.record(z.string(), z.string()),
});

const previousSurvey = z.object({
  as_of: z.string().optional(),
  deferred: z.array(deferredItem),
});
type PreviousSurvey = z.infer<typeof previousSurvey>;

// ---- reading ---------------------------------------------------------------

function parseFile<T>(file: string, schema: z.ZodType<T>): T {
  const result = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!result.success) {
    throw new Error(
      `${file} does not match its shape:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/**
 * A saved data.json, or the published page itself, whose data is the
 * literal after `const D = `.
 */
function readPrevious(file: string): PreviousSurvey {
  const text = readFileSync(file, "utf8");
  const marker = "const D = ";
  const start = text.indexOf(marker);
  if (start === -1 || text.trimStart().startsWith("{")) {
    return parseFile(file, previousSurvey);
  }
  const literal = text
    .slice(start + marker.length, text.indexOf(";\n", start))
    .replaceAll(String.raw`<\/`, "</");
  return previousSurvey.parse(JSON.parse(literal));
}

// ---- the brand (src/ui/tokens.css) ----------------------------------------

/**
 * Every custom-property declaration in the block that `opener` begins.
 */
function declarations(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) {
    throw new Error(`src/ui/tokens.css has no \`${opener}\` block`);
  }
  const body = css
    .slice(start + opener.length, css.indexOf("\n}", start))
    .replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return body
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("--"))
    .map((part) => {
      const colon = part.indexOf(":");
      const value = part.slice(colon + 1).replaceAll(/\s+/g, " ");
      return `${part.slice(0, colon).trim()}: ${value.trim()};`;
    })
    .join(" ");
}

/**
 * The roles the template names. A rename in the app fails the build here
 * rather than leaving the page with an unset colour.
 */
const ROLES_USED = [
  "--ground",
  "--ink",
  "--panel",
  "--tint",
  "--hairline",
  "--muted",
  "--dialed-text",
  "--cold-text",
  "--course-pink",
  "--split-teal",
  "--hi-viz",
  "--night-run",
  "--font-family-interface",
  "--font-family-display",
  "--font-family-mono",
];

function brand(): { light: string; dark: string } {
  const css = readFileSync(path.join(repoRoot, "src/ui/tokens.css"), "utf8");
  const light = declarations(css, ":root {");
  const dark = declarations(css, "@utility ground-ink {");
  const missing = ROLES_USED.filter((role) => !light.includes(`${role}:`));
  if (missing.length > 0) {
    throw new Error(
      `src/ui/tokens.css no longer defines ${missing.join(", ")}`,
    );
  }
  return { light, dark };
}

// ---- the two commands ------------------------------------------------------

function extract(page: string, out: string): void {
  const previous = readPrevious(page);
  writeFileSync(out, JSON.stringify(previous.deferred));
  console.log(
    `extracted ${String(previous.deferred.length)} items from the ${previous.as_of ?? "earlier"} survey`,
  );
}

function duplicateIds(items: readonly DeferredItem[]): string[] {
  const seen = new Set<string>();
  return items.map((d) => d.id).filter((id) => seen.has(id) || !seen.add(id));
}

function readSurvey(surveyDir: string) {
  const read = <T>(name: string, schema: z.ZodType<T>): T =>
    parseFile(path.join(surveyDir, name), schema);
  const words = read("narrative.json", narrative);
  const verified = new Set(words.verified);
  const deferred = [
    ...read("deferred.json", deferredFile).items,
    ...words.extra_deferred,
  ].map((d) => ({ ...d, verified: verified.has(d.id) }));
  const dupes = duplicateIds(deferred);
  if (dupes.length > 0) {
    throw new Error(
      `duplicate deferred ids (the delta matches on id): ${dupes.join(", ")}`,
    );
  }
  const plan = read("initial-plan.json", initialPlan);
  const screens = read("design.json", design);
  const story = read("journey.json", journey);
  const days = Math.round((Date.parse(words.as_of) - FIRST_DAY) / DAY_MS);
  return {
    as_of: words.as_of,
    narrative: { ...words, days: String(days) },
    lanes: plan.lanes,
    techPivots: plan.tech_plan_pivots,
    deferred,
    screens: screens.screens,
    deltaThemes: screens.delta_themes,
    deltaFollowups: screens.delta_followups_open,
    phases: story.phases,
    pivots: story.pivots,
    launch: story.launch_items,
    epics: story.post_mvp_epics,
    stats: story.stats,
  };
}

function build(
  surveyDir: string,
  out: string,
  previousFile: string | undefined,
): void {
  const data = readSurvey(surveyDir);
  // Only what the delta needs, so the page does not grow with every run.
  const previous =
    previousFile === undefined ? undefined : readPrevious(previousFile);
  const embedded =
    previous === undefined
      ? data
      : {
          ...data,
          previous: {
            as_of: previous.as_of ?? "an earlier date",
            deferred: previous.deferred,
          },
        };
  const blob = JSON.stringify(embedded).replaceAll("</", String.raw`<\/`);
  const { light, dark } = brand();
  // Replacer functions, so a `$` in a value is never read as a pattern.
  const page = readFileSync(TEMPLATE, "utf8")
    .replace("/*__BRAND_LIGHT__*/", () => light)
    .replaceAll("/*__BRAND_DARK__*/", () => dark)
    .replace("__DATA__", () => blob);
  writeFileSync(out, page);
  writeFileSync(out.replace(/\.html$/, ".data.json"), JSON.stringify(data));

  const counts = Object.entries(Object.groupBy(data.deferred, (d) => d.class))
    .map(([name, items]) => `${name} ${String(items.length)}`)
    .join(", ");
  console.log(
    `wrote ${out} (${String(data.deferred.length)} deferred items: ${counts})`,
  );
}

const args = process.argv.slice(2);
const flag = args.indexOf("--previous");
const positional = flag === -1 ? args : args.toSpliced(flag, 2);
const [first, second, third] = positional;
if (first === "--extract" && second !== undefined && third !== undefined) {
  extract(second, third);
} else if (first !== undefined && second !== undefined) {
  build(first, second, flag === -1 ? undefined : args[flag + 1]);
} else {
  throw new Error(
    "usage: plan-survey <survey-dir> <out.html> [--previous <file>] | --extract <page.html> <out.json>",
  );
}
