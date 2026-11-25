/**
 * The removals still undecided as their 48 hours run out (C6): what the
 * hourly reminder (`ops/daily/removal-reminders.ts`) owes the operators an email
 * about, 8 hours before each is due.
 *
 * Two kinds of removal carry the TAKE IT DOWN Act's clock, and both are
 * read here so the reminder cannot know one and forget the other:
 *
 * - a `/takedown` request still `pending`, by its own `dueAt`; and
 * - a Review row an intimate-image report started, still `pending` or
 *   claimed, due 48 hours after that first report (`removalClock`).
 *
 * Only a request that alerted the operators is one to remind them of: a
 * blocked requester's alerts nobody, and one waiting on its requester's
 * confirm alerts nobody until it is confirmed (design 137). One that
 * alerted only through the valve's hourly email is reminded of the same
 * way, by a count (`isOneByOne` false).
 */
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import {
  reports,
  reviewQueue,
  takedownRequests,
} from "../../../db/schema-core";
import { REMOVAL_DUE_SECONDS } from "../rules";
import { reportsOnQueueRow } from "./reports";
import { firstReportHidingAtOnce } from "../review";

type Db = ReturnType<typeof drizzle>;

/**
 * How long before its deadline an undecided removal is reminded of: at
 * 40 of its 48 hours.
 */
export const REMOVAL_REMINDER_LEAD_SECONDS = 8 * 60 * 60;

/**
 * One undecided removal: `kind` says whether a `/takedown` request or a
 * report's Review row, `key` names it for the reminder's dedupe key,
 * `dueAt` is its deadline, and `isOneByOne` whether it alerted every
 * operator one by one (every report's Review row did; a request did
 * where it newly hid its subject or the hour's allowance had room).
 */
export interface UndecidedRemoval {
  readonly kind: "request" | "report";
  readonly key: string;
  readonly dueAt: number;
  readonly isOneByOne: boolean;
}

/**
 * The undecided removals due in `(after, until]`, in no order. `after`
 * is `undefined` for no lower bound: everything due by `until`, overdue
 * included.
 *
 * The requests are read on `takedown_requests_status_due`; the Review rows
 * by status, then their reports by `reports_subject`.
 */
export async function undecidedRemovalsDue(
  db: Db,
  window: { readonly after: number | undefined; readonly until: number },
): Promise<UndecidedRemoval[]> {
  // NULL is a link that is not ours, which alerted as `held` does.
  const alerted = or(
    isNull(takedownRequests.holdState),
    inArray(takedownRequests.holdState, ["held", "valve"]),
  );
  const requests = await db
    .select({
      id: takedownRequests.id,
      dueAt: takedownRequests.dueAt,
      hidAt: takedownRequests.hidAt,
      alertedAt: takedownRequests.alertedAt,
    })
    .from(takedownRequests)
    .where(
      and(
        eq(takedownRequests.status, "pending"),
        window.after === undefined
          ? undefined
          : gt(takedownRequests.dueAt, window.after),
        lte(takedownRequests.dueAt, window.until),
        alerted,
      ),
    );
  const dueAt = sql<number>`${firstReportHidingAtOnce()} + ${REMOVAL_DUE_SECONDS}`;
  const rows = await db
    .select({
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      dueAt,
    })
    .from(reviewQueue)
    .innerJoin(reports, reportsOnQueueRow())
    .where(inArray(reviewQueue.status, ["pending", "reviewing"]))
    .groupBy(reviewQueue.id)
    .having(
      and(
        window.after === undefined ? undefined : gt(dueAt, window.after),
        lte(dueAt, window.until),
      ),
    );
  return [
    ...requests.map((row) => ({
      kind: "request" as const,
      key: `request:${row.id}`,
      dueAt: row.dueAt,
      isOneByOne: row.hidAt !== null || row.alertedAt !== null,
    })),
    ...rows.map((row) => ({
      kind: "report" as const,
      key: `${row.subjectType}:${row.subjectId}`,
      dueAt: row.dueAt,
      isOneByOne: true,
    })),
  ];
}
