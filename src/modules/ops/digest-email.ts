/**
 * The morning digest by email (task 125 · OPS-11; Operator Screens D5),
 * wired by task 126's email hookups through `modules/email`.
 *
 * **Every day, even at zero** (D5: "so a missing email is a broken
 * pipeline, never a quiet one"). Its body is the Desk's Today — the same
 * three numbers from the same read (`todayCounts`), so the email and the
 * Desk cannot disagree — and its one link goes there. What the digest's
 * checks found goes to Sentry, as before; D5 draws "no list of items —
 * the Desk has those".
 *
 * To every operator (`ADMIN_USER_IDS`) whose address is confirmed, looked
 * up at send time like any runner, so the address is the one their
 * account holds (OPS-11). An operator whose address is not confirmed is
 * skipped, and Today says so (`DIGEST_UNCONFIRMED`).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import { calendarDay, dayLabel } from "../../lib/dates";
import type { EmailTemplate } from "../../lib/contracts/email";
import { columnWhere } from "../../lib/sql/keyed-read";
import { nowSeconds } from "../../lib/now";
import { emailDebt } from "../email";
import { adminUserIds } from "../safety";
import { todayCounts, type TodayCounts } from "./desk";
import {
  DIGEST_OWED,
  DIGEST_UNCONFIRMED,
  markStatement,
  markedAt,
} from "./digest-marks";
import {
  outboxInsert,
  oweOutbox,
  settleOutbox,
  type OutboxDebt,
} from "./outbox";
import { captureException } from "./sentry";

type Db = ReturnType<typeof drizzle>;

const HOUR_SECONDS = 3600;

/**
 * D5's email for one morning. The oldest wait is in whole hours, as
 * Today's "Oldest · 19h" counts it.
 */
export function digestTemplate(
  counts: TodayCounts,
  now: number,
): Extract<EmailTemplate, { kind: "digest" }> {
  return {
    kind: "digest",
    day: dayLabel(now),
    waiting: counts.waiting,
    oldestHours:
      counts.oldestWaitingAt === undefined
        ? undefined
        : Math.floor((now - counts.oldestWaitingAt) / HOUR_SECONDS),
    screenerUnfinished: counts.screenerUnfinished,
    bansThisWeek: counts.bansThisWeek,
    gaveUp: counts.gaveUp,
  };
}

export interface DigestMail {
  readonly admins: () => readonly string[];
  readonly counts: () => Promise<TodayCounts>;
  /**
   * Matches `OwedMail["settle"]` (`modules/account/verification.ts`) rather
   * than `typeof settleOutbox` itself: the digest never passes `handlers`,
   * and the shared test double (`test/email/helpers.ts`'s `owedTo`) is
   * built to that narrower shape so both callers can hand it the same
   * `owed.settle`.
   */
  readonly settle: (
    db: Db,
    debt: OutboxDebt,
    report: typeof captureException,
  ) => Promise<void>;
}

const LIVE: DigestMail = {
  admins: adminUserIds,
  counts: todayCounts,
  settle: settleOutbox,
};

/**
 * Whether this UTC day's digest was already owed — by a firing that ran
 * before this one today, whose emails may long since have been sent and
 * their outbox rows deleted.
 */
async function isOwedToday(db: Db, now: number): Promise<boolean> {
  const last = await markedAt(db, DIGEST_OWED);
  return last !== undefined && calendarDay(last) === calendarDay(now);
}

/**
 * Which of `userIds` have a confirmed address, by primary key. The send
 * looks the address up again (`modules/email`), so this decides only who
 * is owed one.
 */
async function confirmedOf(
  db: Db,
  userIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const ids = await columnWhere(
    db,
    user,
    user.id,
    and(inArray(user.id, [...userIds]), eq(user.emailVerified, true)),
  );
  return new Set(ids);
}

/**
 * Owe each operator with a confirmed address this morning's digest, in
 * one batch, then send it by the fast path; the drain retries a send that
 * fails.
 *
 * **Only to a confirmed address** (OPS-11). The digest tells its reader
 * what is waiting at the Desk, and an address nobody has proved is the
 * operator's may be somebody else's. An operator skipped for that is
 * recorded on the Desk instead (`DIGEST_UNCONFIRMED`, in the same batch),
 * which is where they will look when the email does not come.
 *
 * **Once a day, however often the firing runs.** The outbox's key (the
 * day and the operator) collapses two firings that overlap, but the fast
 * path deletes the row the moment the send lands (`settleOutbox`), so a
 * firing re-run an hour later found no row and mailed every operator
 * again (review of PR #130). The day's mark outlives the row: it is
 * written in the same batch as the debts, so a digest is marked owed
 * exactly when it is, and a later firing that reads it owes nothing.
 */
export async function oweDigestEmail(
  db: Db,
  mail: DigestMail = LIVE,
  now = nowSeconds(),
): Promise<void> {
  if (await isOwedToday(db, now)) return;
  const admins = mail.admins();
  // No operator, nothing to mark: one added later that day is still owed.
  if (admins.length === 0) return;
  const confirmed = await confirmedOf(db, admins);
  const template = digestTemplate(await mail.counts(), now);
  const debts = admins
    .filter((userId) => confirmed.has(userId))
    .map((userId) =>
      oweOutbox(
        emailDebt(
          { to: { userId }, template },
          { dedupeKey: `digest:${template.day}:${userId}` },
        ),
      ),
    );
  const hasSkipped = debts.length < admins.length;
  await db.batch([
    markStatement(db, DIGEST_OWED, now),
    ...(hasSkipped ? [markStatement(db, DIGEST_UNCONFIRMED, now)] : []),
    ...debts.map((debt) => outboxInsert(db, debt, now)),
  ]);
  for (const debt of debts) await mail.settle(db, debt, captureException);
}
