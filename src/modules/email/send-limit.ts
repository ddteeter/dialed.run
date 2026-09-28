/**
 * "That's 5 links this hour. You can send another at {time}." (round 26
 * #11) — the limit on how often one address is sent one kind of link.
 *
 * Counted per address whatever the address is: see `email_send_limits`
 * for why an unknown address is counted too.
 */
import type { drizzle } from "drizzle-orm/d1";

import { emailSendLimits } from "../../db/schema-core";
import { EMAIL_SENDS_PER_HOUR } from "../../lib/email";
import { nowSeconds } from "../../lib/now";
import { windowedCountSet, windowedCountUntil } from "../../lib/window-count";

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
 * **One statement** (`windowedCountSet`), so two requests at once cannot
 * both read four and both send a sixth. A window an hour old starts over
 * at one. The count keeps climbing past the limit, which changes nothing — a
 * refused send is still refused until the window ends.
 */
export async function claimEmailSend(
  db: Db,
  kind: LimitedSend,
  address: string,
  now = nowSeconds(),
): Promise<SendClaim> {
  const next = windowedCountSet(
    {
      startedAt: emailSendLimits.windowStartedAt,
      count: emailSendLimits.sends,
    },
    now,
    SEND_WINDOW_S,
  );
  const rows = await db
    .insert(emailSendLimits)
    .values({
      key: `${kind}:${address.toLowerCase()}`,
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
  const until = windowedCountUntil(rows, SENDS_PER_WINDOW, SEND_WINDOW_S);
  return until === undefined
    ? { isAllowed: true }
    : { isAllowed: false, until };
}
