import { z } from "zod";

/**
 * D1 queries per request, from the e2e run (design 182, part 2).
 *
 * A dev server started with `VITE_D1_QUERY_TALLY=1` names each response's
 * D1 work in one header; an e2e fixture records it, and the teardown turns
 * the run's lines into a table per route, compared with
 * `e2e/query-baseline.json`. Everything here is pure, so `e2e/` holds only
 * file and environment glue. Report-only: nothing here fails a run.
 */

/**
The response header a tallied request carries.
*/
export const QUERY_HEADER = "x-d1-queries";

/**
 * How design 165's request names mark a server function call:
 * `serverFn:<id>`. `modules/ops/timing.ts` names requests with it.
 */
export const SERVER_FN_ROUTE = "serverFn:";

/**
 * A dev server's server function id: base64url of the function's file and
 * export. (A production build hashes them instead, and nothing there is
 * tallied.)
 */
const devServerFnIdSchema = z.object({
  file: z.string(),
  export: z.string(),
});

/**
A module's `functions.ts`, with or without the query string Start adds.
*/
const MODULE_FUNCTIONS =
  /^\/src\/modules\/(?<module>[^/]+)\/functions\.ts(?:\?.*)?$/u;
const HANDLER_SUFFIX = /_createServerFn_handler$/u;

/**
An id decoded, or `undefined` when it is not base64url JSON.
*/
function devServerFnId(id: string): unknown {
  let decoded: unknown;
  try {
    decoded = JSON.parse(atob(id.replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    // Not base64, or not JSON: no id, so the name is kept as it came.
  }
  return decoded;
}

/**
 * A route as the report names it: a dev server function's id decoded to
 * `serverFn:<module>/<export>` (its file, when not a module's
 * `functions.ts`), so a reader sees `serverFn:notifications/bellStateFn`
 * rather than base64. Any other name is kept as it came.
 */
export function readableRoute(route: string): string {
  if (!route.startsWith(SERVER_FN_ROUTE)) return route;
  const parsed = devServerFnIdSchema.safeParse(
    devServerFnId(route.slice(SERVER_FN_ROUTE.length)),
  );
  if (!parsed.success) return route;
  const { file, export: exported } = parsed.data;
  const where = MODULE_FUNCTIONS.exec(file)?.[1] ?? file;
  return `${SERVER_FN_ROUTE}${where}/${exported.replace(HANDLER_SUFFIX, "")}`;
}

/**
 * One request's D1 work: its route (a route id or `serverFn:<id>`, as
 * design 165 names it), statements run, and rows read.
 */
const queryLineSchema = z.strictObject({
  route: z.string().min(1),
  statements: z.number().int().nonnegative(),
  rowsRead: z.number().int().nonnegative(),
});

export type QueryLine = z.infer<typeof queryLineSchema>;

/**
`<route>;<statements>;<rowsRead>`: the header's value.
*/
export function formatQueryHeader(line: QueryLine): string {
  return `${line.route};${String(line.statements)};${String(line.rowsRead)}`;
}

/**
 * A header's value: anything, then two counts. The route is everything
 * before the last two fields, so a `;` in a name cannot shift the counts.
 */
const headerSchema = z
  .string()
  .max(1024)
  .regex(/^.+;\d+;\d+$/u)
  .transform((value) => {
    const fields = value.split(";");
    const rowsRead = Number(fields.pop());
    const statements = Number(fields.pop());
    return { route: fields.join(";"), statements, rowsRead };
  })
  .pipe(queryLineSchema);

/**
 * A header's value, parsed (trust boundary: it arrives over HTTP, from
 * whatever server the run reached). Anything else is no line at all.
 */
export function parseQueryHeader(value: unknown): QueryLine | undefined {
  return headerSchema.safeParse(value).data;
}

/**
 * The lines of a `requests.jsonl` the fixture wrote. A line that does not
 * parse is skipped: a report must not die on one torn write.
 */
export function parseQueryLines(text: string): QueryLine[] {
  const lines: QueryLine[] = [];
  for (const raw of text.split("\n")) {
    try {
      lines.push(queryLineSchema.parse(JSON.parse(raw)));
    } catch {
      // Not JSON, or not a line: skipped.
    }
  }
  return lines;
}

const spreadSchema = z.strictObject({
  p50: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

/**
A route's requests: how many, and statements and rows read, p50 and max.
*/
const routeSummarySchema = z.strictObject({
  count: z.number().int().positive(),
  statements: spreadSchema,
  rowsRead: spreadSchema,
});

type Spread = z.infer<typeof spreadSchema>;

/**
 * `e2e/query-baseline.json`: each route's summary from a recorded run
 * (`QUERY_RECORD=1`).
 */
export const queryBaselineSchema = z.strictObject({
  routes: z.record(z.string(), routeSummarySchema),
});

export type QueryBaseline = z.infer<typeof queryBaselineSchema>;

/**
 * The nearest-rank p50 and the max of a non-empty list: the p50 is a value
 * that was measured, never a mean between two.
 */
function spreadOf(values: readonly number[]): Spread {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length / 2) - 1] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}

/**
 * Each route's summary, by its readable name (`readableRoute`): the shape
 * the baseline stores.
 */
export function summarize(lines: readonly QueryLine[]): QueryBaseline {
  const byRoute = Map.groupBy(lines, (line) => readableRoute(line.route));
  const routes: Record<string, z.infer<typeof routeSummarySchema>> = {};
  const groups = [...byRoute].toSorted(([a], [b]) => a.localeCompare(b));
  for (const [route, group] of groups) {
    routes[route] = {
      count: group.length,
      statements: spreadOf(group.map((line) => line.statements)),
      rowsRead: spreadOf(group.map((line) => line.rowsRead)),
    };
  }
  return { routes };
}

interface Rise {
  readonly route: string;
  readonly was: Spread;
  readonly now: Spread;
}

export interface BaselineDiff {
  /**
  Routes whose p50 or max statements rose.
  */
  readonly rose: readonly Rise[];
  readonly added: readonly string[];
  readonly gone: readonly string[];
}

/**
 * The routes in `from` that `other` does not have.
 */
function routesMissingFrom(
  from: QueryBaseline,
  other: QueryBaseline,
): string[] {
  return Object.keys(from.routes).filter(
    (route) => !Object.hasOwn(other.routes, route),
  );
}

export function compareWithBaseline(
  run: QueryBaseline,
  baseline: QueryBaseline,
): BaselineDiff {
  const rose: Rise[] = [];
  for (const [route, summary] of Object.entries(run.routes)) {
    const was = baseline.routes[route]?.statements;
    const now = summary.statements;
    if (was !== undefined && (now.p50 > was.p50 || now.max > was.max)) {
      rose.push({ route, was, now });
    }
  }
  return {
    rose,
    added: routesMissingFrom(run, baseline),
    gone: routesMissingFrom(baseline, run),
  };
}

/**
A route name as a table cell: a `|` would end the cell early.
*/
const ESCAPED_PIPE = String.raw`\|`;

function cell(route: string): string {
  const escaped = route.split("|").join(ESCAPED_PIPE);
  return `\`${escaped}\``;
}

function spreadText(spread: Spread): string {
  return `${String(spread.p50)} / ${String(spread.max)}`;
}

function listed(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : ["", `${title}:`, ...items];
}

/**
 * The step summary's section: the table, then what moved against the
 * baseline.
 */
export function renderQueryReport(
  run: QueryBaseline,
  diff: BaselineDiff,
): string {
  const rows = Object.entries(run.routes).map(
    ([route, summary]) =>
      `| ${cell(route)} | ${String(summary.count)} | ${spreadText(summary.statements)} | ${spreadText(summary.rowsRead)} |`,
  );
  const table =
    rows.length === 0
      ? ["No request carried a query count."]
      : [
          "| route | requests | statements p50 / max | rows read p50 / max |",
          "| --- | --- | --- | --- |",
          ...rows,
        ];
  return [
    "### D1 queries per request",
    "",
    ...table,
    ...listed(
      "Statements rose against e2e/query-baseline.json",
      diff.rose.map(
        (rise) =>
          `- ${cell(rise.route)}: ${spreadText(rise.was)} → ${spreadText(rise.now)}`,
      ),
    ),
    ...listed(
      "New since the baseline",
      diff.added.map((route) => `- ${cell(route)}`),
    ),
    ...listed(
      "Gone since the baseline",
      diff.gone.map((route) => `- ${cell(route)}`),
    ),
    "",
  ].join("\n");
}
