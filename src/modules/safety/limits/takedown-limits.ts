/**
 * `/takedown`'s abuse limits (design 137; owner, 2026-10-10): what a new
 * request is allowed to do, decided by the request's own insert from
 * three counts it makes as it is written.
 *
 * - **Blocked** — either of the requester's keys is in `takedown_blocks`.
 *   Recorded, with the ordinary receipt, and nothing more: no hide, no
 *   alert. The requester learns nothing from it.
 * - **Valve** — `TAKEDOWN_VALVE_PER_HOUR` requests have hidden something
 *   in the last hour, site-wide. Recorded, hiding nothing and alerting
 *   no one per request; the operators get one alert per hour instead.
 * - **Confirm** — this requester (either key) already has
 *   `TAKEDOWN_CAP` open requests. It waits for the confirm link in the
 *   receipt before it hides anything or alerts anyone.
 * - Otherwise it does what design drew: hides a link of ours at once and
 *   alerts every operator.
 *
 * **Decided as written, not before.** Each limit is SQL in the statement
 * that records the request (or its confirm), and a batch is one
 * transaction run after the one before it, so requests sent together are
 * counted one after another: the eleventh sees the ten before it.
 *
 * **Alerts have their own allowance.** A request that newly hid nothing —
 * a link that is not ours, one naming nothing a hold could move, or one
 * holding a subject already out of public view — alerts every operator
 * one by one only while fewer than `TAKEDOWN_ALERTS_PER_HOUR` such alerts
 * went out in the hour, site-wide; past that it owes the valve's hourly
 * alert, and one that holds its subject still holds it. Such requests
 * never count toward the valve, which counts hides.
 */
import { and, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";

import {
  entryPhotos,
  takedownBlocks,
  takedownRequests,
} from "../../../db/schema-core";
import type { TakedownSubject } from "../../../lib/contracts/takedown";
import { qualified } from "../../../lib/sql/qualified";

/**
Open requests one requester may have before a new one waits for a confirm.
*/
export const TAKEDOWN_CAP = 2;

/**
Hides in an hour, site-wide, past which new requests hide nothing.
*/
export const TAKEDOWN_VALVE_PER_HOUR = 10;

/**
 * One-by-one alerts in an hour, site-wide, for requests that hid nothing:
 * the valve's own number (owner, 2026-11-21), which is the one its
 * hourly alert names.
 */
const TAKEDOWN_ALERTS_PER_HOUR = TAKEDOWN_VALVE_PER_HOUR;

const HOUR_S = 60 * 60;

export type HoldState = "held" | "confirm" | "valve" | "blocked";

/**
 * Who asked, as the limits read them: the email key always, the IP key
 * when `TAKEDOWN_SECRET` is set.
 */
export interface RequesterKeys {
  readonly requesterKey: string;
  readonly ipKey: string | undefined;
}

function keysOf(keys: RequesterKeys): string[] {
  return keys.ipKey === undefined
    ? [keys.requesterKey]
    : [keys.requesterKey, keys.ipKey];
}

/**
A requester's rows, by either key.
*/
export function requesterMatches(keys: RequesterKeys) {
  return keys.ipKey === undefined
    ? eq(takedownRequests.requesterKey, keys.requesterKey)
    : or(
        eq(takedownRequests.requesterKey, keys.requesterKey),
        eq(takedownRequests.ipKey, keys.ipKey),
      );
}

/**
 * What a `count()` answered. It always answers with one row; summing the
 * rows says that without indexing `[0]`, whose fallback no input reaches.
 * A grouped count with no groups answers none, which sums to zero (the
 * hold breakers' baseline, design 164).
 */
export function counted(rows: readonly { n: number }[]): number {
  return rows.reduce((total, row) => total + row.n, 0);
}

/**
 * What a new request from `keys` may do, as the CASE its insert writes to
 * `hold_state`: `held` means it may hide and alert; the caller hides only
 * when its link names something a hold moves.
 */
export function holdStateSql(
  keys: RequesterKeys,
  now: number,
  subject: TakedownSubject | undefined,
): SQL {
  const open = sql`(select count(*) from ${takedownRequests} where ${and(requesterMatches(keys), eq(takedownRequests.status, "pending"))})`;
  return sql`(case when ${blockedSql(keys)} then 'blocked' when ${valveShutSql(now, subject)} then 'valve' when ${open} >= ${TAKEDOWN_CAP} then 'confirm' else 'held' end)`;
}

/**
Whether either of the requester's keys is in `takedown_blocks`, as the statement runs.
*/
export function blockedSql(keys: RequesterKeys): SQL {
  return sql`exists (select 1 from ${takedownBlocks} where ${inArray(takedownBlocks.key, keysOf(keys))})`;
}

/**
 * A removal request that holds its subject: still pending, and it held
 * it at filing or at its confirm (`held_at`). One blocked, unconfirmed or
 * quieted by the valve while its subject was public held nothing, and
 * holds nothing. Read on `takedown_requests` itself.
 */
export function requestHolds(): SQL {
  return sql`(${takedownRequests.status} = 'pending' and ${takedownRequests.heldAt} is not null)`;
}

/**
 * Whether the valve is shut, as this statement runs, for a request naming
 * `subject`: the valve counts kits, the distinct kits that something a
 * request newly hid (`hid_at`, by its index) in the hour before `now` is
 * on, so a kit and its photos take one place between them. It is shut
 * once they are as many as the valve allows, and then only for a request
 * whose subject is on none of them.
 */
export function valveShutSql(
  now: number,
  subject: TakedownSubject | undefined,
): SQL {
  const inHour = gte(takedownRequests.hidAt, now - HOUR_S);
  const kit = hiddenKitOf();
  const places = sql`(select count(distinct ${kit}) from ${takedownRequests} where ${inHour})`;
  const sharesAPlace = sql`exists (select 1 from ${takedownRequests} where ${inHour} and ${kit} = ${subjectKitOf(subject)})`;
  return sql`(${places} >= ${TAKEDOWN_VALVE_PER_HOUR} and not ${sharesAPlace})`;
}

/**
 * The kit a counted request's subject is on: a photo's own kit, read from
 * the photo (a photo gone since takes a place of its own), and a kit
 * itself otherwise.
 */
function hiddenKitOf(): SQL {
  const subjectId = qualified(takedownRequests, takedownRequests.subjectId);
  const subjectType = qualified(takedownRequests, takedownRequests.subjectType);
  return sql`coalesce((select ${qualified(entryPhotos, entryPhotos.entryId)} from ${entryPhotos} where ${subjectType} = 'photo' and ${qualified(entryPhotos, entryPhotos.id)} = ${subjectId}), ${subjectId})`;
}

/**
 * The kit a new request's subject is on, read the same way: a photo's
 * kit from the photo, never the link's word for it. NULL for a link that
 * is not ours, which shares a place with nothing.
 */
function subjectKitOf(subject: TakedownSubject | undefined): SQL {
  return subject === undefined
    ? sql`null`
    : sql`coalesce((select ${entryPhotos.entryId} from ${entryPhotos} where ${subject.subjectType} = 'photo' and ${eq(entryPhotos.id, subject.subjectId)}), ${subject.subjectId})`;
}

/**
 * Whether a request that hid nothing may still alert one by one this
 * hour, by `alerted_at`'s index.
 */
export function alertRoomSql(now: number): SQL {
  return sql`(select count(*) from ${takedownRequests} where ${gte(takedownRequests.alertedAt, now - HOUR_S)}) < ${TAKEDOWN_ALERTS_PER_HOUR}`;
}

/**
The hour a valve alert is about, so one goes per hour however many trip it.
*/
export function valveHour(now: number): number {
  return Math.floor(now / HOUR_S);
}

export { confirmTokenHash, newConfirmToken } from "../../../lib/confirm-token";

/**
 * A pending request holds its subject: one that held it at
 * filing or at its confirm (`held_at`), whether it hid it then or it was
 * already out of public view. A request that was blocked, past the valve
 * or unconfirmed held nothing. True where some such request meets
 * `names`, a condition on `takedown_requests` with its columns
 * `qualified`, so it may be correlated with an outer read: what pins an
 * Approve, and what makes an owner's delete keep (design 232).
 */
export function requestHolds(names: SQL): SQL {
  const pending = sql`${qualified(takedownRequests, takedownRequests.status)} = 'pending'`;
  const held = sql`${qualified(takedownRequests, takedownRequests.heldAt)} is not null`;
  return sql`exists (select 1 from ${takedownRequests} where ${pending} and ${held} and ${names})`;
}
