/**
 * The handle re-ask (task 126 PR B; owner, pre-public): a handle claimed
 * while OpenAI's moderation could not answer is stored `unknown`
 * (`username.ts`' claim), and this asks again, hourly, until it answers.
 *
 * **Reconciliation, not a queue** (law 8c): `unknown` is the durable
 * marker, and the `:15` firing — which already re-drives photo screening
 * — re-drives this through `DailyUpkeep.rescreenHandles`, handed in by the
 * Worker entry because `ops` cannot import `account`.
 *
 * **Claim, then work** (law 2): one statement moves up to `RESCREEN_CAP`
 * rows to `checking`, so overlapping firings ask about disjoint handles,
 * and a firing that dies mid-run leaves rows the lease hands back.
 *
 * **Every answer is written over its own claim only**: the same runner,
 * the same handle, still `checking`. A runner who renamed meanwhile has a
 * fresh verdict on the new handle, and the stale answer writes nothing.
 *
 * - `clear` — written, and never asked again;
 * - `flagged` — written in one batch with the Desk's review row
 *   (`enqueueForReview`, a `profile` from the `classifier`). A person
 *   decides; nothing renames automatically;
 * - `unknown` again — the claim goes back to `unknown` for the next hour.
 */
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { env } from "../../env";
import { nowSeconds } from "../../lib/now";
import { captureException } from "../ops";
import { enqueueForReview } from "../safety";
import { screenHandle, type HandleScreenVerdict } from "./handle-screen";

/**
Safety's review write takes drizzle's plain database type, so this module does too.
*/
type Db = DrizzleD1Database;

/**
 * Handles asked about per firing. Each call may take its full five
 * seconds, so twenty keeps a firing under two minutes of waiting.
 */
export const RESCREEN_CAP = 20;

/**
 * How long a claim holds before another firing may take the row back —
 * longer than a firing's worst case, so a live claim is never stolen.
 */
export const RESCREEN_LEASE_S = 15 * 60;

/**
The check for one claimed handle, given whose it is so a failure is reported against them.
*/
export type Rescreen = (
  handle: string,
  userId: string,
) => Promise<HandleScreenVerdict>;

/**
 * Which rows a firing may claim: still `unknown`, or `checking` under a
 * lease that ran out. The `IN` term is the partial index's own predicate,
 * which is what lets SQLite serve the read from that index.
 */
function claimable(now: number): SQL | undefined {
  return and(
    inArray(userProfiles.usernameScreen, ["unknown", "checking"]),
    or(
      eq(userProfiles.usernameScreen, "unknown"),
      lt(userProfiles.usernameScreenedAt, now - RESCREEN_LEASE_S),
    ),
  );
}

/**
 * The claimed row, still as claimed: this runner, this handle, `checking`.
 */
function stillClaimed(userId: string, handle: string): SQL | undefined {
  return and(
    eq(userProfiles.userId, userId),
    eq(userProfiles.username, handle),
    eq(userProfiles.usernameScreen, "checking"),
  );
}

function settle(
  db: Db,
  userId: string,
  handle: string,
  verdict: HandleScreenVerdict,
  now: number,
) {
  return db
    .update(userProfiles)
    .set({ usernameScreen: verdict, usernameScreenedAt: now })
    .where(stillClaimed(userId, handle));
}

/**
 * Claims up to `RESCREEN_CAP` handles. A screen value only ever sits
 * beside a handle — the claim writes both, and a moderator's rename nulls
 * both — so every claimed row has one.
 */
async function claim(db: Db, now: number) {
  const candidates = db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(claimable(now))
    .limit(RESCREEN_CAP);
  return db
    .update(userProfiles)
    .set({ usernameScreen: "checking", usernameScreenedAt: now })
    .where(and(inArray(userProfiles.userId, candidates), claimable(now)))
    .returning({
      userId: userProfiles.userId,
      handle: sql<string>`${userProfiles.username}`,
    });
}

/**
 * A flagged handle's verdict and its review row, together — but only for
 * a claim still standing, which a read settles first (a batch cannot
 * branch). A rename between that read and the batch is not worth a
 * guard: the batch's own update writes nothing then, and the review row
 * shows the reviewer the handle the runner holds now.
 */
async function flag(
  db: Db,
  userId: string,
  handle: string,
  now: number,
): Promise<void> {
  const [standing] = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(stillClaimed(userId, handle))
    .limit(1);
  if (standing === undefined) return;
  await db.batch([
    settle(db, userId, handle, "flagged", now),
    enqueueForReview(db, {
      subjectType: "profile",
      subjectId: userId,
      source: "classifier",
    }),
  ]);
}

/**
 * One firing's re-ask. Each line it adds to `anomalies` names a count,
 * never a handle.
 */
export async function rescreenHandles(
  db: Db,
  rescreen: Rescreen,
  anomalies: string[],
  now: number = nowSeconds(),
): Promise<void> {
  const claimed = await claim(db, now);
  let unanswered = 0;
  for (const { userId, handle } of claimed) {
    const verdict = await rescreen(handle, userId);
    if (verdict === "flagged") {
      await flag(db, userId, handle, now);
      continue;
    }
    if (verdict === "unknown") unanswered += 1;
    await settle(db, userId, handle, verdict, now);
  }
  if (unanswered > 0) {
    anomalies.push(
      `${String(unanswered)} handle(s) still unscreened: moderation did not answer`,
    );
  }
}

/**
 * The re-ask against one key. With no key there is nothing to ask, so
 * nothing is claimed: the handles stay `unknown` until one is deployed. A
 * failed call is reported with the runner's id and never the handle
 * (law 7). The key is a parameter because a test cannot change the
 * Worker's bindings from inside the isolate.
 */
export async function rescreenWithKey(
  db: Db,
  apiKey: string | undefined,
  anomalies: string[],
): Promise<void> {
  if (apiKey === undefined || apiKey === "") return;
  await rescreenHandles(
    db,
    (handle, userId) =>
      screenHandle(handle, {
        apiKey,
        report: (error, context) => {
          captureException(error, {
            ...context,
            surface: "handle-rescreen",
            userId,
          });
        },
      }),
    anomalies,
  );
}

/**
The re-ask against the deployed key, for the Worker entry.
*/
export function rescreenHandlesFromEnv(anomalies: string[]): Promise<void> {
  return rescreenWithKey(
    drizzle(env.DIALED_CORE),
    env.OPENAI_API_KEY,
    anomalies,
  );
}
