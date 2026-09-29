/**
 * "That's 5 links this hour. You can send another at {time}." (round 26
 * #11) — the limit on how often one address is sent one kind of link.
 *
 * Counted per address whatever the address is: see `email_send_limits`
 * for why an unknown address is counted too.
 */
import { inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { emailSendLimits } from "../../db/schema-core";
import { EMAIL_SENDS_PER_HOUR } from "../../lib/email";
import { nowSeconds } from "../../lib/now";
import {
  windowedCountSet,
  windowedCountUntil,
  windowedCountWithin,
} from "../../lib/window-count";

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
 */
export type LimitedSend = "verify" | "reset" | "change" | "access";

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
