/**
 * Strava connect/disconnect (102 §6). Writes only `strava_connections` —
 * no other module may import that table (docs/contracts.md). Pure of
 * request plumbing (the `StravaApi` seam is injected) so this is fully
 * unit-testable without live credentials; functions.ts supplies the real
 * `createStravaApi` when secrets are configured.
 */
import { eq } from "drizzle-orm";

import { stravaConnections } from "../../../db/schema-core";
import type { CoreDb } from "../core-db";
import { createNotification } from "../notifications";
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
On-demand refresh (resilience law: never loop on a dead grant). Success
persists the new tokens; failure marks the connection `broken` and
notifies the user once (dedupe subject = userId) — no retry loop here or
anywhere else; the user must reconnect to clear it.
*/
export async function refreshStravaToken(
  db: CoreDb,
  api: StravaApi,
  userId: string,
): Promise<"ok" | "broken" | "not_connected"> {
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
      })
      .where(eq(stravaConnections.userId, userId));
    return "ok";
  } catch {
    await db
      .update(stravaConnections)
      .set({ status: "broken" })
      .where(eq(stravaConnections.userId, userId));
    await createNotification(db, {
      userId,
      kind: "strava_broken",
      subjectId: userId,
      body: "Your Strava connection needs to be reconnected.",
    });
    return "broken";
  }
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
