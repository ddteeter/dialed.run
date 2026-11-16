/**
 * The fixed-window counts in `rate_limits`: how often one address is sent
 * one kind of link ("That's 5 links this hour. You can send another at
 * {time}.", round 26 #11), how often a visitor fills a public form, and
 * the counts that are not sends (a runner's email changes, enrichment's
 * spend; design 221).
 *
 * A send is counted per address whatever the address is: see
 * `rate_limits` for why an unknown address is counted too.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { rateLimits } from "../../db/schema-core";
import { EMAIL_SENDS_PER_HOUR } from "../../lib/contracts/email";
import type {
  RateLimitKind,
  SendLimitKind,
} from "../../lib/contracts/rate-limits";
import { nowSeconds } from "../../lib/now";
import {
  windowedCountSet,
  windowedCountUntil,
  windowedCountWithin,
} from "../../lib/sql/window-count";

type Db = ReturnType<typeof drizzle>;

export const SENDS_PER_WINDOW = EMAIL_SENDS_PER_HOUR;
export const SEND_WINDOW_S = 60 * 60;

/**
The sends counted by email address; `access` and `takedown` are counted by IP.
*/
const ADDRESS_SENDS = [
  "verify",
  "reset",
  "change",
] as const satisfies readonly SendLimitKind[];

export type SendClaim =
  | { readonly isAllowed: true }
  | {
      readonly isAllowed: false;
      /**
      When the next one may go, in epoch seconds.
      */
      readonly until: number;
    };

/**
A send's subject: the address or IP, lowercased, so a case is not a fresh count.
*/
function sendSubject(address: string): string {
  return address.toLowerCase();
}

/**
 * Forget an address's counters (ACC-9): a deleted account's address is
 * not kept, even as the subject of an hour's count. One statement, for
 * the purge's batch; each kind is a primary-key probe.
 */
export function forgetSendLimits(db: Db, address: string) {
  const addressKinds = inArray(rateLimits.kind, [...ADDRESS_SENDS]);
  const ofAddress = eq(rateLimits.subject, sendSubject(address));
  return db.delete(rateLimits).where(and(addressKinds, ofAddress));
}

/**
 * Forget one count, for the purge: a deleted runner's id is not kept as
 * the subject of their change or enrichment count.
 */
export function forgetRateLimit(db: Db, kind: RateLimitKind, subject: string) {
  return db
    .delete(rateLimits)
    .where(and(eq(rateLimits.kind, kind), eq(rateLimits.subject, subject)));
}

/**
 * How long a count is kept after its window ends: a day, then the daily
 * sweep deletes it (`sweepRateLimits`).
 */
const RATE_LIMIT_KEPT_S = 24 * 60 * 60;

/**
 * Delete the counts whose window started more than an hour and a day ago
 * — an address, a visitor's IP or a runner's id, kept for nothing once
 * the window is over. No window is longer than a day, so a day's count is
 * over before the sweep can reach it.
 *
 * **Nothing reads such a row but to start it over.** Every write is
 * `countRate`'s upsert, whose `windowedCountSet` restarts an ended window
 * at one — exactly the row an insert makes once this one is gone.
 * `sendAllowed` reads the row `countSend` just wrote in the same batch,
 * never an old one; the forgets only delete. So the sweep cannot change a
 * verdict, and the margin is there only so a row is never deleted near
 * the moment it could still count.
 *
 * Re-runnable (law 1): a second pass finds nothing past the cutoff. Reads
 * through `rate_limits_window`, not a scan.
 */
export async function sweepRateLimits(
  db: Db,
  now = nowSeconds(),
): Promise<void> {
  const cutoff = now - SEND_WINDOW_S - RATE_LIMIT_KEPT_S;
  await db.delete(rateLimits).where(lt(rateLimits.windowStartedAt, cutoff));
}

/**
 * Count one send — the statement, unsent, so a caller can put it in a
 * `db.batch()` with the write it allows (`sendAllowed` reads the verdict
 * inside the same batch). `sendClaimOf` reads its answer.
 */
export function countSend(
  db: Db,
  kind: SendLimitKind,
  address: string,
  now = nowSeconds(),
) {
  return countRate(db, kind, sendSubject(address), SEND_WINDOW_S, now);
}

/**
 * Count one of any kind, for a window `windowS` long.
 *
 * **One statement** (`windowedCountSet`), so two requests at once cannot
 * both read four and both send a sixth. An ended window starts over at
 * one. The count keeps climbing past the limit, which changes nothing — a
 * refused request is still refused until the window ends.
 */
function countRate(
  db: Db,
  kind: RateLimitKind,
  subject: string,
  windowS: number,
  now: number,
) {
  const next = windowedCountSet(
    { startedAt: rateLimits.windowStartedAt, count: rateLimits.count },
    now,
    windowS,
  );
  return db
    .insert(rateLimits)
    .values({ kind, subject, windowStartedAt: now, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.kind, rateLimits.subject],
      set: { windowStartedAt: next.startedAt, count: next.count },
    })
    .returning({
      startedAt: rateLimits.windowStartedAt,
      count: rateLimits.count,
    });
}

/**
 * Count one, and say whether it is within `limit` for a window up to a
 * day long (enrichment's spend, design 221).
 */
export async function isWithinRateLimit(
  db: Db,
  kind: RateLimitKind,
  subject: string,
  limit: number,
  windowS: number,
  now = nowSeconds(),
): Promise<boolean> {
  const rows = await countRate(db, kind, subject, windowS, now);
  return windowedCountUntil(rows, limit, windowS) === undefined;
}

/**
What `countSend` returned, as the answer.
*/
export function sendClaimOf(
  rows: readonly Readonly<{ startedAt: number; count: number }>[],
): SendClaim {
  const until = windowedCountUntil(rows, SENDS_PER_WINDOW, SEND_WINDOW_S);
  return until === undefined
    ? { isAllowed: true }
    : { isAllowed: false, until };
}

/**
 * The same verdict as SQL, for a write in the batch after `countSend`:
 * true while the count it just made is within the limit
 * (`windowedCountWithin`, the limit `sendClaimOf` applies).
 */
export function sendAllowed(kind: SendLimitKind, address: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${rateLimits} WHERE ${rateLimits.kind} = ${kind} AND ${rateLimits.subject} = ${sendSubject(address)} AND ${windowedCountWithin(rateLimits.count, SENDS_PER_WINDOW)})`;
}

/**
Count one send, and say whether it may go.
*/
export async function claimEmailSend(
  db: Db,
  kind: SendLimitKind,
  address: string,
  now = nowSeconds(),
): Promise<SendClaim> {
  return sendClaimOf(await countSend(db, kind, address, now));
}

/**
 * Count one of a runner's email-change requests, five an hour whatever
 * addresses they name, and say whether it may go.
 */
export async function claimRunnerChange(
  db: Db,
  userId: string,
  now = nowSeconds(),
): Promise<SendClaim> {
  return sendClaimOf(
    await countRate(db, "change-runner", userId, SEND_WINDOW_S, now),
  );
}
