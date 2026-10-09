/**
 * The Desk's Gave up (Operator Screens D6, a section of Today since round
 * 30; register R-119): the jobs the system stopped retrying, what each was
 * doing, and the retry that fits it.
 *
 * Every row comes from `gave_up`, which the writers fill in the batch that
 * marks their own status (`db/gave-up.ts`). This file reads it and
 * acts on it; it never writes a failure.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";

import { gaveUpClear } from "../../db/gave-up";
import {
  brands,
  gaveUp,
  imports,
  outbox,
  products,
  productSnapshots,
  runs,
  stravaConnections,
  userProfiles,
} from "../../db/schema-core";
import { env } from "../../env";
import type { GaveUpKind } from "../../lib/contracts/gave-up";
import { clockLabel, monthDayLabel } from "../../lib/dates";
import { firstColumnWhere, firstRowWhere } from "../../lib/sql/keyed-read";
import { dedupeKeyFor } from "../../lib/sql/outbox";
import { reextract, requestEnrichment } from "../enrichment";
import { reminderFromSubject, type ImportJob, type ReminderJob } from "../runs";
import type { GaveUpRetry } from "./inputs";
import { enrichmentDeps } from "./queues";
import { captureException } from "./sentry";

type Db = DrizzleD1Database & { $client: D1Database };

/**
 * How many rows Today loads. Today shows two and expands in place (round
 * 29 B·2), and its count is the whole table's, so a desk with more than
 * this many reads the true number with the newest this many listed.
 */
export const GAVE_UP_LIST_LIMIT = 50;

/**
One row on Today's Gave up, worded for display.
*/
export interface GaveUpJob {
  readonly id: string;
  readonly kind: GaveUpKind;
  /**
  What it was trying to do: "Read the product page for Janji AFO Middle Layer".
  */
  readonly doing: string;
  readonly reason: string;
  readonly rawError: string | undefined;
  readonly tries: number;
  readonly firstFailedAt: number;
  readonly lastFailedAt: number;
  /**
   * Enrichment only: whether a fetched page is stored, which is what Re-run
   * extraction reads ("disabled with no fetched page", product.md D6).
   */
  readonly hasStoredPage: boolean;
}

/**
 * Who a row is about, as a sentence names them: "@sam", or "a runner"
 * for an account with no handle (or none left).
 */
function who(handle: string | null | undefined): string {
  return handle === null || handle === undefined ? "a runner" : `@${handle}`;
}

interface SubjectFacts {
  readonly products: ReadonlyMap<string, string>;
  readonly storedPages: ReadonlySet<string>;
  readonly runs: ReadonlyMap<
    string,
    { startedAt: number; handle: string | null }
  >;
  readonly imports: ReadonlyMap<string, string | null>;
  readonly athletes: ReadonlyMap<string, string | null>;
}

/**
 * What each row was doing, in the board's grammar ("Read the product page
 * for …", "Fetch weather for @sam's run, Sep 14 · 6:10 AM"). A subject that
 * has since gone still gets a sentence, so a row never renders blank. The
 * run's time is UTC, the Desk's clock: a run carries no zone of its own.
 */
export function doingOf(
  row: { kind: GaveUpKind; subjectId: string },
  facts: SubjectFacts,
): string {
  switch (row.kind) {
    case "enrichment": {
      const product = facts.products.get(row.subjectId);
      return product === undefined
        ? "Read the page for a product that is gone"
        : `Read the product page for ${product}`;
    }
    case "weather": {
      const run = facts.runs.get(row.subjectId);
      if (run === undefined) return "Fetch weather for a run that is gone";
      const at = `${monthDayLabel(run.startedAt)} · ${clockLabel(run.startedAt)}`;
      return `Fetch weather for ${who(run.handle)}'s run, ${at}`;
    }
    case "import": {
      return facts.imports.has(row.subjectId)
        ? `Read ${who(facts.imports.get(row.subjectId))}'s run file`
        : "Read a run file whose import is gone";
    }
    case "reminder": {
      const job = reminderFromSubject(row.subjectId);
      const handle =
        job === undefined ? undefined : facts.athletes.get(job.athleteId);
      return `Remind ${who(handle)} about a new run on Strava`;
    }
  }
}

/**
 * The facts each row's sentence needs, in one round trip: every lookup is
 * by primary key or an index (`product_snapshots_product_fetched`,
 * `strava_connections_athlete`), over the ids on this page only. Each
 * lookup is handed every subject on the page, whatever its kind: the ids
 * are ULIDs, so a run's id finds no product, and one list is fewer things
 * to get wrong than four filtered ones.
 */
async function subjectFacts(
  db: Db,
  rows: readonly { kind: GaveUpKind; subjectId: string }[],
): Promise<SubjectFacts> {
  const subjects = rows.map((row) => row.subjectId);
  const athleteIds = subjects
    .map((subject) => reminderFromSubject(subject))
    .filter((job) => job !== undefined)
    .map((job) => job.athleteId);
  const [productRows, pageRows, runRows, importRows, athleteRows] =
    await db.batch([
      db
        .select({
          id: products.id,
          // One column, worded in SQL: both tables call theirs `name`, and
          // D1 hands rows back keyed by column name. A product whose brand
          // row is gone is named alone.
          label: sql<string>`coalesce(${brands.name} || ' ', '') || ${products.name}`,
        })
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .where(inArray(products.id, subjects)),
      db
        .selectDistinct({ id: productSnapshots.productId })
        .from(productSnapshots)
        .where(inArray(productSnapshots.productId, subjects)),
      db
        .select({
          id: runs.id,
          startedAt: runs.startedAt,
          handle: userProfiles.username,
        })
        .from(runs)
        .leftJoin(userProfiles, eq(userProfiles.userId, runs.userId))
        .where(inArray(runs.id, subjects)),
      db
        .select({ id: imports.id, handle: userProfiles.username })
        .from(imports)
        .leftJoin(userProfiles, eq(userProfiles.userId, imports.userId))
        .where(inArray(imports.id, subjects)),
      db
        .select({
          id: stravaConnections.athleteId,
          handle: userProfiles.username,
        })
        .from(stravaConnections)
        .leftJoin(
          userProfiles,
          eq(userProfiles.userId, stravaConnections.userId),
        )
        .where(inArray(stravaConnections.athleteId, athleteIds)),
    ]);
  return {
    products: new Map(productRows.map((row) => [row.id, row.label])),
    storedPages: new Set(pageRows.map((row) => row.id)),
    runs: new Map(runRows.map(({ id, ...run }) => [id, run])),
    imports: new Map(importRows.map((row) => [row.id, row.handle])),
    athletes: new Map(athleteRows.map((row) => [row.id, row.handle])),
  };
}

/**
 * Today's Gave up rows, newest failure first, on `gave_up_last_failed`.
 */
export async function gaveUpJobs(
  db: Db = drizzle(env.DIALED_CORE),
): Promise<readonly GaveUpJob[]> {
  const rows = await db
    .select()
    .from(gaveUp)
    .orderBy(desc(gaveUp.lastFailedAt))
    .limit(GAVE_UP_LIST_LIMIT);
  const facts = await subjectFacts(db, rows);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    doing: doingOf(row, facts),
    reason: row.reason,
    rawError: row.rawError ?? undefined,
    tries: row.tries,
    firstFailedAt: row.firstFailedAt,
    lastFailedAt: row.lastFailedAt,
    hasStoredPage:
      row.kind === "enrichment" && facts.storedPages.has(row.subjectId),
  }));
}

/**
 * What a retry needs from outside: the two queues and the extraction
 * deps, handed in so a test can watch what is sent.
 */
export interface RetryDeps {
  readonly db: Db;
  readonly enrichmentQueue: Parameters<typeof requestEnrichment>[2]["queue"];
  readonly importsQueue: {
    send: (message: ImportJob | ReminderJob) => Promise<unknown>;
  };
  readonly reextract: (productId: string) => Promise<unknown>;
  /**
  Whether an import's run file is still in the bucket.
  */
  readonly importFileExists: (key: string) => Promise<boolean>;
}

function liveRetryDeps(): RetryDeps {
  return {
    db: drizzle(env.DIALED_CORE),
    enrichmentQueue: env.ENRICHMENT_QUEUE,
    importsQueue: env.IMPORTS_QUEUE,
    reextract: (productId) => reextract(enrichmentDeps(), productId),
    importFileExists: async (key) => (await env.IMPORTS.head(key)) !== null,
  };
}

/**
 * What a retry did: sent the job back (`retried`), found nothing left to
 * retry (`gone` — the row already went, to a second press or another
 * operator, or the job's subject did: its product, run or import, or the
 * run file an import would read), or found no stored page to re-extract
 * (`no-page`, the row stays). A `gone` row is cleared, never re-sent.
 */
export type RetryOutcome = "retried" | "gone" | "no-page";

type Row = typeof gaveUp.$inferSelect;

/**
 * Enrichment's two retries (D6: "re-fetch starts over; re-run extraction
 * reuses the stored page"). Re-fetch is `requestEnrichment`, which claims
 * the product from `failed` and sends `enrich`; a product no longer
 * `failed` claims nothing, and the row goes either way, because there is
 * nothing left to retry.
 */
async function retryEnrichment(
  row: Row,
  step: GaveUpRetry["step"],
  deps: RetryDeps,
): Promise<RetryOutcome> {
  if (step === "extract") {
    const report = await deps.reextract(row.subjectId);
    if (report === undefined) return "no-page";
    await gaveUpClear(deps.db, "enrichment", row.subjectId);
    return "retried";
  }
  const product = await firstColumnWhere(
    deps.db,
    products,
    products.id,
    eq(products.id, row.subjectId),
  );
  if (product === undefined) {
    await gaveUpClear(deps.db, "enrichment", row.subjectId);
    return "gone";
  }
  await requestEnrichment(deps.db, row.subjectId, {
    queue: deps.enrichmentQueue,
    captureException,
  });
  await gaveUpClear(deps.db, "enrichment", row.subjectId);
  return "retried";
}

/**
 * Weather goes back to `pending`, which is the hourly cron's own marker
 * (law 8c, reconciliation): no message to send, and nothing lost if the
 * Desk's request dies after the batch.
 */
async function retryWeather(row: Row, deps: RetryDeps): Promise<RetryOutcome> {
  const { db } = deps;
  const run = await firstColumnWhere(
    db,
    runs,
    runs.id,
    eq(runs.id, row.subjectId),
  );
  const stillFailed = and(
    eq(runs.id, row.subjectId),
    eq(runs.weatherStatus, "failed"),
  );
  await db.batch([
    db.update(runs).set({ weatherStatus: "pending" }).where(stillFailed),
    gaveUpClear(db, "weather", row.subjectId),
  ]);
  return run === undefined ? "gone" : "retried";
}

/**
 * An import goes back to `pending`, its owed file deletion is cancelled —
 * the file is now a run's again, kept as long as the run (D-110) — and
 * `import` is sent. A send that fails leaves the import `pending`, which
 * the stalled-import sweep re-dispatches, so the send's failure is
 * reported rather than thrown. A retry that fails again re-owes the
 * deletion, as every failure does.
 */
async function retryImport(row: Row, deps: RetryDeps): Promise<RetryOutcome> {
  const { db } = deps;
  const importRow = await firstRowWhere(
    db,
    imports,
    eq(imports.id, row.subjectId),
  );
  // An import whose file has gone — its 30-day expiry paid, or the
  // account purged — cannot be read again: re-sending it would fail at
  // once and send its runner a second, misleading failure notice. So the
  // row goes, and nothing is sent.
  if (
    importRow === undefined ||
    !(await deps.importFileExists(importRow.r2Key))
  ) {
    await gaveUpClear(db, "import", row.subjectId);
    return "gone";
  }
  const expiry = dedupeKeyFor({
    kind: "import_file_expire",
    payload: { userId: importRow.userId, key: importRow.r2Key },
  });
  const stillFailed = and(
    eq(imports.id, importRow.id),
    eq(imports.status, "failed"),
  );
  const owedExpiry = and(
    eq(outbox.kind, "import_file_expire"),
    eq(outbox.dedupeKey, expiry),
  );
  await db.batch([
    db
      .update(imports)
      .set({ status: "pending", failureReason: sql`NULL` })
      .where(stillFailed),
    db.delete(outbox).where(owedExpiry),
    gaveUpClear(db, "import", row.subjectId),
  ]);
  try {
    await deps.importsQueue.send({ type: "import", importId: importRow.id });
  } catch (error) {
    captureException(error, {
      surface: "desk-retry-import",
      importId: importRow.id,
    });
  }
  return "retried";
}

/**
 * A reminder is sent again as the job it was — the row is the only record
 * of it, so the send comes first and the row goes only once it is on the
 * queue. A send that fails throws and the row stays, for the operator to
 * press again. Sending twice is harmless: the consumer's claim and the
 * notification's UNIQUE key make a second delivery write nothing.
 */
async function retryReminder(row: Row, deps: RetryDeps): Promise<RetryOutcome> {
  const job = reminderFromSubject(row.subjectId);
  if (job !== undefined) await deps.importsQueue.send(job);
  await gaveUpClear(deps.db, "reminder", row.subjectId);
  return job === undefined ? "gone" : "retried";
}

/**
 * The operator's Retry (D6: "A retry leaves the row at once and goes back
 * to the queue; if it fails again it returns here with the new reason").
 * Safe to press twice: the second finds no row.
 */
export async function retryGaveUp(
  input: GaveUpRetry,
  deps: RetryDeps = liveRetryDeps(),
): Promise<RetryOutcome> {
  const row = await firstRowWhere(deps.db, gaveUp, eq(gaveUp.id, input.id));
  if (row === undefined) return "gone";
  switch (row.kind) {
    case "enrichment": {
      return retryEnrichment(row, input.step, deps);
    }
    case "weather": {
      return retryWeather(row, deps);
    }
    case "import": {
      return retryImport(row, deps);
    }
    case "reminder": {
      return retryReminder(row, deps);
    }
  }
}

/**
 * The operator's Drop (D6: "Drop is quiet on purpose: it removes the row
 * and the job, nothing else"). The row is all that is left of the job, so
 * removing it is removing both; the subject keeps its `failed`.
 */
export async function dropGaveUp(
  id: string,
  db: Db = drizzle(env.DIALED_CORE),
): Promise<void> {
  await db.delete(gaveUp).where(eq(gaveUp.id, id));
}
