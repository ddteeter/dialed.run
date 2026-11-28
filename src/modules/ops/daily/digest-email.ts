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

import { user } from "../../../db/schema-auth";
import { dayLabel } from "../../../lib/dates";
import type { EmailTemplate } from "../../../lib/contracts/email";
import { guarded, runGuarded } from "../../../lib/sql/batch-guard";
import { columnWhere } from "../../../lib/sql/keyed-read";
import { nowSeconds } from "../../../lib/now";
import { operatorEmailMessage } from "../../../lib/sql/outbox";
import { adminUserIds } from "../../safety/rules";
import {
  claimDayStatement,
  DIGEST_OWED,
  DIGEST_UNCONFIRMED,
  markStatement,
  todayCounts,
  type TodayCounts,
} from "../desk";
import { outboxInsert, oweOutbox, type OutboxDebtOf } from "../outbox";
import { settleOwedEmail } from "../owed-email";
import { captureException } from "../sentry";

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
    outboxBehind: counts.outboxBehind,
  };
}

export interface DigestMail {
  readonly admins: () => readonly string[];
  readonly counts: () => Promise<TodayCounts>;
  /**
   * The digest email's fast path, `settleOwedEmail` live. An operator's
   * mail (design 232), so its row is `operator_email`: drained ahead of a
   * runner's email, and never closed for the sender's refusals.
   */
  readonly settle: (
    db: Db,
    debt: OutboxDebtOf<"operator_email">,
    report: typeof captureException,
  ) => Promise<void>;
}

const LIVE: DigestMail = {
  admins: adminUserIds,
  counts: todayCounts,
  settle: settleOwedEmail,
};

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
 * exactly when it is, and it is a claim on the day, guarded in the
 * batch: a later firing, or one that overlaps, finds the day claimed and
 * writes and sends nothing.
 */
export async function oweDigestEmail(
  db: Db,
  mail: DigestMail = LIVE,
  now = nowSeconds(),
): Promise<void> {
  const admins = mail.admins();
  // No operator, nothing to mark: one added later that day is still owed.
  if (admins.length === 0) return;
  const confirmed = await confirmedOf(db, admins);
  const template = digestTemplate(await mail.counts(), now);
  const debts = admins
    .filter((userId) => confirmed.has(userId))
    .map((userId) =>
      oweOutbox(
        operatorEmailMessage(
          { to: { userId }, template },
          `digest:${template.day}:${userId}`,
        ),
      ),
    );
  const hasSkipped = debts.length < admins.length;
  // The day is claimed in the batch (#1092): two firings that overlap both
  // read "not owed today", and one whose sends had settled before the
  // other's batch landed would mail every operator twice, the outbox's
  // key having nothing left to collapse. The losing claim writes nothing
  // and sends nothing.
  const outcome = await runGuarded(db, [
    ...guarded(db, claimDayStatement(db, DIGEST_OWED, now), "digest-day"),
    ...(hasSkipped ? [markStatement(db, DIGEST_UNCONFIRMED, now)] : []),
    ...debts.map((debt) => outboxInsert(db, debt, now)),
  ]);
  if (!outcome.ok) return;
  for (const debt of debts) await mail.settle(db, debt, captureException);
}
