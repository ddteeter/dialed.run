/**
 * "That's 5 links this hour. You can send another at {time}." (round 26
 * #11) — the limit on how often one address is sent one kind of link.
 *
 * Counted per address whatever the address is: see `email_send_limits`
 * for why an unknown address is counted too.
 */
import { inArray, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { emailSendLimits } from "../../db/schema-core";
import { EMAIL_SENDS_PER_HOUR } from "../../lib/contracts/email";
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
 * The link emails a runner can ask for again, each limited on its own: a
 * runner who has used up their confirm links can still reset a password.
 *
 * `access` is Au5's request (ACC-5), which sends no email: it borrows the
 * same hourly window keyed by the visitor's address rather than an email
 * one, so a script cannot fill Desk D7 (the key is `access:{ip}`).
 * `takedown` is `/takedown`'s request (design 136), counted the same way
 * and for the same reason: it is a form anyone can fill.
 */
export type LimitedSend = "verify" | "reset" | "change" | "access" | "takedown";

/**
The sends counted by email address; `access` is counted by IP.
*/
const ADDRESS_SENDS = [
  "verify",
  "reset",
  "change",
] as const satisfies readonly LimitedSend[];

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
The limiter's row for one kind of send to one address.
*/
function sendLimitKey(kind: LimitedSend, address: string): string {
  return `${kind}:${address.toLowerCase()}`;
}

/**
 * Forget an address's counters (ACC-9): a deleted account's address is
 * not kept, even as a key in an hour's count. One statement, for the
 * purge's batch; each key is a primary-key probe.
 */
export function forgetSendLimits(
  db: ReturnType<typeof drizzle>,
  address: string,
) {
  return db.delete(emailSendLimits).where(
    inArray(
      emailSendLimits.key,
      ADDRESS_SENDS.map((kind) => sendLimitKey(kind, address)),
    ),
  );
}

/**
 * How long a count is kept after its window ends: a day, then the daily
 * sweep deletes it (`sweepSendLimits`).
 */
const SEND_LIMIT_KEPT_S = 24 * 60 * 60;

/**
 * Delete the counts whose window ended more than a day ago — keys that
 * are an email address or a visitor's IP, kept for nothing once the hour
 * is over.
 *
 * **Nothing reads such a row but to start it over.** Every write is
 * `countSend`'s upsert, whose `windowedCountSet` restarts a window an hour
 * old at one — exactly the row an insert makes once this one is gone.
 * `sendAllowed` reads the row `countSend` just wrote in the same batch,
 * never an old one; `forgetSendLimits` only deletes. So the sweep cannot
 * change a verdict, and the day's margin is there only so a row is never
 * deleted near the moment it could still count.
 *
 * Re-runnable (law 1): a second pass finds nothing past the cutoff. Reads
 * through `email_send_limits_window`, not a scan.
 */
export async function sweepSendLimits(
  db: Db,
  now = nowSeconds(),
): Promise<void> {
  const cutoff = now - SEND_WINDOW_S - SEND_LIMIT_KEPT_S;
  await db
    .delete(emailSendLimits)
    .where(lt(emailSendLimits.windowStartedAt, cutoff));
}

/**
 * Count one send — the statement, unsent, so a caller can put it in a
 * `db.batch()` with the write it allows (`sendAllowed` reads the verdict
 * inside the same batch). `sendClaimOf` reads its answer.
 *
 * **One statement** (`windowedCountSet`), so two requests at once cannot
 * both read four and both send a sixth. A window an hour old starts over
 * at one. The count keeps climbing past the limit, which changes nothing — a
 * refused send is still refused until the window ends.
 */
export function countSend(
  db: Db,
  kind: LimitedSend,
  address: string,
  now = nowSeconds(),
) {
  const next = windowedCountSet(
    {
      startedAt: emailSendLimits.windowStartedAt,
      count: emailSendLimits.sends,
    },
    now,
    SEND_WINDOW_S,
  );
  return db
    .insert(emailSendLimits)
    .values({
      key: sendLimitKey(kind, address),
      windowStartedAt: now,
      sends: 1,
    })
    .onConflictDoUpdate({
      target: emailSendLimits.key,
      set: { windowStartedAt: next.startedAt, sends: next.count },
    })
    .returning({
      startedAt: emailSendLimits.windowStartedAt,
      count: emailSendLimits.sends,
    });
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
export function sendAllowed(kind: LimitedSend, address: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${emailSendLimits} WHERE ${emailSendLimits.key} = ${sendLimitKey(kind, address)} AND ${windowedCountWithin(emailSendLimits.sends, SENDS_PER_WINDOW)})`;
}

/**
Count one send, and say whether it may go.
*/
export async function claimEmailSend(
  db: Db,
  kind: LimitedSend,
  address: string,
  now = nowSeconds(),
): Promise<SendClaim> {
  return sendClaimOf(await countSend(db, kind, address, now));
}
