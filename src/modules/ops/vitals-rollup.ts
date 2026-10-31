/**
 * The daily speed rollup (design 165): yesterday's percentiles from the
 * `VITALS` dataset into `perf_daily` in the ops database, so the shape of
 * every day outlives Analytics Engine's three months.
 *
 * It rides the daily firing as one digest check (design 162): a failure
 * is a line in the digest and costs no other check. Each firing rolls up
 * the last `ROLLUP_DAYS` days, not just yesterday, so a day the API could
 * not answer is filled in by the next firing, and points that arrived
 * late are counted. A day is replaced whole in one batch, so a re-run
 * overwrites it (law 1).
 */
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";

import { perfDaily } from "../../db/schema-ops";
import { env, opsDb } from "../../env";
import { chunked } from "../../lib/chunked";
import { dailyRollupQuery } from "./vitals-queries";

/**
 * How many days back each firing rolls up, yesterday included.
 */
export const ROLLUP_DAYS = 3;

/**
 * Law 4: every outbound fetch is bounded. The SQL API answers a day's
 * rollup in well under a second; ten is generous.
 */
const TIMEOUT_MS = 10_000;

/**
 * Rows per insert: D1 refuses a statement with more than 100 bound
 * parameters, and a row binds eight.
 */
const ROWS_PER_INSERT = 12;

/**
 * A number as the SQL API may send it. Its docs show values as strings
 * and do not say which types come back as numbers, so both are taken; a
 * string that is not a plain decimal is refused.
 */
const numeric = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu)
      .transform(Number),
  ])
  .pipe(z.number());

const rowSchema = z.object({
  route: z.string().min(1).max(96),
  metric: z.string().min(1).max(32),
  device: z.string().min(1).max(32),
  p50: numeric,
  p75: numeric,
  p95: numeric,
  n: numeric.pipe(z.number().int().nonnegative()),
});

const responseSchema = z.object({ data: z.array(rowSchema) });

type RollupRow = z.infer<typeof rowSchema>;

export interface RollupDeps {
  /**
   * Runs one query against the SQL API and returns its parsed JSON, or
   * `undefined` when the account and token are not configured.
   */
  readonly query: ((sql: string) => Promise<unknown>) | undefined;
  readonly db: Pick<DrizzleD1Database, "batch" | "delete" | "insert">;
}

/**
 * The real SQL API and ops database. `bindings` is a parameter so the
 * reading of each can be tested.
 */
export function rollupDepsFromEnv(
  bindings: Readonly<{
    CF_ACCOUNT_ID?: string | undefined;
    ANALYTICS_SQL_TOKEN?: string | undefined;
  }> = env,
): RollupDeps {
  const account = bindings.CF_ACCOUNT_ID ?? "";
  const token = bindings.ANALYTICS_SQL_TOKEN ?? "";
  return {
    query:
      account === "" || token === ""
        ? undefined
        : async (sql) => {
            const response = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/analytics_engine/sql`,
              {
                method: "POST",
                headers: { authorization: `Bearer ${token}` },
                body: sql,
                signal: AbortSignal.timeout(TIMEOUT_MS),
              },
            );
            // The status only: an error body may echo the query, and
            // nothing else of it is ours to report (law 7).
            if (!response.ok) {
              throw new Error(
                `Analytics Engine SQL API answered ${String(response.status)}`,
              );
            }
            const body: unknown = await response.json();
            return body;
          },
    db: opsDb(),
  };
}

/**
 * The UTC day `count` days before `day`.
 */
export function dayBefore(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

/**
 * The `count` UTC days before `today`, newest first.
 */
export function daysBefore(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    dayBefore(today, index + 1),
  );
}

/**
 * Replaces one day's rows with `rows`, in one batch, so the day is never
 * seen half-written.
 */
async function replaceDay(
  db: RollupDeps["db"],
  day: string,
  rows: readonly RollupRow[],
): Promise<void> {
  await db.batch([
    db.delete(perfDaily).where(eq(perfDaily.day, day)),
    ...chunked(rows, ROWS_PER_INSERT).map((chunk) =>
      db.insert(perfDaily).values(chunk.map((row) => ({ day, ...row }))),
    ),
  ]);
}

/**
 * What went wrong with a day, for the digest. An answer that did not parse
 * is named, not quoted: zod's message carries the values it refused.
 */
function whyFailed(error: unknown): string {
  if (error instanceof z.ZodError) return "the SQL API's answer did not parse";
  return error instanceof Error ? error.message : "an unknown error";
}

/**
 * Rolls up the `ROLLUP_DAYS` days before `today` (`YYYY-MM-DD`, UTC).
 * What it could not do goes into `anomalies`, one line per day, and the
 * other days carry on.
 */
export async function rollupVitals(
  today: string,
  anomalies: string[],
  deps: RollupDeps = rollupDepsFromEnv(),
): Promise<void> {
  const { query } = deps;
  if (query === undefined) {
    anomalies.push(
      "speed rollup: CF_ACCOUNT_ID or ANALYTICS_SQL_TOKEN is not set, so no day was rolled up",
    );
    return;
  }
  for (const day of daysBefore(today, ROLLUP_DAYS)) {
    try {
      const parsed = responseSchema.parse(await query(dailyRollupQuery(day)));
      await replaceDay(deps.db, day, parsed.data);
    } catch (error) {
      anomalies.push(`speed rollup for ${day} failed: ${whyFailed(error)}`);
    }
  }
}
