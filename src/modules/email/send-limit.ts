/**
 * "That's 5 links this hour. You can send another at {time}." (round 26
 * #11) — the limit on how often one address is sent one kind of link.
 *
 * Counted per address whatever the address is: see `email_send_limits`
 * for why an unknown address is counted too.
 */
import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { emailSendLimits } from "../../db/schema-core";
import { EMAIL_SENDS_PER_HOUR } from "../../lib/email";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

export const SENDS_PER_WINDOW = EMAIL_SENDS_PER_HOUR;
export const SEND_WINDOW_S = 60 * 60;

/**
 * The link emails a runner can ask for again, each limited on its own: a
 * runner who has used up their confirm links can still reset a password.
 */
export type LimitedSend = "verify" | "reset" | "change";

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
 * Count one send, and say whether it may go.
 *
 * **One statement**, so two requests at once cannot both read four and
 * both send a sixth: the upsert decides the window and the count from the
 * row as it is when it lands. A window an hour old starts over at one.
 * The count keeps climbing past the limit, which changes nothing — a
 * refused send is still refused until the window ends.
 */
export async function claimEmailSend(
  db: Db,
  kind: LimitedSend,
  address: string,
  now = nowSeconds(),
): Promise<SendClaim> {
  const windowOver = sql`${emailSendLimits.windowStartedAt} <= ${now - SEND_WINDOW_S}`;
  const rows = await db
    .insert(emailSendLimits)
    .values({
      key: `${kind}:${address.toLowerCase()}`,
      windowStartedAt: now,
      sends: 1,
    })
    .onConflictDoUpdate({
      target: emailSendLimits.key,
      set: {
        windowStartedAt: sql`CASE WHEN ${windowOver} THEN ${now} ELSE ${emailSendLimits.windowStartedAt} END`,
        sends: sql`CASE WHEN ${windowOver} THEN 1 ELSE ${emailSendLimits.sends} + 1 END`,
      },
    })
    .returning({
      windowStartedAt: emailSendLimits.windowStartedAt,
      sends: emailSendLimits.sends,
    });
  // An upsert returns exactly its one row.
  const over = rows.find((row) => row.sends > SENDS_PER_WINDOW);
  return over === undefined
    ? { isAllowed: true }
    : { isAllowed: false, until: over.windowStartedAt + SEND_WINDOW_S };
}
