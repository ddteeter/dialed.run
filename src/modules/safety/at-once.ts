/**
 * A queue row on the removal clock, as SQL (SA-L12): read by the burst
 * release and the reports breaker. Its own file because both import it,
 * and the breakers sit below `review.ts` in the import graph.
 */
import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { reports, reviewQueue } from "../../db/schema-core";
import { reasonsOnTheClock } from "./contracts";

/**
 * No report of a reason that hides at once is filed on this queue row's
 * subject (SA-L12): a correlated `NOT EXISTS` over `reports_subject`, for
 * a read of `review_queue`. Such a row is on the removal clock, so the
 * burst release leaves it for a person, and the reports breaker does not
 * count it (that report never asked the breaker). Built on call.
 */
export function noReportHidingAtOnce(): SQL {
  // Both sides named by table: drizzle may print a column bare, and a bare
  // `subject_id = subject_id` inside the subquery is true of every report.
  const of = (table: SQLiteTable, column: SQLiteColumn) =>
    sql`${table}.${sql.identifier(column.name)}`;
  return sql`not exists (select 1 from ${reports} where ${of(reports, reports.subjectType)} = ${of(reviewQueue, reviewQueue.subjectType)} and ${of(reports, reports.subjectId)} = ${of(reviewQueue, reviewQueue.subjectId)} and ${of(reports, reports.reason)} in (${sql.join(
    reasonsOnTheClock.map((reason) => sql`${reason}`),
    sql`, `,
  )}))`;
}
