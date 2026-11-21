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
 * **Alerts have their own allowance.** A request that hid nothing — a
 * link that is not ours, or one naming nothing a hold could move —
 * alerts every operator one by one only while fewer than
 * `TAKEDOWN_ALERTS_PER_HOUR` such alerts went out in the hour, site-wide;
 * past that it owes the valve's hourly alert. Such requests never count
 * toward the valve, which counts hides.
 */
import { and, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";

import { takedownBlocks, takedownRequests } from "../../../db/schema-core";

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
export function holdStateSql(keys: RequesterKeys, now: number): SQL {
  const blocked = sql`exists (select 1 from ${takedownBlocks} where ${inArray(takedownBlocks.key, keysOf(keys))})`;
  const open = sql`(select count(*) from ${takedownRequests} where ${and(requesterMatches(keys), eq(takedownRequests.status, "pending"))})`;
  return sql`(case when ${blocked} then 'blocked' when ${valveShutSql(now)} then 'valve' when ${open} >= ${TAKEDOWN_CAP} then 'confirm' else 'held' end)`;
}

/**
 * Whether the valve is shut as this statement runs: as many requests hid
 * something in the hour before `now` as the valve allows, by `held_at`'s
 * index.
 */
export function valveShutSql(now: number): SQL {
  return sql`(select count(*) from ${takedownRequests} where ${gte(takedownRequests.heldAt, now - HOUR_S)}) >= ${TAKEDOWN_VALVE_PER_HOUR}`;
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

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A confirm link's token and the hash the row keeps: only the hash is
 * stored, so a read of the table cannot confirm anything.
 */
export async function newConfirmToken(): Promise<{
  token: string;
  hash: string;
}> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await confirmTokenHash(token) };
}

export async function confirmTokenHash(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}
