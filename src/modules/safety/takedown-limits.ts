/**
 * `/takedown`'s abuse limits (design 137; owner, 2026-10-10): what a new
 * request is allowed to do, decided before its batch from three reads.
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
 * The reads are not a lock: two requests landing together can both pass
 * a limit at its edge. That costs one request past the cap, which a
 * person reviews within 48 hours anyway.
 */
import { and, count, eq, gte, inArray, or } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { takedownBlocks, takedownRequests } from "../../db/schema-core";

type Db = ReturnType<typeof drizzle>;

/**
Open requests one requester may have before a new one waits for a confirm.
*/
export const TAKEDOWN_CAP = 2;

/**
Hides in an hour, site-wide, past which new requests hide nothing.
*/
export const TAKEDOWN_VALVE_PER_HOUR = 10;

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
 * What a new request from `keys` may do. `held` means it may hide and
 * alert; the caller hides only when its link is ours.
 */
export async function holdStateFor(
  db: Db,
  keys: RequesterKeys,
  now: number,
): Promise<HoldState> {
  const blockedWhere = inArray(takedownBlocks.key, keysOf(keys));
  const openWhere = and(
    requesterMatches(keys),
    eq(takedownRequests.status, "pending"),
  );
  const [blocked, heldThisHour, open] = await db.batch([
    db
      .select({ key: takedownBlocks.key })
      .from(takedownBlocks)
      .where(blockedWhere)
      .limit(1),
    heldInTheHour(db, now),
    db.select({ n: count() }).from(takedownRequests).where(openWhere),
  ]);
  if (blocked.length > 0) return "blocked";
  if ((heldThisHour[0]?.n ?? 0) >= TAKEDOWN_VALVE_PER_HOUR) return "valve";
  if ((open[0]?.n ?? 0) >= TAKEDOWN_CAP) return "confirm";
  return "held";
}

/**
 * Whether the valve is shut now — read again at a confirm, which may come
 * long after its request was filed.
 */
export async function isValveShut(db: Db, now: number): Promise<boolean> {
  const [row] = await heldInTheHour(db, now);
  return (row?.n ?? 0) >= TAKEDOWN_VALVE_PER_HOUR;
}

/**
How many requests hid something in the hour before `now`, by `held_at`'s index.
*/
function heldInTheHour(db: Db, now: number) {
  const since = gte(takedownRequests.heldAt, now - HOUR_S);
  return db.select({ n: count() }).from(takedownRequests).where(since);
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
