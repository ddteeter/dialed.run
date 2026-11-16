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
 * Its inputs are `wrangler.jsonc` (databases, buckets, queues, datasets),
 * the cron registry and every source under `src/modules`. Queues come
 * from the config rather than `ops/queues.ts`, which imports `env` and so
 * cannot be loaded by a script; `test/bindings-conformance.test.ts`
 * already holds the two equal.
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
const wranglerSchema = z.object({
  d1_databases: z.array(databaseSchema),
  r2_buckets: z.array(bucketSchema),
  analytics_engine_datasets: z.array(datasetSchema),
  queues: z.object({ producers: queueList, consumers: queueList }),
});

const wordsSchema = z.record(z.string(), z.string());

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
  Every source under `src/modules`, by repo-relative path.
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
  ];
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
A relative specifier, resolved against the folder of the file that wrote it.
*/
function resolveSpecifier(fromPath: string, specifier: string): string {
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
function importsOf(source: string): string[] {
  const code = withoutComments(source);
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
 * The other units one file imports from. A unit and its own sub-module
 * count as one here: LikeC4 refuses an arrow between a parent and its
 * child, and the nesting already says it.
 */
function importedUnits(
  path: string,
  source: string,
  from: string,
  units: readonly string[],
): string[] {
  const found: string[] = [];
  for (const specifier of importsOf(source)) {
    if (!specifier.startsWith(".")) continue;
    const to = owningUnit(resolveSpecifier(path, specifier), units);
    if (to === undefined || isUnder(to, from) || isUnder(from, to)) continue;
    found.push(to);
  }
  return found;
}

const WIRING_FILE = /(?:\/functions\.ts|\.tsx)$/u;

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
 * One arrow per pair of units where a file in the first imports from the
 * second: `imports` when any file outside the wiring does, `wiring` when
 * only wiring files do. The arrow carries no names. A label would change
 * with every new import, and lanes working in parallel would conflict on
 * this file for no change in structure.
 */
function importArrows(
  sources: Readonly<Record<string, string>>,
  units: readonly string[],
): Arrow[] {
  const pairs = new Map<string, boolean>();
  for (const [path, source] of Object.entries(sources)) {
    const from = owningUnit(path, units);
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
  const config = wranglerSchema.parse(parseJsonc(inputs.wranglerJsonc));
  const words = wordsSchema.parse(inputs.words);
  const units = unitFolders(Object.keys(inputs.sources));

  const bound = boundElements(config);
  const inWorker = [
    ...moduleElements(units, MODULES_ROOT.slice(0, -1)),
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
