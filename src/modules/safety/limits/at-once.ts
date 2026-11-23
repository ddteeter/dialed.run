/**
 * A queue row on the removal clock, as SQL (SA-L12): read by the burst
 * release and the reports breaker. Its own file because both import it,
 * and the breakers sit below `review.ts` in the import graph.
 */
import { and, inArray, sql, type SQL } from "drizzle-orm";

import { reports, reviewQueue } from "../../../db/schema-core";
import { qualified } from "../../../lib/sql/qualified";
import { reasonsOnTheClock } from "../rules";

/**
 * No report of a reason that hides at once is filed on this queue row's
 * subject (SA-L12): a correlated `NOT EXISTS` over `reports_subject`, for
 * a read of `review_queue`. Such a row is on the removal clock, so the
 * burst release leaves it for a person, and the reports breaker does not
 * count it (that report never asked the breaker). Built on call.
 */
export function noReportHidingAtOnce(): SQL {
  return sql`not ${reportHidingAtOnce()}`;
}

/**
 * A report of a reason that hides at once is filed on this queue row's
 * subject: the correlated `EXISTS` the line above negates, and what an
 * owner's delete under review keeps a record of (design 232). With
 * `also`, only such a report that also meets each: what refuses an
 * Approve made on a page read before it (`review.ts`).
 */
export function reportHidingAtOnce(...also: readonly SQL[]): SQL {
  // Both sides named by table (`qualified`).
  return sql`exists (select 1 from ${reports} where ${qualified(reports, reports.subjectType)} = ${qualified(reviewQueue, reviewQueue.subjectType)} and ${qualified(reports, reports.subjectId)} = ${qualified(reviewQueue, reviewQueue.subjectId)} and ${and(inArray(reports.reason, reasonsOnTheClock), ...also)})`;
}
