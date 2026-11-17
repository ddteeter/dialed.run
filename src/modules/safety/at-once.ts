/**
 * A queue row on the removal clock, as SQL (SA-L12): read by the burst
 * release and the reports breaker. Its own file because both import it,
 * and the breakers sit below `review.ts` in the import graph.
 */
import { inArray, sql, type SQL } from "drizzle-orm";

import { reports, reviewQueue } from "../../db/schema-core";
import { qualified } from "../../lib/sql/qualified";
import { reasonsOnTheClock } from "./contracts";

/**
 * No report of a reason that hides at once is filed on this queue row's
 * subject (SA-L12): a correlated `NOT EXISTS` over `reports_subject`, for
 * a read of `review_queue`. Such a row is on the removal clock, so the
 * burst release leaves it for a person, and the reports breaker does not
 * count it (that report never asked the breaker). Built on call.
 */
export function noReportHidingAtOnce(): SQL {
  // Both sides named by table (`qualified`).
  return sql`not exists (select 1 from ${reports} where ${qualified(reports, reports.subjectType)} = ${qualified(reviewQueue, reviewQueue.subjectType)} and ${qualified(reports, reports.subjectId)} = ${qualified(reviewQueue, reviewQueue.subjectId)} and ${inArray(reports.reason, reasonsOnTheClock)})`;
}
