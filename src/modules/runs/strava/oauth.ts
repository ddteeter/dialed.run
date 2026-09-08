/**
 * Strava connect/disconnect (102 §6). Writes only `strava_connections` —
 * no other module may import that table (docs/contracts.md). Pure of
 * request plumbing (the `StravaApi` seam is injected) so this is fully
 * unit-testable without live credentials; functions.ts supplies the real
 * `createStravaApi` when secrets are configured.
 */
import { eq, sql } from "drizzle-orm";

import {
  stravaConnections,
  stravaRevocations,
} from "../../../db/schema-core";
import type { CoreDb } from "../core-db";
import { newUlid } from "../../../lib/ids";
import { captureException } from "../../ops";
import { notificationInsert } from "../../notifications";
import { isTerminalStravaError } from "./api";
import type { StravaApi } from "./api";
import type { RevokeJob } from "../queue-messages";

export interface RevokeQueueProducer {
  send(message: RevokeJob): Promise<unknown>;
}

export type StravaConnectionRow = typeof stravaConnections.$inferSelect;

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

/**
Pure builder — the redirect_uri is derived by the caller from the live
request (functions.ts), never hardcoded, so this works in any environment.
*/
export function stravaAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function getStravaConnection(
  db: CoreDb,
  userId: string,
): Promise<StravaConnectionRow | undefined> {
  const rows = await db
    .select()
    .from(stravaConnections)
    .where(eq(stravaConnections.userId, userId))
    .limit(1);
  return rows[0];
}

/**
Exchanges the OAuth `code` and upserts the connection as `ok`. Re-running
with a fresh code (e.g. the user reconnects after `broken`) replaces the
row outright.
*/
export async function completeStravaConnect(
  db: CoreDb,
  api: StravaApi,
  userId: string,
  code: string,
): Promise<void> {
  const tokens = await api.exchangeCode(code);
  await db
    .insert(stravaConnections)
    .values({
      userId,
      athleteId: tokens.athleteId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      status: "ok",
    })
    .onConflictDoUpdate({
      target: stravaConnections.userId,
      set: {
        athleteId: tokens.athleteId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        status: "ok",
      },
    });
}

/**
 * How many consecutive refresh failures, and how long they must have been
 * going on, before a connection is called broken.
 *
 * Both are required, and the window is the important half. How long three
 * failures take is entirely a function of how often something calls the
 * refresh — three retries during one short Strava outage would trip a bare
 * counter instantly, while an inactive user might take weeks to accumulate
 * three. The window makes the decision about elapsed trouble rather than
 * about attempt count.
 *
 * Three days, not thirty minutes. A bad day at Strava fails every user's
 * refresh at once, and a short window would turn that into a fleet-wide
 * "reconnect your account" — telling thousands of people to break a grant
 * that was never broken. Three days is longer than any outage we should
 * plan to survive silently, and the user-facing consequence of waiting is
 * only a late reminder.
 */
const MAX_CONSECUTIVE_REFRESH_FAILURES = 3;
const MIN_FAILURE_WINDOW_S = 3 * 24 * 60 * 60;

/**
On-demand refresh. Success clears any failure run; a *terminal* failure
(Strava rejecting the grant, i.e. the user revoked access) marks the
connection broken immediately; a transient one is counted and otherwise
left alone. Still no retry loop here — the user must reconnect to clear a
broken connection, and the queue owns retries everywhere else.

The user is notified once, ever, per broken connection: notifications are
deduped on (user, kind, subject) and this one's subject is the userId. So
a flapping connection cannot produce a notification storm — but the same
dedupe means a *second* genuine breakage after a repair is silent, which
is recorded as its own item in docs/deferred.md.
*/
export async function refreshStravaToken(
  db: CoreDb,
  api: StravaApi,
  userId: string,
): Promise<"ok" | "broken" | "degraded" | "not_connected"> {
  const connection = await getStravaConnection(db, userId);
  if (connection === undefined) return "not_connected";
  try {
    const refreshed = await api.refreshToken(connection.refreshToken);
    await db
      .update(stravaConnections)
      .set({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        status: "ok",
        refreshFailureCount: 0,
        // drizzle drops `undefined` set-values, so clearing a column
        // needs a real SQL NULL.
        refreshFirstFailedAt: sql`NULL`,
      })
      .where(eq(stravaConnections.userId, userId));
    return "ok";
  } catch (error) {
    return recordRefreshFailure(db, connection, userId, error);
  }
}

async function recordRefreshFailure(
  db: CoreDb,
  connection: {
    status: "ok" | "broken";
    refreshFailureCount: number;
    refreshFirstFailedAt: number | null;
  },
  userId: string,
  error: unknown,
): Promise<"broken" | "degraded"> {
  const now = nowS();
  const firstFailedAt = connection.refreshFirstFailedAt ?? now;
  const failureCount = connection.refreshFailureCount + 1;
  const isExhausted =
    failureCount >= MAX_CONSECUTIVE_REFRESH_FAILURES &&
    now - firstFailedAt >= MIN_FAILURE_WINDOW_S;

  if (!isExhausted && !isTerminalStravaError(error)) {
    // Transient, and not yet persistent enough to be worth telling anyone
    // about. Remember it and leave the connection alone.
    await db
      .update(stravaConnections)
      .set({ refreshFailureCount: failureCount, refreshFirstFailedAt: firstFailedAt })
      .where(eq(stravaConnections.userId, userId));
    return "degraded";
  }

  const markBroken = db
    .update(stravaConnections)
    .set({
      status: "broken",
      refreshFailureCount: failureCount,
      refreshFirstFailedAt: firstFailedAt,
    })
    .where(eq(stravaConnections.userId, userId));

  // Who hears about this depends on whether we actually know it is the
  // user's problem.
  //
  // A terminal failure is Strava saying this grant is dead, which is
  // per-user and true, so the user is told — once, on the ok -> broken
  // transition (`strava_broken` has no subject, and a UNIQUE index does not
  // dedupe NULLs, so the transition is the guard).
  //
  // Exhausted transient failures are ambiguous: Strava down, our config
  // wrong, a network partition. Telling a user to reconnect then is worse
  // than saying nothing — they will disconnect a working account to fix a
  // problem that was never theirs. So the connection is marked broken to
  // stop hammering, and a human hears about it instead (law 6).
  //
  // The notification lands in the same batch as the status change, because
  // it is the only record the user gets of it: separate awaits leave a
  // window where the connection reads `broken` and nobody was told, and
  // the transition guard means the next attempt will not tell them either.
  const shouldNotify =
    isTerminalStravaError(error) && connection.status !== "broken";
  await (shouldNotify
    ? db.batch([
        markBroken,
        notificationInsert(db, {
          userId,
          kind: "strava_broken",
          body: "Your Strava connection needs to be reconnected.",
        }),
      ])
    : markBroken);

  if (!isTerminalStravaError(error) && connection.status !== "broken") {
    captureException(new Error("strava refresh exhausted without a 4xx"), {
      userId,
      failureCount: String(failureCount),
      firstFailedAt: String(firstFailedAt),
    });
  }
  return "broken";
}

/**
Best-effort revoke, then always delete the local row (law 5 — a failing
upstream call must never block the user's own disconnect action). Refreshes
first only when the stored access token has actually expired.
*/
/**
 * Disconnect locally, then hand the upstream revoke to the queue.
 *
 * The local delete is what the user asked for and it happens immediately —
 * law 5, a failing upstream must never block the user's own action. What
 * changed is that the revoke is no longer a best-effort call swallowed in
 * a `catch`: if Strava is down at that moment we used to simply leave a
 * live grant behind forever. The queue retries it, and a genuinely
 * unrevokable grant ends up in the DLQ where a human sees it.
 */
export async function disconnectStrava(
  db: CoreDb,
  queue: RevokeQueueProducer | undefined,
  userId: string,
): Promise<void> {
  const connection = await getStravaConnection(db, userId);
  if (connection === undefined) {
    await db
      .delete(stravaConnections)
      .where(eq(stravaConnections.userId, userId));
    return;
  }

  // Delete and "remember to revoke" land together, because they are two
  // halves of one decision and no transaction spans the database and the
  // queue. Writing the intent first makes dispatch a separate, retryable
  // problem instead of a fire-and-forget call that can vanish.
  const revocationId = newUlid();
  await db.batch([
    db.delete(stravaConnections).where(eq(stravaConnections.userId, userId)),
    db.insert(stravaRevocations).values({
      id: revocationId,
      accessToken: connection.accessToken,
      createdAt: nowS(),
    }),
  ]);

  // Fast path. If it fails the row stays, and the daily digest re-dispatches
  // it — so this is an optimisation, not the guarantee.
  if (queue === undefined) return;
  try {
    await queue.send({ type: "strava_revoke", revocationId });
  } catch (error) {
    captureException(error, { surface: "strava-revoke-dispatch", revocationId });
  }
}
