/**
 * Strava connect/disconnect (102 §6). Writes only `strava_connections` —
 * no other module may import that table (docs/contracts.md). Pure of
 * request plumbing (the `StravaApi` seam is injected) so this is fully
 * unit-testable without live credentials; functions.ts supplies the real
 * `createStravaApi` when secrets are configured.
 */
import { eq, sql } from "drizzle-orm";

import { stravaConnections } from "../../../db/schema-core";
import type { CoreDb } from "../core-db";
import { createNotification } from "../notifications";
import { isTerminalStravaError } from "./api";
import type { StravaApi } from "./api";

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
 * refresh — three retries during one 30-second Strava outage would trip a
 * bare counter instantly, while an inactive user might take weeks to
 * accumulate three. The window makes the decision about elapsed trouble
 * rather than about attempt count.
 */
const MAX_CONSECUTIVE_REFRESH_FAILURES = 3;
const MIN_FAILURE_WINDOW_S = 30 * 60;

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

  await db
    .update(stravaConnections)
    .set({
      status: "broken",
      refreshFailureCount: failureCount,
      refreshFirstFailedAt: firstFailedAt,
    })
    .where(eq(stravaConnections.userId, userId));
  // Only on the ok -> broken transition. `strava_broken` has no subject,
  // and a UNIQUE index does not dedupe NULLs, so re-notifying a connection
  // that is already broken would insert a second row every time.
  if (connection.status !== "broken") {
    await createNotification(db, {
      userId,
      kind: "strava_broken",
      body: "Your Strava connection needs to be reconnected.",
    });
  }
  return "broken";
}

/**
Best-effort revoke, then always delete the local row (law 5 — a failing
upstream call must never block the user's own disconnect action). Refreshes
first only when the stored access token has actually expired.
*/
export async function disconnectStrava(
  db: CoreDb,
  api: StravaApi | undefined,
  userId: string,
): Promise<void> {
  const connection = await getStravaConnection(db, userId);
  if (connection !== undefined && api !== undefined) {
    try {
      let accessToken = connection.accessToken;
      if (connection.expiresAt <= nowS()) {
        const refreshed = await api.refreshToken(connection.refreshToken);
        accessToken = refreshed.accessToken;
      }
      await api.deauthorize(accessToken);
    } catch {
      // Degrade, don't fail — the local disconnect below still proceeds.
    }
  }
  await db.delete(stravaConnections).where(eq(stravaConnections.userId, userId));
}
