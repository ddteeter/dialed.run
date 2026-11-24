/**
 * The daily sweep of auth rows kept past any use: expired sessions, tries
 * at the current password whose window is long over, and Better Auth's
 * rate-limit counts (SA-M36).
 *
 * Run by the daily firing: the dispatch imports it through this
 * sub-module's door, because `auth/index.ts` pulls the framework and no
 * test could import the dispatch through it (design 253).
 */
import { inArray, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { rateLimit, session, verification } from "../../../db/schema-auth";
import { passwordAttempts } from "../../../db/schema-core";
import { coreDb } from "../../../env";
import { nowSeconds } from "../../../lib/now";
import { deleteInBatches } from "../../../lib/sql/batched-delete";
import { PASSWORD_ATTEMPT_WINDOW_S } from "../password-check";

type Db = ReturnType<typeof drizzle>;

const DAY_S = 24 * 60 * 60;

/**
 * How long an expired session row is kept before the sweep deletes it.
 *
 * **Nothing can use the row once it has expired.** Better Auth 1.7.2's
 * `getSession` refuses a session whose `expiresAt` has passed, clears the
 * cookie and deletes the row (`better-auth/dist/api/routes/session.mjs`,
 * `session.session.expiresAt < new Date()`), before any refresh could
 * extend it; `listSessions` filters expired rows out; and this app
 * configures no cookie cache or secondary storage that could hold a copy.
 * The app's own code only ever deletes session rows (bans, deletion,
 * email change, purge). Better Auth deletes one only when someone
 * presents it, so a session nobody comes back to stays for good — which
 * is what this sweep is for.
 *
 * So any margin is safe. Thirty days is the one the owner set when the
 * sweep was approved, and nothing in the code argues for another; what it
 * bounds is how long an IP address and a browser outlive the session that
 * recorded them (the privacy policy's "Session records" row).
 */
const SESSION_KEPT_S = 30 * DAY_S;

/**
 * How long a password-try count is kept after its window ends.
 *
 * `checkOwnPassword`'s upsert (`windowedCountSet`) restarts any window
 * fifteen minutes old at one, which is exactly the row an insert makes
 * once this one is gone, and a right answer deletes it outright; nothing
 * else reads the table. So the sweep cannot change a verdict, and a day is
 * margin only.
 */
const ATTEMPTS_KEPT_S = DAY_S;

/**
 * How long a Better Auth rate-limit count is kept after its last request.
 *
 * Its longest window is a minute (`createAuth`'s `rateLimit`, and Better
 * Auth's own rules), and a count past its window is reset to one by the
 * next request, which is the row an insert makes once this one is gone.
 * So the sweep cannot change a verdict, and a day is margin only. Better
 * Auth prunes these itself only when a lapsed count is used again, which
 * a visitor who never comes back never does.
 */
const RATE_LIMIT_KEPT_S = DAY_S;

/**
 * Delete expired sessions past their thirty days and password-try counts
 * a day past their window, in one batch: one policy, so a failure leaves
 * both for tomorrow rather than part. Re-runnable (law 1): a second pass
 * finds nothing past either cutoff. Each reads through its own index
 * (`session_expires_at`, `password_attempts_window`), not a scan. Better
 * Auth's own counts are `sweepExpiredCounts`'s.
 */
export async function sweepExpiredAuthRows(
  db: Db = coreDb(),
  now = nowSeconds(),
): Promise<void> {
  // `expires_at` is a timestamp column: drizzle stores the Date in seconds.
  const sessionsBefore = new Date((now - SESSION_KEPT_S) * 1000);
  const attemptsBefore = now - PASSWORD_ATTEMPT_WINDOW_S - ATTEMPTS_KEPT_S;
  await db.batch([
    db.delete(session).where(lt(session.expiresAt, sessionsBefore)),
    db
      .delete(passwordAttempts)
      .where(lt(passwordAttempts.windowStartedAt, attemptsBefore)),
  ]);
}

/**
 * The most statements one `sweepExpiredCounts` call sends. A backlog
 * larger than this is worked down over later firings.
 */
export const COUNT_SWEEP_PASSES = 20;

/**
 * Delete Better Auth's rate-limit counts a day past their last request,
 * through `rate_limit_last_request`. Run on every hourly firing.
 *
 * **In batches of `batch`** by id, one statement each, until a statement
 * deletes fewer, and at most `passes` statements a call, so one call
 * always ends inside D1's time for a query. Re-runnable (law 1).
 */
export async function sweepExpiredCounts(
  db: Db = coreDb(),
  now = nowSeconds(),
  batch = STATE_SWEEP_BATCH,
  passes = COUNT_SWEEP_PASSES,
): Promise<void> {
  // `last_request` is epoch milliseconds, as Better Auth writes it.
  const spent = lt(rateLimit.lastRequest, (now - RATE_LIMIT_KEPT_S) * 1000);
  await deleteMatching(db, rateLimit, rateLimit.id, spent, batch, passes);
}

/**
 * Delete the rows of `table` matching `where`, `batch` at a time picked by
 * `id`, one statement each, for at most `passes` statements.
 */
async function deleteMatching(
  db: Db,
  table: SQLiteTable,
  id: SQLiteColumn,
  where: SQL,
  batch: number,
  passes: number,
): Promise<void> {
  await deleteInBatches(
    async () => {
      const some = db.select({ id }).from(table).where(where).limit(batch);
      const result = await db.delete(table).where(inArray(id, some));
      return result.meta.changes;
    },
    batch,
    passes,
  );
}

/**
 * The most expired `verification` rows one statement deletes. Each
 * statement stays short however many rows a burst of presses left, well
 * inside D1's limit on one query's time.
 */
export const STATE_SWEEP_BATCH = 10_000;

/**
 * Delete Better Auth's `verification` rows whose expiry has passed: a
 * Google press's state (ten minutes) and a reset link (an hour). Run on
 * every hourly firing (owner, 2026-11-21), so at most about an hour of
 * expired rows is ever kept.
 *
 * **An expired row is dead**, so no margin is kept: Better Auth refuses a
 * state or reset whose `expiresAt` has passed, and deletes expired rows
 * itself whenever it looks one up. The app's own writes to the table are
 * deletes only. Re-runnable (law 1).
 *
 * **In batches of `batch`**, one statement each, until a statement finds
 * fewer: the cutoff is fixed for the run, so rows that expire meanwhile
 * wait for the next firing and the run always ends.
 */
export async function sweepExpiredStates(
  db: Db = coreDb(),
  now = nowSeconds(),
  batch = STATE_SWEEP_BATCH,
): Promise<void> {
  // `expires_at` is a timestamp column: drizzle stores the Date in seconds.
  const expired = lt(verification.expiresAt, new Date(now * 1000));
  await deleteMatching(
    db,
    verification,
    verification.id,
    expired,
    batch,
    Infinity,
  );
}
