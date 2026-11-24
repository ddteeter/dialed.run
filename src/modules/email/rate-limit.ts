/**
 * The fixed-window counts in `rate_limits`: how often one address is sent
 * one kind of link ("That's 5 links this hour. You can send another at
 * {time}.", round 26 #11), how often a visitor fills a public form, and
 * the counts that are not sends (a runner's email changes, enrichment's
 * spend; design 221; email sign-in's tries per address).
 *
 * A send is counted per address whatever the address is: see
 * `rate_limits` for why an unknown address is counted too.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { rateLimits } from "../../db/schema-core";
import { SIGN_IN_TRIES, SIGN_IN_WINDOW_S } from "../../lib/contracts/access";
import { EMAIL_SENDS_PER_HOUR } from "../../lib/contracts/email";
import { VISITOR_KINDS } from "../../lib/contracts/rate-limits";
import type {
  RateLimitKind,
  SendLimitKind,
} from "../../lib/contracts/rate-limits";
import { nowSeconds } from "../../lib/now";
import { PHOTO_UPLOADS_PER_DAY } from "../../lib/photo-constraints";
import { visitorAddress } from "../../lib/visitor-address";
import { deleteInBatches } from "../../lib/sql/batched-delete";
import {
  windowedCountSet,
  windowedCountUntil,
  windowedCountWithin,
} from "../../lib/sql/window-count";

type Db = ReturnType<typeof drizzle>;

export const SENDS_PER_WINDOW = EMAIL_SENDS_PER_HOUR;
export const SEND_WINDOW_S = 60 * 60;

/**
 * The counts kept by email address: the three sends, sign-in's tries,
 * `/takedown`'s receipts, and Au5's confirm links and confirmed asks per
 * address. `access`, `takedown` and `resend-visitor` are counted by IP.
 */
const ADDRESS_COUNTS = [
  "verify",
  "reset",
  "change",
  "sign-in",
  "takedown-to",
  "access-to",
  "access-confirm-to",
] as const satisfies readonly RateLimitKind[];

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

const visitorKinds: ReadonlySet<RateLimitKind> = new Set(VISITOR_KINDS);

/**
 * The key a count is kept under: a visitor's IP by its network
 * (`visitorAddress`, SA-M11), any other subject as given.
 */
function keyOf(kind: RateLimitKind, subject: string): string {
  return visitorKinds.has(kind) ? visitorAddress(subject) : subject;
}

/**
 * Forget an address's counters (ACC-9): a deleted account's address is
 * not kept, even as the subject of an hour's count. One statement, for
 * the purge's batch; each kind is a primary-key probe.
 */
export function forgetSendLimits(db: Db, address: string) {
  const addressKinds = inArray(rateLimits.kind, [...ADDRESS_COUNTS]);
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
 * How long a count is kept after its window ends: a day, then the hourly
 * sweep deletes it (`sweepRateLimits`).
 */
const RATE_LIMIT_KEPT_S = 24 * 60 * 60;

/**
 * How long a `sign-in` or `verify` count is kept after its window ends:
 * fifteen minutes. Every other kind keeps the day.
 */
export const SHORT_KEPT_S = 15 * 60;

/**
The most counts one statement of the sweep deletes.
*/
export const RATE_LIMIT_SWEEP_BATCH = 10_000;

/**
 * The most statements one sweep sends, across its rules: with
 * `RATE_LIMIT_SWEEP_BATCH`, up to a million counts an hourly firing. A
 * backlog larger than this is worked down over later firings. A number the
 * owner can retune.
 */
export const RATE_LIMIT_SWEEP_PASSES = 100;

/**
 * What the sweep deletes, one condition a rule, each served by an index:
 * any count whose window started more than an hour and a day ago, a
 * `sign-in` count once its window and `SHORT_KEPT_S` are past, and a
 * `verify` count once its hour and `SHORT_KEPT_S` are past.
 */
export function rateLimitSweepRules(now: number): readonly SQL[] {
  const ofKindBefore = (kind: RateLimitKind, cutoff: number) =>
    sql`${rateLimits.kind} = ${kind} and ${rateLimits.windowStartedAt} < ${cutoff}`;
  return [
    lt(rateLimits.windowStartedAt, now - SEND_WINDOW_S - RATE_LIMIT_KEPT_S),
    ofKindBefore("sign-in", now - SIGN_IN_WINDOW_S - SHORT_KEPT_S),
    ofKindBefore("verify", now - SEND_WINDOW_S - SHORT_KEPT_S),
  ];
}

/**
 * Delete the counts `rateLimitSweepRules` names, kept for nothing once
 * their window is over.
 *
 * **Nothing reads such a row but to start it over.** Every write is
 * `countRate`'s upsert, whose `windowedCountSet` restarts an ended window
 * at one — exactly the row an insert makes once this one is gone.
 * `limitAllowed` reads the row its count just wrote in the same batch,
 * never an old one; the forgets only delete. So the sweep cannot change a
 * verdict, and the margin is there only so a row is never deleted near
 * the moment it could still count.
 *
 * **In batches of `batch`**, by `rowid` (the table has no id column), one
 * statement each, until a statement deletes fewer, and at most `passes`
 * statements a call across every rule, so one call always ends inside
 * D1's time for a query and a backlog is worked down over firings.
 *
 * Re-runnable (law 1): a second pass finds nothing past the cutoff.
 */
export async function sweepRateLimits(
  db: Db,
  now = nowSeconds(),
  batch = RATE_LIMIT_SWEEP_BATCH,
  passes = RATE_LIMIT_SWEEP_PASSES,
): Promise<void> {
  let sent = 0;
  for (const rule of rateLimitSweepRules(now)) {
    sent += await deleteInBatches(
      async () => {
        const some = db
          .select({ rowid: sql`rowid` })
          .from(rateLimits)
          .where(rule)
          .limit(batch);
        const result = await db
          .delete(rateLimits)
          .where(inArray(sql`rowid`, some));
        return result.meta.changes;
      },
      batch,
      passes - sent,
    );
  }
}

/**
 * Count one send — the statement, unsent, so a caller can put it in a
 * `db.batch()` with the write it allows. `sendClaimOf` reads its
 * answer.
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
  const key = keyOf(kind, subject);
  const next = windowedCountSet(
    { startedAt: rateLimits.windowStartedAt, count: rateLimits.count },
    now,
    windowS,
  );
  return db
    .insert(rateLimits)
    .values({ kind, subject: key, windowStartedAt: now, count: 1 })
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

type CountRows = readonly Readonly<{ startedAt: number; count: number }>[];

function claimOf(rows: CountRows, limit: number, windowS: number): SendClaim {
  const until = windowedCountUntil(rows, limit, windowS);
  return until === undefined
    ? { isAllowed: true }
    : { isAllowed: false, until };
}

/**
 * Count one of any kind, and say whether it is within `limit` and, when it
 * is not, when the window ends: for a refusal the runner or visitor is
 * told about ("You can try again at {time}").
 */
export async function claimRateLimit(
  db: Db,
  kind: RateLimitKind,
  subject: string,
  limit: number,
  windowS: number,
  now = nowSeconds(),
): Promise<SendClaim> {
  return claimOf(
    await countRate(db, kind, subject, windowS, now),
    limit,
    windowS,
  );
}

/**
What `countSend` returned, as the answer.
*/
export function sendClaimOf(rows: CountRows): SendClaim {
  return claimOf(rows, SENDS_PER_WINDOW, SEND_WINDOW_S);
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

/**
 * Count one email sign-in for the typed address, and say whether it may
 * be tried: `SIGN_IN_TRIES` in `SIGN_IN_WINDOW_S`, the address lowercased
 * as Better Auth looks it up.
 */
export async function claimSignInTry(
  db: Db,
  address: string,
  now = nowSeconds(),
): Promise<SendClaim> {
  return claimRateLimit(
    db,
    "sign-in",
    sendSubject(address),
    SIGN_IN_TRIES,
    SIGN_IN_WINDOW_S,
    now,
  );
}

/**
 * How many times one visitor may press Resend in an hour, whatever
 * addresses they name (SA-M12; owner, 2026-11-16).
 */
export const RESENDS_PER_VISITOR_PER_HOUR = 10;

/**
 * How many `/takedown` receipts one address may be sent in an hour,
 * whoever files the requests (SA-M11; owner, 2026-11-16).
 */
export const TAKEDOWN_RECEIPTS_PER_HOUR = 5;

/**
 * How many "delete scheduled" emails one runner may be owed in a day;
 * past it a deletion is still scheduled, with no email (owner,
 * 2026-11-21).
 */
export const DELETION_NOTICES_PER_DAY = 3;

/**
 * How many confirmed asks one address's access request takes in a day;
 * past it a confirm changes nothing and answers the same receipt (owner,
 * 2026-11-21).
 */
export const ACCESS_ASKS_PER_ADDRESS_PER_DAY = 3;

/**
 * How many confirm links Au5's asks may send one address in a day,
 * whoever asks: the same three a day the address's confirmed asks take.
 * Past it the ask writes nothing, sends nothing, and answers the same.
 */
export const ACCESS_CONFIRMS_PER_ADDRESS_PER_DAY =
  ACCESS_ASKS_PER_ADDRESS_PER_DAY;

/**
 * How many Google sign-ins may start in an hour, across everyone; past it
 * Continue with Google is refused before Better Auth writes its state row
 * (owner, 2026-11-21).
 */
export const GOOGLE_STARTS_PER_HOUR = 500;

/**
 * How many new shared brand or product rows one runner's saves may make
 * in a day, one count a row; past it a garment saves with what was typed
 * and no shared row (owner, 2026-11-23; a number the owner can retune).
 */
export const NEW_SHARED_ROWS_PER_RUNNER_PER_DAY = 50;

const DAY_S = 24 * 60 * 60;

/**
 * The counts a caller claims by kind alone, each with its limit and its
 * window: Resend per visitor (its IP), a runner's photo uploads (their
 * id), `/takedown`'s receipts per address (lowercased, as the request
 * is), a runner's "delete scheduled" emails (their id), Au5's
 * confirmed asks and confirm links per address (lowercased), the
 * Google sign-ins started across everyone (`GLOBAL_SUBJECT`), and the
 * shared brand and product rows a runner's saves make (their id).
 */
const LIMIT_OF = {
  "resend-visitor": {
    limit: RESENDS_PER_VISITOR_PER_HOUR,
    windowS: SEND_WINDOW_S,
  },
  "photo-runner": { limit: PHOTO_UPLOADS_PER_DAY, windowS: DAY_S },
  "takedown-to": { limit: TAKEDOWN_RECEIPTS_PER_HOUR, windowS: SEND_WINDOW_S },
  "deletion-notice": { limit: DELETION_NOTICES_PER_DAY, windowS: DAY_S },
  "access-to": { limit: ACCESS_ASKS_PER_ADDRESS_PER_DAY, windowS: DAY_S },
  "access-confirm-to": {
    limit: ACCESS_CONFIRMS_PER_ADDRESS_PER_DAY,
    windowS: DAY_S,
  },
  "google-start": { limit: GOOGLE_STARTS_PER_HOUR, windowS: SEND_WINDOW_S },
  "shared-row-runner": {
    limit: NEW_SHARED_ROWS_PER_RUNNER_PER_DAY,
    windowS: DAY_S,
  },
} as const satisfies Partial<
  Record<RateLimitKind, Readonly<{ limit: number; windowS: number }>>
>;

export type LimitedKind = keyof typeof LIMIT_OF;

/**
Count one of `kind` for `subject`, and say whether it may go.
*/
export async function claimLimit(
  db: Db,
  kind: LimitedKind,
  subject: string,
  now = nowSeconds(),
): Promise<SendClaim> {
  const { limit, windowS } = LIMIT_OF[kind];
  return claimRateLimit(db, kind, subject, limit, windowS, now);
}

/**
 * Count one of `kind` for `subject` — the statement, unsent, for a
 * `db.batch()` with the write it allows (`limitAllowed`); `limitClaimOf`
 * reads its answer.
 */
export function countLimit(
  db: Db,
  kind: LimitedKind,
  subject: string,
  now = nowSeconds(),
) {
  return countRate(db, kind, subject, LIMIT_OF[kind].windowS, now);
}

/**
What `countLimit` returned, as the answer.
*/
export function limitClaimOf(kind: LimitedKind, rows: CountRows): SendClaim {
  const { limit, windowS } = LIMIT_OF[kind];
  return claimOf(rows, limit, windowS);
}

/**
 * `limitClaimOf`'s verdict as SQL, for a write in the batch after
 * `countLimit`: true while the count it just made is within the limit.
 */
export function limitAllowed(kind: LimitedKind, subject: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${rateLimits} WHERE ${rateLimits.kind} = ${kind} AND ${rateLimits.subject} = ${keyOf(kind, subject)} AND ${windowedCountWithin(rateLimits.count, LIMIT_OF[kind].limit)})`;
}

/**
A sign-in that worked: the address's tries start again from none.
*/
export function forgetSignInTries(db: Db, address: string) {
  return forgetRateLimit(db, "sign-in", sendSubject(address));
}
