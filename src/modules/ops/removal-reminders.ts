/**
 * The 40-hour reminder (C6): an undecided removal, a `/takedown` request
 * or an intimate-image report, is emailed to every operator once more
 * when 8 of its 48 hours are left.
 *
 * **On the hourly `:00` firing, not the daily digest.** The digest runs at
 * 12:00 UTC, so a removal filed between 04:00 and 20:00 would reach its
 * deadline before any digest saw it past 40 hours. Hourly, a reminder
 * goes out between 40 and 41 hours, and the email drain sends it within
 * the half hour after.
 *
 * **Once, however often the firing runs** (law 1). The outbox's dedupe
 * key does not say so on its own: a sent row is deleted, and a later
 * firing would owe it again. So a high-water mark does
 * (`REMOVAL_REMINDERS`): each firing owes the removals that came within 8
 * hours of their deadline since the mark, and moves the mark, in one
 * batch. The move is a claim (law 2): it lands only if the mark is still
 * the one this firing read, and every reminder is owed only if it landed,
 * so two firings that overlap owe each reminder once between them.
 */
import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { cronCheckpoints } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import { emailDebt } from "../email";
import {
  adminUserIds,
  REMOVAL_REMINDER_LEAD_SECONDS,
  undecidedRemovalsDue,
} from "../safety";
import { markedAt, REMOVAL_REMINDERS } from "./digest-marks";
import { outboxInsertWhere, oweOutbox } from "./outbox";

type Db = ReturnType<typeof drizzle>;

/**
 * Owe every operator a reminder for each removal that came within 8
 * hours of its deadline since the last firing. The first firing ever has
 * no mark, so it owes every undecided removal due within 8 hours,
 * overdue ones included.
 */
export async function oweRemovalReminders(
  db: Db,
  now = nowSeconds(),
): Promise<void> {
  await oweRemindersSince(db, await markedAt(db, REMOVAL_REMINDERS), now);
}

/**
 * `oweRemovalReminders`, from the mark `last` this firing read. A mark
 * that has moved since is another firing's claim, and this one then owes
 * nothing.
 */
export async function oweRemindersSince(
  db: Db,
  last: number | undefined,
  now: number,
): Promise<void> {
  const due = await undecidedRemovalsDue(db, {
    after:
      last === undefined ? undefined : last + REMOVAL_REMINDER_LEAD_SECONDS,
    until: now + REMOVAL_REMINDER_LEAD_SECONDS,
  });
  const claimed = {
    table: cronCheckpoints,
    where: sql`${cronCheckpoints.cronName} = ${REMOVAL_REMINDERS} and ${cronCheckpoints.lastRunAt} = ${now}`,
  };
  const reminders = due.flatMap((removal) =>
    adminUserIds().map((userId) =>
      outboxInsertWhere(
        db,
        oweOutbox(
          emailDebt(
            {
              to: { userId },
              template: { kind: "removal_reminder", dueAt: removal.dueAt },
            },
            { dedupeKey: `removal_reminder:${removal.key}:${userId}` },
          ),
        ),
        claimed,
        now,
      ),
    ),
  );
  await db.batch([claimStatement(db, last, now), ...reminders]);
}

/**
 * Move the mark from `last` to `now`, only if it is still `last`: the
 * first mark is an insert that a racing first mark beats, and every later
 * one an update that a racing move beats.
 */
function claimStatement(db: Db, last: number | undefined, now: number) {
  const mark = db
    .insert(cronCheckpoints)
    .values({ cronName: REMOVAL_REMINDERS, lastRunAt: now });
  return last === undefined
    ? mark.onConflictDoNothing()
    : mark.onConflictDoUpdate({
        target: cronCheckpoints.cronName,
        set: { lastRunAt: now },
        setWhere: eq(cronCheckpoints.lastRunAt, last),
      });
}
