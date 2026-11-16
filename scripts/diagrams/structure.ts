/**
 * The structure half of the architecture diagrams (design 229, step 2):
 * what is bound and what imports what, written as LikeC4 source from the
 * files that decide it. `scripts/diagram-structure.ts` writes the result
 * to `docs/diagrams/structure.generated.c4`, and
 * `test/architecture/diagram-structure.test.ts` regenerates and compares,
 * so the drawn structure cannot drift from the bound one.
 *
 * Pure: text in, text out. The script reads the files; the test, whose
 * pool has no filesystem, gets them inlined by Vite.
 *
 * Its inputs are `wrangler.jsonc` (databases, buckets, queues, datasets,
 * email), `tsconfig.json` (the import aliases), the cron registry and
 * every source under `src`. Queues come from the config rather than
 * `ops/queues.ts`, which imports `env` and so cannot be loaded by a
 * script; `test/bindings-conformance.test.ts` already holds the two equal.
 *
 * **It throws on what it cannot read, rather than leaving it out.** The
 * comparison test regenerates with the generator's own blind spots, so a
 * construct it skips is skipped in both copies and nothing fails. So each
 * way into the system is a closed list: the keys of `wrangler.jsonc`, the
 * handlers of its `main`, the top-level entries of `src`, and the files
 * under `src/modules`. Something new in any of them throws until it is
 * drawn here or listed with the reason it is not.
 *
 * The output must be what `likec4 format` would leave alone, because
 * `diagrams:check` runs the formatter's check over this file too.
 */
import { z } from "zod";

import { withoutComments } from "../../test/architecture/source-text";

const MODULES_ROOT = "src/modules/";

// A producer and a consumer are read through one shape: both name a queue,
// and only a consumer carries the other two.
const queueSchema = z.object({
  queue: z.string(),
  max_retries: z.number().optional(),
  dead_letter_queue: z.string().optional(),
});
const queueList = z.array(queueSchema);
const databaseSchema = z.object({ database_name: z.string() });
const bucketSchema = z.object({ bucket_name: z.string() });
const datasetSchema = z.object({ dataset: z.string() });
const sendEmailSchema = z.object({ name: z.string() });
const wranglerSchema = z.object({
  main: z.string(),
  d1_databases: z.array(databaseSchema),
  r2_buckets: z.array(bucketSchema),
  analytics_engine_datasets: z.array(datasetSchema),
  queues: z.object({ producers: queueList, consumers: queueList }),
  send_email: z.array(sendEmailSchema),
});
const topLevelSchema = z.record(z.string(), z.unknown());

const pathsSchema = z.record(z.string(), z.array(z.string()));
const tsconfigSchema = z.object({
  compilerOptions: z.object({ paths: pathsSchema.optional() }),
});

const wordsSchema = z.record(z.string(), z.string());

/**
 * Every top-level key `wrangler.jsonc` may hold, and what the diagram does
 * with it. A new kind of binding (a KV namespace, a Durable Object, a
 * Workflow) or an `env` block that overrides one throws until it is here.
 */
const WRANGLER_KEYS: Readonly<Record<string, string>> = {
  d1_databases: "drawn: a database each",
  r2_buckets: "drawn: a bucket each",
  analytics_engine_datasets: "drawn: a database each",
  queues: "drawn: a queue each, with its dead-letter arrow",
  send_email: "drawn: an external system each, where mail leaves",
  triggers: "drawn from ops/crons.ts, which bindings-conformance holds equal",
  main: "read: the entry whose handlers are checked",
  $schema: "editor support",
  name: "the Worker's name",
  compatibility_date: "a runtime setting",
  compatibility_flags: "a runtime setting",
  observability: "the platform's logs, not a part of the system",
  upload_source_maps: "a deploy setting",
  cache: "the edge cache, which architecture.md describes in prose",
  vars: "settings, not parts",
  version_metadata: "the deploy's own version id; no system behind it",
};

/**
 * Every handler and export `main` may have. A new handler is a new way in
 * (an inbound `email`, a `tail`), and a Durable Object or Workflow class
 * is exported from here, so either throws until it is listed.
 */
const MAIN_ENTRIES: Readonly<Record<string, string>> = {
  fetch: "drawn: each request's entry point, by hand in model.c4",
  queue: "drawn: the queues; each consumer by hand in model.c4",
  scheduled: "drawn: the crons",
};

/**
 * Every top-level entry of `src` that holds code. Code in a new folder
 * beside `modules` would otherwise have no element and no arrows.
 */
const SRC_ENTRIES: Readonly<Record<string, string>> = {
  modules: "drawn: a module each",
  "server.ts": "read: wrangler.jsonc's main",
  env: "the only reader of bindings; drawn as what it binds",
  db: "the schema and migrations; drawn as the databases",
  lib: "shared code with no timing boundary of its own",
  ui: "shared components",
  routes: "glue between a URL and the modules (server-functions-are-glue)",
  "routeTree.gen.ts": "route registration, generated",
  "router.tsx": "the router's setup",
  "start.ts": "the framework's setup",
  "named-not-found.tsx": "a page",
  "vite-env.d.ts": "types",
};

/**
Throws on each name the list neither draws nor gives a reason for.
*/
function requireListed(
  names: Iterable<string>,
  list: Readonly<Record<string, string>>,
  where: string,
): void {
  const unlisted = [...names].filter((name) => !Object.hasOwn(list, name));
  if (unlisted.length === 0) return;
  throw new Error(
    `${where} has what the diagram neither draws nor lists: ${unlisted.join(", ")}. ` +
      "Draw it, or list it with the reason it is not drawn, in " +
      "scripts/diagrams/structure.ts (skill architecture-diagrams).",
  );
}

export interface CronEntry {
  readonly schedule: string;
  readonly name: string;
}

export interface StructureInputs {
  /**
  `wrangler.jsonc`, as written.
  */
  readonly wranglerJsonc: string;
  /**
  The cron registry's entries (`src/modules/ops/crons.ts`).
  */
  readonly crons: readonly CronEntry[];
  /**
  `tsconfig.json`, as written: its `paths` are the import aliases.
  */
  readonly tsconfigJsonc: string;
  /**
  Every `.ts` and `.tsx` source under `src`, by repo-relative path.
  */
  readonly sources: Readonly<Record<string, string>>;
  /**
  `docs/diagrams/structure.words.json`, parsed: element id to description.
  */
  readonly words: unknown;
}

interface Element {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly technology?: string;
  readonly children: readonly Element[];
}

interface Arrow {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly title?: string;
}

const CLOSER = /^[\]}]/u;

/**
 * JSONC to a value: comments out, then the trailing commas JSON refuses.
 * `withoutComments` keeps string literals whole, so a `//` inside a URL
 * survives. A comma is trailing when a closing bracket is the next thing
 * after it.
 */
function parseJsonc(source: string): unknown {
  const [first = "", ...rest] = withoutComments(source).split(",");
  const kept = rest.map((piece) =>
    CLOSER.test(piece.trimStart()) ? piece : `,${piece}`,
  );
  return JSON.parse(first + kept.join(""));
}

/**
`public-photos` to `publicPhotos`: an id LikeC4 accepts.
*/
function camel(name: string): string {
  const [first = "", ...rest] = name.split(/[-_]/u);
  const capitalized = rest.map(
    (word) => word.charAt(0).toUpperCase() + word.slice(1),
  );
  return first + capitalized.join("");
}

/**
A bound resource's short name: `dialed-imports` is `imports`.
*/
function shortName(name: string): string {
  return name.replace(/^dialed[-_]/u, "");
}

const DLQ_SUFFIX = "-dlq";

function queueId(queue: string): string {
  const short = shortName(queue);
  return short.endsWith(DLQ_SUFFIX)
    ? `${camel(short.slice(0, -DLQ_SUFFIX.length))}Dlq`
    : `${camel(short)}Queue`;
}

function leaf(id: string, kind: string, title: string): Element {
  return { id, kind, title, children: [] };
}

type Wrangler = z.infer<typeof wranglerSchema>;

/**
Every queue the config names, as a producer, a consumer or a dead-letter
queue, each once and in name order.
*/
function queueNames(queues: Wrangler["queues"]): string[] {
  const names = new Set<string>();
  for (const producer of queues.producers) names.add(producer.queue);
  for (const consumer of queues.consumers) {
    names.add(consumer.queue);
    if (consumer.dead_letter_queue !== undefined) {
      names.add(consumer.dead_letter_queue);
    }
  }
  return [...names].toSorted((a, b) => a.localeCompare(b));
}

function boundElements(config: Wrangler): Element[] {
  return [
    ...config.d1_databases.map((database) =>
      leaf(
        `${camel(shortName(database.database_name))}Db`,
        "database",
        `D1: ${database.database_name}`,
      ),
    ),
    ...config.analytics_engine_datasets.map((dataset) =>
      leaf(
        `${camel(shortName(dataset.dataset))}Dataset`,
        "database",
        `Analytics Engine: ${dataset.dataset}`,
      ),
    ),
    ...config.r2_buckets.map((bucket) =>
      leaf(
        `${camel(shortName(bucket.bucket_name))}Bucket`,
        "bucket",
        `R2: ${bucket.bucket_name}`,
      ),
    ),
    ...queueNames(config.queues).map((queue) =>
      leaf(queueId(queue), "queue", `Queue: ${queue}`),
    ),
    // Mail leaving the system: a service we call and do not run, so
    // `external`, though it is bound like the rest.
    ...config.send_email.map((sender) =>
      leaf(
        `${camel(sender.name.toLowerCase())}Sending`,
        "external",
        `Email sending: ${sender.name}`,
      ),
    ),
  ];
}

const HANDLER = /^ {2}(?:async\s+)?(\w+)\s*[(:,]/gmu;
const DEFAULT_EXPORT = /^export default \{$/mu;
const EXPORT_LINE = /^export\s.*$/gmu;

/**
 * The handlers on `main`'s default export, and every other export it has,
 * whole lines: a Durable Object's class is exported from here. Read at the
 * formatter's indent, so a property of a handler's body is not a handler.
 */
function mainEntries(main: string): string[] {
  const code = withoutComments(main);
  const start = code.search(DEFAULT_EXPORT);
  if (start === -1) {
    throw new Error("main has no `export default {`: its handlers not read");
  }
  const body = code.slice(start, code.indexOf("\n}", start));
  const handlers = Array.from(
    body.matchAll(HANDLER),
    (match) => match[1] ?? "",
  );
  const exports = Array.from(code.matchAll(EXPORT_LINE), (match) => match[0]);
  return [...handlers, ...exports.filter((line) => !DEFAULT_EXPORT.test(line))];
}

const SRC_ROOT = "src/";

/**
 * Throws on a way into the system the diagram does not account for: a
 * `wrangler.jsonc` key, a handler or export of `main`, a top-level entry
 * of `src`.
 */
function requireWaysInListed(
  wrangler: Readonly<Record<string, unknown>>,
  main: string,
  sources: Readonly<Record<string, string>>,
): void {
  requireListed(Object.keys(wrangler), WRANGLER_KEYS, "wrangler.jsonc");
  const mainSource = sources[main];
  if (mainSource === undefined) {
    throw new Error(`wrangler.jsonc's main, ${main}, is not a source read`);
  }
  requireListed(mainEntries(mainSource), MAIN_ENTRIES, main);
  const entries = Object.keys(sources)
    .filter((path) => path.startsWith(SRC_ROOT))
    .map((path) => path.slice(SRC_ROOT.length).split("/", 1)[0] ?? "");
  requireListed(new Set(entries), SRC_ENTRIES, "src");
}

const ALIAS_PATTERN = /^([^*]+\/)\*$/u;
const ALIAS_TARGET = /^\.\/([^*]+\/)\*$/u;

/**
 * `tsconfig.json`'s `paths` as prefixes: `@/*` to `./src/*` is `@/` read
 * as `src/`. A shape other than one folder for one prefix throws.
 */
function aliasesOf(tsconfigJsonc: string): Map<string, string> {
  const { paths = {} } = tsconfigSchema.parse(
    parseJsonc(tsconfigJsonc),
  ).compilerOptions;
  return new Map(
    Object.entries(paths).map(([pattern, targets]) => {
      const prefix = ALIAS_PATTERN.exec(pattern)?.[1];
      const folder = ALIAS_TARGET.exec(targets.join(" "))?.[1];
      if (prefix === undefined || folder === undefined) {
        throw new Error(`tsconfig path not read: ${pattern}`);
      }
      return [prefix, folder];
    }),
  );
}

/**
A work queue's arrow to its dead-letter queue, with the retry count the
config binds.
*/
function deadLetterArrows(queues: Wrangler["queues"]): Arrow[] {
  const arrows: Arrow[] = [];
  for (const consumer of queues.consumers) {
    if (consumer.dead_letter_queue === undefined) continue;
    const retries = String(consumer.max_retries ?? 0);
    arrows.push({
      from: `cf.${queueId(consumer.queue)}`,
      to: `cf.${queueId(consumer.dead_letter_queue)}`,
      kind: "recovery",
      title: `dead-letters after ${retries} retries`,
    });
  }
  return arrows;
}

const TWO_DIGITS = /^\d{1,2}$/u;

/**
 * A cron as an element named for its firing, not for one job it runs: the
 * registry's name is the handler's key, and a firing runs more than that
 * one job. Only the registry's two shapes are read (a fixed minute every
 * hour, a fixed time every day); a third throws rather than being drawn
 * as something it is not.
 */
function cronElement(entry: CronEntry): Element {
  const [minute = "", hour = "", ...rest] = entry.schedule.split(" ");
  if (!TWO_DIGITS.test(minute) || rest.join(" ") !== "* * *") {
    throw new Error(`cron shape not drawn: ${entry.schedule}`);
  }
  const mm = minute.padStart(2, "0");
  const technology = `${entry.schedule} (${entry.name})`;
  if (hour === "*") {
    return {
      ...leaf(`cronHourly${mm}`, "onCron", `Cron: every hour at :${mm}`),
      technology,
    };
  }
  if (!TWO_DIGITS.test(hour)) {
    throw new Error(`cron shape not drawn: ${entry.schedule}`);
  }
  const hh = hour.padStart(2, "0");
  return {
    ...leaf(`cronDaily${hh}${mm}`, "onCron", `Cron: daily at ${hh}:${mm} UTC`),
    technology,
  };
}

const INDEX_FILE = /\/index\.ts$/u;

/**
 * The folders under `src/modules` that have their own `index.ts`: the
 * modules, and the sub-modules inside them. Deepest first, so the first
 * one a path sits under is the unit that owns it.
 */
function unitFolders(paths: readonly string[]): string[] {
  return paths
    .filter(
      (path) => path.startsWith(MODULES_ROOT) && path.endsWith("/index.ts"),
    )
    .map((path) => path.replace(INDEX_FILE, ""))
    .toSorted(
      (a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b),
    );
}

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
The unit a path belongs to, if it is inside one.
*/
function owningUnit(
  path: string,
  units: readonly string[],
): string | undefined {
  return units.find((unit) => isUnder(path, unit));
}

/**
`src/modules/runs/parsers` is `cf.app.runs.parsers`.
*/
function unitId(unit: string): string {
  const parts = unit.slice(MODULES_ROOT.length).split("/");
  return ["cf", "app", ...parts.map((part) => camel(part))].join(".");
}

/**
 * Where a specifier points, as a repo path: a relative one against the
 * folder of the file that wrote it, an alias by its prefix. A package is
 * `undefined`.
 */
function resolveSpecifier(
  fromPath: string,
  specifier: string,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  for (const [prefix, folder] of aliases) {
    if (specifier.startsWith(prefix)) {
      return folder + specifier.slice(prefix.length);
    }
  }
  if (!specifier.startsWith(".")) return undefined;
  const parts = fromPath.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

const FROM = /\sfrom\s*["']([^"'\n]+)["']/gu;
const CLAUSE = /^[\w\s,{}*$]+$/u;
const KEYWORDS = ["import ", "export "];
const BARE_IMPORT = /^import\s*["']([^"'\n]+)["']/gmu;
const DYNAMIC_IMPORT = /\bimport\(\s*(["'`])([^"'`\n]*)(["'`])/gu;

/**
 * Where the statement that holds `index` starts: the nearest `import` or
 * `export` at the start of a line above it, and the end of that keyword.
 */
function statementStart(code: string, index: number): number {
  return Math.max(
    ...KEYWORDS.map((keyword) => {
      if (code.startsWith(keyword) && code.lastIndexOf("\n", index) === -1) {
        return keyword.length;
      }
      const at = code.lastIndexOf(`\n${keyword}`, index);
      return at === -1 ? -1 : at + 1 + keyword.length;
    }),
  );
}

/**
 * The specifier of every `import … from` and `export … from` in a source.
 * Found from the `from "…"` backwards, and kept only when what sits
 * between the keyword and the `from` is an import clause, so a `from "x"`
 * inside a string or a query is not read as one.
 */
function staticImportsOf(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(FROM)) {
    const start = statementStart(code, match.index);
    const isImport =
      start !== -1 && CLAUSE.test(code.slice(start, match.index));
    if (!isImport) continue;
    found.push(match[1] ?? "");
  }
  return found;
}

/**
 * `import("…")` with a literal, the type-position `import("…").T` too. A
 * template literal could name any module, so it throws rather than being
 * read as none. A bare identifier is not read: it cannot be told apart
 * from prose such as "import(s)" in a message, and no file has one.
 */
function dynamicImportsOf(path: string, code: string): string[] {
  return Array.from(code.matchAll(DYNAMIC_IMPORT), (match) => {
    const [whole, open = "", specifier = "", close = ""] = match;
    if (open === "`" || open !== close || specifier.includes("${")) {
      throw new Error(
        `an import the diagram cannot read, in ${path}: ${whole}`,
      );
    }
    return specifier;
  });
}

/**
Every specifier a source imports: static, bare (`import "./x"`) and dynamic.
*/
function importsOf(path: string, source: string): string[] {
  const code = withoutComments(source);
  return [
    ...staticImportsOf(code),
    ...Array.from(code.matchAll(BARE_IMPORT), (match) => match[1] ?? ""),
    ...dynamicImportsOf(path, code),
  ];
}

interface Units {
  readonly folders: readonly string[];
  readonly aliases: ReadonlyMap<string, string>;
}

/**
 * The other units one file imports from. A unit and its own sub-module
 * count as one here: LikeC4 refuses an arrow between a parent and its
 * child, and the nesting already says it.
 */
function importedUnits(
  path: string,
  source: string,
  from: string,
  units: Units,
): string[] {
  const found: string[] = [];
  for (const specifier of importsOf(path, source)) {
    const target = resolveSpecifier(path, specifier, units.aliases);
    if (target === undefined) continue;
    const to = owningUnit(target, units.folders);
    if (to === undefined || isUnder(to, from) || isUnder(from, to)) continue;
    found.push(to);
  }
  return found;
}

const WIRING_FILE = /(?:\/functions\.ts|\.tsx)$/u;
const SERVER_FN_CALL = "createServerFn(";

/**
 * A module's wiring: its server functions and its components, the files
 * that join a screen to the code behind it. An import only they make
 * (the auth gate, the error reporter, another module's component) says
 * less about how the modules depend on each other than one its service
 * code makes, so the two are drawn as different arrows.
 */
function isWiring(path: string): boolean {
  return WIRING_FILE.test(path);
}

/**
 * Throws on a module file the drawing would misplace: one in no module
 * (a folder under `src/modules` without its own `index.ts`), or a server
 * function outside a `functions.ts`, whose imports would be drawn as
 * service code rather than wiring.
 */
function requireModuleFilesPlaced(
  modulePaths: readonly string[],
  sources: Readonly<Record<string, string>>,
  folders: readonly string[],
): void {
  const loose = modulePaths.filter(
    (path) => owningUnit(path, folders) === undefined,
  );
  if (loose.length > 0) {
    throw new Error(
      `in no module, so not drawn: ${loose.join(", ")}. ` +
        "A folder under src/modules is drawn when it has its own index.ts.",
    );
  }
  const serverFns = modulePaths.filter(
    (path) =>
      !isWiring(path) &&
      withoutComments(sources[path] ?? "").includes(SERVER_FN_CALL),
  );
  if (serverFns.length > 0) {
    throw new Error(
      `a server function outside functions.ts: ${serverFns.join(", ")}. ` +
        "The diagram counts only functions.ts and components as wiring.",
    );
  }
}

/**
 * One arrow per pair of units where a file in the first imports from the
 * second: `imports` when any file outside the wiring does, `wiring` when
 * only wiring files do. The arrow carries no names. A label would change
 * with every new import, and lanes working in parallel would conflict on
 * this file for no change in structure.
 */
function importArrows(
  sources: Readonly<Record<string, string>>,
  units: Units,
): Arrow[] {
  const pairs = new Map<string, boolean>();
  for (const [path, source] of Object.entries(sources)) {
    const from = owningUnit(path, units.folders);
    if (from === undefined) continue;
    for (const to of importedUnits(path, source, from, units)) {
      const key = `${from} ${to}`;
      pairs.set(key, (pairs.get(key) ?? true) && isWiring(path));
    }
  }
  return [...pairs]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, wiringOnly]) => {
      const [from = "", to = ""] = key.split(" ", 2);
      return {
        from: unitId(from),
        to: unitId(to),
        kind: wiringOnly ? "wiring" : "imports",
      };
    });
}

/**
The units as a tree: a sub-module sits inside the module that holds it.
*/
function moduleElements(units: readonly string[], parent: string): Element[] {
  return units
    .filter(
      (unit) =>
        unit.startsWith(`${parent}/`) &&
        !unit.slice(parent.length + 1).includes("/"),
    )
    .toSorted((a, b) => a.localeCompare(b))
    .map((unit) => ({
      id: camel(unit.slice(parent.length + 1)),
      kind: "module",
      title: unit.slice(MODULES_ROOT.length),
      children: moduleElements(units, unit),
    }));
}

/**
A LikeC4 string literal, with `'` escaped the way its formatter writes it.
*/
function quoted(text: string): string {
  const escaped = text.replaceAll("'", String.raw`\'`);
  return `'${escaped}'`;
}

function renderElement(
  element: Element,
  path: string,
  words: Readonly<Record<string, string>>,
  indent: string,
): string[] {
  const id = `${path}.${element.id}`;
  const head = `${indent}${element.id} = ${element.kind} ${quoted(element.title)}`;
  const inner = `${indent}  `;
  const description = words[id];
  const body = [
    ...(element.technology === undefined
      ? []
      : [`${inner}technology ${quoted(element.technology)}`]),
    ...(description === undefined
      ? []
      : [`${inner}description ${quoted(description)}`]),
    ...element.children.flatMap((child) =>
      renderElement(child, id, words, inner),
    ),
  ];
  return body.length === 0 ? [head] : [`${head} {`, ...body, `${indent}}`];
}

function elementIds(elements: readonly Element[], path: string): string[] {
  return elements.flatMap((element) => [
    `${path}.${element.id}`,
    ...elementIds(element.children, `${path}.${element.id}`),
  ]);
}

function renderExtend(
  path: string,
  elements: readonly Element[],
  words: Readonly<Record<string, string>>,
): string[] {
  return [
    `  extend ${path} {`,
    ...elements.flatMap((element) =>
      renderElement(element, path, words, " ".repeat(4)),
    ),
    "  }",
  ];
}

function renderArrow(arrow: Arrow): string {
  const line = `  ${arrow.from} -[${arrow.kind}]-> ${arrow.to}`;
  return arrow.title === undefined ? line : `${line} ${quoted(arrow.title)}`;
}

const EITHER_IMPORT = "where kind is imports or kind is wiring";

/**
 * One view a module: the module, what it imports and what imports it,
 * wiring included. `overview.c4`'s `modules` view is the map, with the
 * service imports only, and these are what a click on a module opens.
 */
function renderImportViews(arrows: readonly Arrow[]): string[] {
  const ids = new Set(arrows.flatMap((arrow) => [arrow.from, arrow.to]));
  return [...ids]
    .toSorted((a, b) => a.localeCompare(b))
    .flatMap((id) => {
      const name = id.split(".").slice(2);
      const viewId = `${camel(name.join("-"))}Imports`;
      const title = `${name.join("/")}: what it imports, and what imports it`;
      return [
        `  view ${viewId} of ${id} {`,
        `    title ${quoted(title)}`,
        `    include ${id}`,
        `    include ${id} -> cf.app.** ${EITHER_IMPORT}`,
        `    include cf.app.** -> ${id} ${EITHER_IMPORT}`,
        "  }",
      ];
    });
}

const HEADER = [
  "// Generated by `npm run diagrams:generate`. Do not edit: a test",
  "// regenerates this file and compares. It is built from wrangler.jsonc,",
  "// src/modules/ops/crons.ts and the imports under src/modules, with the",
  "// descriptions in structure.words.json.",
];

/**
 * `docs/diagrams/structure.generated.c4`, whole. Throws on a description
 * for an element that is not generated: the words file names something
 * that was renamed or removed.
 */
export function generateStructure(inputs: StructureInputs): string {
  const wrangler = topLevelSchema.parse(parseJsonc(inputs.wranglerJsonc));
  const config = wranglerSchema.parse(wrangler);
  const words = wordsSchema.parse(inputs.words);
  requireWaysInListed(wrangler, config.main, inputs.sources);
  const modulePaths = Object.keys(inputs.sources).filter((path) =>
    path.startsWith(MODULES_ROOT),
  );
  const units: Units = {
    folders: unitFolders(modulePaths),
    aliases: aliasesOf(inputs.tsconfigJsonc),
  };
  requireModuleFilesPlaced(modulePaths, inputs.sources, units.folders);

  const bound = boundElements(config);
  const inWorker = [
    ...moduleElements(units.folders, MODULES_ROOT.slice(0, -1)),
    ...inputs.crons
      .map((entry) => cronElement(entry))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  ];

  const known = new Set([
    ...elementIds(bound, "cf"),
    ...elementIds(inWorker, "cf.app"),
  ]);
  const unknown = Object.keys(words).filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `structure.words.json describes what is not generated: ${unknown.join(", ")}`,
    );
  }

  const imports = importArrows(inputs.sources, units);
  return [
    ...HEADER,
    "model {",
    ...renderExtend("cf", bound, words),
    ...renderExtend("cf.app", inWorker, words),
    "",
    ...deadLetterArrows(config.queues).map((arrow) => renderArrow(arrow)),
    ...imports.map((arrow) => renderArrow(arrow)),
    "}",
    "views {",
    ...renderImportViews(imports),
    "}",
    "",
  ].join("\n");
}
