/**
 * Assembles the plan-survey page from GitHub Issues and the agents' JSON.
 *
 *     npm run plan-survey -- <survey-dir> <out.html> [--previous <data.json | page.html>]
 *     npm run plan-survey -- --extract <page.html> <previous-deferred.json>
 *
 * The `plan-survey` skill's build step (`.claude/skills/plan-survey/`, whose
 * `template.html` this fills). It lives here rather than beside the skill
 * because TypeScript's globs skip dot-directories, so nothing would lint or
 * typecheck it there.
 *
 * `<survey-dir>` holds issues.json and project.json (`gh issue list` and
 * `npm run track -- list all --json`, SKILL.md step 1), plus the agents'
 * initial-plan.json, deferred.json, design.json, journey.json and
 * narrative.json (shapes in the skill's agents.md and SKILL.md, and below).
 * **The ledger's tracked items are the issues themselves**: every open issue
 * is `open-tracked` and every issue completed since the last survey is
 * `done-later`, so nothing has to be patched between runs. The deferred
 * agent adds only what the issues cannot say: orphans (deferrals with no
 * issue), open issues the code has already done, and rot.
 *
 * Writes `<out.html>` and, beside it, `<out>.data.json`: the data the page
 * embeds, which the next run passes back as `--previous`. `--extract` pulls
 * the deferred list out of a published page, for the deferred agent's
 * stable-id step.
 *
 * **Every input is outside data**, so each is parsed, not trusted: a brief
 * that drifted from its shape, or a `gh` that changed its JSON, fails here,
 * naming the file, rather than rendering a page with holes in it.
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
  "issue-stale",
]);
const severity = z.enum(["launch-blocker", "important", "minor"]);
const optionalText = z.string().nullish();
const deferredItem = z.object({
  id: z.string(),
  title: z.string(),
  what: z.string(),
  deferred_on: z.string().nullish(),
  source: z.string(),
  class: deferredClass,
  evidence: z.string(),
  area: z.string(),
  severity,
  age_days: z.number().nullish(),
  verified: z.boolean().optional(),
  /**
  An issue's link, its milestone and Project status, and its R-id.
  */
  url: optionalText,
  stage: optionalText,
  status: optionalText,
  alias: optionalText,
});
type DeferredItem = z.infer<typeof deferredItem>;

/**
What an agent may add: a deferral with no issue.
*/
const orphan = deferredItem.extend({ class: z.literal("open-orphaned") });
const issueNumber = z.number().int().positive();
/**
Open issues the code has already done (agents.md brief 2b).
*/
const staleFinding = z.object({
  issue: issueNumber,
  what: z.string(),
  evidence: z.string(),
});
const rotKind = z.enum([
  "trigger-passed",
  "no-trigger",
  "friends-after-launch",
]);
/**
Open issues that have gone stale on the tracker's own rules (brief 2c).
*/
const rotFinding = z.object({
  issue: issueNumber,
  kind: rotKind,
  note: z.string(),
});
const orphans = z.array(orphan).default([]);
const deferredFile = z.object({
  items: orphans,
  stale: z.array(staleFinding).default([]),
  rot: z.array(rotFinding).default([]),
});
type DeferredFile = z.infer<typeof deferredFile>;

// ---- GitHub (gh issue list, npm run track -- list all --json) -------------

const label = z.object({ name: z.string() });
const milestone = z.object({ title: z.string() });
const ghIssue = z.object({
  number: issueNumber,
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED"]),
  stateReason: z.string().nullish(),
  labels: z.array(label),
  milestone: milestone.nullable(),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  url: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }),
});
type GhIssue = z.infer<typeof ghIssue>;
const projectItem = z.object({
  number: issueNumber,
  state: z.string(),
  status: z.string(),
});
type ProjectItem = z.infer<typeof projectItem>;

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
  extra_deferred: orphans,
  tldr: z.array(tldrCard),
  text: z.record(z.string(), z.string()),
});

// A page from before the issues moved keeps its own classes (register-stale).
const previousItem = deferredItem.extend({ class: z.string() });
const previousSurvey = z.object({
  as_of: z.string().optional(),
  deferred: z.array(previousItem),
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

// ---- issues into ledger entries -------------------------------------------

/**
 * Never negative: `gh` dates are UTC, so an issue filed this evening can
 * carry tomorrow's date.
 */
const daysBetween = (from: string, to: string): number =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS));

/**
 * The one `prefix:*` label an issue carries (issue-tracker.md: exactly one
 * area and one severity each). A missing one fails the build, naming the
 * issue, because the page has nowhere honest to file it.
 */
function labelOf(issue: GhIssue, prefix: string): string {
  const values = issue.labels
    .map((label) => label.name)
    .filter((name) => name.startsWith(`${prefix}:`))
    .map((name) => name.slice(prefix.length + 1));
  const [value] = values;
  if (value === undefined || values.length !== 1) {
    throw new Error(
      `issue #${String(issue.number)} has ${String(values.length)} ${prefix}:* labels, not one`,
    );
  }
  return value;
}

function severityOf(issue: GhIssue): DeferredItem["severity"] {
  const parsed = severity.safeParse(labelOf(issue, "sev"));
  if (!parsed.success) {
    throw new Error(
      `issue #${String(issue.number)} has an unknown sev:* label`,
    );
  }
  return parsed.data;
}

/**
 * When the work was first deferred: for an `R-NN:` issue the register row's
 * date, carried by the previous survey, else the day the issue was filed.
 */
function deferredOn(
  issue: GhIssue,
  alias: string | undefined,
  previous: PreviousSurvey | undefined,
): string {
  const created = issue.createdAt.slice(0, 10);
  const row = previous?.deferred.find((d) => d.id === alias);
  if (row === undefined) return created;
  if (
    row.deferred_on != undefined &&
    z.iso.date().safeParse(row.deferred_on).success
  ) {
    return row.deferred_on;
  }
  if (row.age_days == undefined || previous?.as_of === undefined)
    return created;
  const start = new Date(Date.parse(previous.as_of) - row.age_days * DAY_MS);
  return start.toISOString().slice(0, 10);
}

/**
 * Closed issues worth a row: completed (a cut or a duplicate is not work
 * done), and since the last survey so the ledger does not grow forever.
 */
function isListed(
  issue: GhIssue,
  previous: PreviousSurvey | undefined,
): boolean {
  if (issue.state === "OPEN") return true;
  if (issue.stateReason !== "COMPLETED" || issue.closedAt === null)
    return false;
  return previous?.as_of === undefined || issue.closedAt >= previous.as_of;
}

function issueEntry(
  issue: GhIssue,
  context: {
    readonly asOf: string;
    readonly status: ReadonlyMap<number, string>;
    readonly previous: PreviousSurvey | undefined;
  },
): DeferredItem {
  const alias = /^(R-\d+):/.exec(issue.title)?.[1];
  const since = deferredOn(issue, alias, context.previous);
  const stage = issue.milestone?.title;
  const status = context.status.get(issue.number);
  const isOpen = issue.state === "OPEN";
  return {
    id: `#${String(issue.number)}`,
    title: issue.title,
    what: `Milestone ${stage ?? "none"} · status ${status === undefined ? "not in the Project" : status || "inbox"}`,
    deferred_on: since,
    source: "GitHub issue",
    class: isOpen ? "open-tracked" : "done-later",
    evidence: issue.url,
    area: labelOf(issue, "area"),
    severity: severityOf(issue),
    age_days: daysBetween(
      since,
      isOpen ? context.asOf : (issue.closedAt ?? context.asOf),
    ),
    url: issue.url,
    stage,
    status,
    alias,
  };
}

const ROT_LABEL = {
  "trigger-passed": "its trigger has passed",
  "no-trigger": "it has no trigger line",
  "friends-after-launch": "a friends item still open after friends launch",
} as const;

/**
 * Folds the agent's issue findings into the issues' own entries: a stale
 * issue changes class, and rot is appended to what the row says.
 */
function annotate(
  entries: DeferredItem[],
  agent: DeferredFile,
): DeferredItem[] {
  const byId = new Map(entries.map((d) => [d.id, d]));
  const openEntry = (issue: number): DeferredItem => {
    const entry = byId.get(`#${String(issue)}`);
    if (entry?.class !== "open-tracked" && entry?.class !== "issue-stale") {
      throw new Error(
        `deferred.json names #${String(issue)}, which is not an open issue`,
      );
    }
    return entry;
  };
  for (const stale of agent.stale) {
    const entry = openEntry(stale.issue);
    entry.class = "issue-stale";
    entry.what = `${stale.what} (${entry.what})`;
    entry.evidence = stale.evidence;
  }
  for (const rot of agent.rot) {
    const entry = openEntry(rot.issue);
    entry.what = `${entry.what}. Rot: ${ROT_LABEL[rot.kind]}. ${rot.note}`;
  }
  return entries;
}

function issueEntries(
  surveyDir: string,
  asOf: string,
  previous: PreviousSurvey | undefined,
) {
  const issues = parseFile(
    path.join(surveyDir, "issues.json"),
    z.array(ghIssue),
  );
  const project = parseFile(
    path.join(surveyDir, "project.json"),
    z.array(projectItem),
  );
  const status = new Map(project.map((item) => [item.number, item.status]));
  const entries = issues
    .filter((issue) => isListed(issue, previous))
    .map((issue) => issueEntry(issue, { asOf, status, previous }));
  return { entries, issues, project };
}

/**
 * SKILL.md's done check: every open issue is on the page as tracked (or as
 * stale), and the Project holds every open issue.
 */
function projectCheck(
  issues: readonly GhIssue[],
  project: readonly ProjectItem[],
): string {
  const inProject = new Set(project.map((item) => item.number));
  const projectOpen = project.filter((item) => item.state === "OPEN").length;
  const open = issues.filter((issue) => issue.state === "OPEN");
  const missing = open
    .filter((issue) => !inProject.has(issue.number))
    .map((issue) => `#${String(issue.number)}`);
  const verdict =
    missing.length === 0
      ? "they match"
      : `not in the Project: ${missing.join(", ")}`;
  return `${String(open.length)} open issues, ${String(projectOpen)} open in the Project (${verdict})`;
}

function readSurvey(surveyDir: string, previous: PreviousSurvey | undefined) {
  const read = <T>(name: string, schema: z.ZodType<T>): T =>
    parseFile(path.join(surveyDir, name), schema);
  const words = read("narrative.json", narrative);
  const verified = new Set(words.verified);
  const agent = read("deferred.json", deferredFile);
  const tracked = issueEntries(surveyDir, words.as_of, previous);
  const deferred = [
    ...annotate(tracked.entries, agent),
    ...agent.items,
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
    check: projectCheck(tracked.issues, tracked.project),
    data: {
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
    },
  };
}

function build(
  surveyDir: string,
  out: string,
  previousFile: string | undefined,
): void {
  const previous =
    previousFile === undefined ? undefined : readPrevious(previousFile);
  const { data, check } = readSurvey(surveyDir, previous);
  // Only what the delta needs, so the page does not grow with every run.
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
    `wrote ${out} (${String(data.deferred.length)} deferred items: ${counts})\n${check}`,
  );
}

const args = process.argv.slice(2);
const flag = args.indexOf("--previous");
const positional = flag === -1 ? args : args.toSpliced(flag, 2);
const [first, second, third] = positional;
if (first === "--extract" && second !== undefined && third !== undefined) {
  extract(second, third);
} else if (first === undefined || second === undefined) {
  throw new Error(
    "usage: plan-survey <survey-dir> <out.html> [--previous <file>] | --extract <page.html> <out.json>",
  );
} else {
  build(first, second, flag === -1 ? undefined : args[flag + 1]);
}
