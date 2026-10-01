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
 * To every operator (`ADMIN_USER_IDS`), looked up at send time like any
 * runner, so the address is the one their account holds.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { cronCheckpoints } from "../../db/schema-core";
import { dayLabel } from "../../lib/dates";
import type { EmailTemplate } from "../../lib/contracts/email";
import { firstColumnWhere } from "../../lib/sql/keyed-read";
import { nowSeconds } from "../../lib/now";
import { emailDebt } from "../email";
import { adminUserIds } from "../safety";
import { todayCounts, type TodayCounts } from "./desk";
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
 * The row that says the morning's digest was owed: `cron_checkpoints`'
 * "when did this last run", for the email as the daily firing's own row is
 * for the firing.
 */
const DIGEST_OWED = "digest-email";

const DAY_SECONDS = 86_400;

/**
 * Whether this UTC day's digest was already owed — by a firing that ran
 * before this one today, whose emails may long since have been sent and
 * their outbox rows deleted.
 */
async function isOwedToday(db: Db, now: number): Promise<boolean> {
  const last = await firstColumnWhere(
    db,
    cronCheckpoints,
    cronCheckpoints.lastRunAt,
    eq(cronCheckpoints.cronName, DIGEST_OWED),
  );
  // Never owed reads as owed at the epoch, which is before any day.
  return (last ?? 0) >= now - (now % DAY_SECONDS);
}

/**
 * Owe each operator this morning's digest, in one batch, then send it by
 * the fast path; the drain retries a send that fails.
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
  const template = digestTemplate(await mail.counts(), now);
  const debts = mail
    .admins()
    .map((userId) =>
      oweOutbox(
        emailDebt(
          { to: { userId }, template },
          { dedupeKey: `digest:${template.day}:${userId}` },
        ),
      ),
    );
  const [first, ...rest] = debts.map((debt) => outboxInsert(db, debt, now));
  if (first === undefined) return;
  await db.batch([
    first,
    ...rest,
    db
      .insert(cronCheckpoints)
      .values({ cronName: DIGEST_OWED, lastRunAt: now })
      .onConflictDoUpdate({
        target: cronCheckpoints.cronName,
        set: { lastRunAt: now },
      }),
  ]);
  for (const debt of debts) await mail.settle(db, debt, captureException);
}
