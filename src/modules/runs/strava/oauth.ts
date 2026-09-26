/**
 * Strava connect/disconnect (102 §6, task 127). Writes only
 * `strava_connections` and `strava_revocations` — no other module may
 * import those tables (docs/contracts.md). Pure of request plumbing (the
 * `StravaApi` seam is injected) so this is fully unit-testable without
 * live credentials; functions.ts supplies the real `createStravaApi` when
 * secrets are configured.
 *
 * **There is no token refresh here, on purpose** (task 127, STR-1). The
 * app never reads activity data, so a stored grant is used for exactly one
 * thing — revoking it — and `/oauth/revoke` takes the refresh token, which
 * does not expire until it is rotated. The refresh path and D-1's "broken
 * after three failures" logic it carried had no production caller
 * (finding 0.1), and with revocation fixed they have no reason to exist.
 * A grant the runner kills on Strava's side arrives as a deauthorization
 * event instead (./deauthorize.ts).
 */
import { and, desc, eq } from "drizzle-orm";

import {
  notifications,
  stravaConnections,
  stravaRevocations,
} from "../../../db/schema-core";
import type { CoreDb } from "../core-db";
import { newUlid } from "../../../lib/ids";
import { captureException } from "../../ops";
import { StravaApiError } from "./api";
import type { StravaApi, StravaConfig } from "./api";
import type { RevokeJob } from "../queue-messages";
import { nowSeconds } from "../../../lib/now";

export interface RevokeQueueProducer {
  send(message: RevokeJob): Promise<unknown>;
}

export type StravaConnectionRow = typeof stravaConnections.$inferSelect;

/**
 * The cookie the OAuth `state` nonce round-trips in (D-41). Named once:
 * the connect redirect writes it and the callback reads it.
 */
export const STRAVA_STATE_COOKIE = "strava_oauth_state";

/**
 * How long a runner has on Strava's consent screen before the nonce is
 * gone and the callback says the link expired.
 */
const STATE_COOKIE_MAX_AGE_S = 600;

/**
 * Whether a Strava callback may be exchanged for tokens (D-41).
 *
 * The CSRF guard, as a decision rather than a branch inside the server
 * function: `state` is a nonce this app minted and put in an httpOnly
 * cookie, so a callback whose `state` does not match the cookie was not
 * started here. Everything it needs is passed in — the server function
 * reads the cookie and the query, and does nothing else.
 *
 * The refusals are deliberately indistinguishable to the caller: a
 * mismatched state and a missing one are the same answer, because telling
 * them apart tells an attacker which half they got right.
 */
export function stravaCallbackOutcome(callback: {
  expectedState: string | undefined;
  code?: string | undefined;
  state?: string | undefined;
  error?: string | undefined;
}): { ok: true; code: string } | { ok: false; reason: string } {
  // The user pressed "cancel" on Strava's own screen. Not a failure, and
  // saying "expired" for it would be a lie.
  if (callback.error !== undefined) {
    return { ok: false, reason: "Strava connection was cancelled." };
  }
  // The nonce check is `state !== expectedState`, and `expectedState ===
  // undefined` is the case it cannot make on its own: with no cookie and
  // no `state` on the callback, undefined equals undefined and a forged
  // link would pass. A separate `state === undefined` arm would be
  // redundant — an absent state can never equal a present cookie.
  const expected = callback.expectedState;
  if (
    expected === undefined ||
    callback.code === undefined ||
    callback.state !== expected
  ) {
    return { ok: false, reason: "That connection link expired. Try again." };
  }
  return { ok: true, code: callback.code };
}

/**
Pure builder — the redirect_uri is derived by the caller from the live
request, never hardcoded, so this works in any environment.
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

/**
 * The official Connect with Strava button's destination (STR-7, round 26
 * #21): *"The button is the link."* A link cannot mint a nonce, so it
 * points here, and this answers with the nonce in a cookie and a 302 to
 * Strava's `/oauth/authorize`.
 *
 * Signed out, the runner goes to log in; with no credentials configured,
 * back to T1, which draws no connect button in that case — so neither is
 * a dead end, and neither mints a nonce for a flow that cannot finish.
 */
export function stravaConnectRedirect(request: {
  userId: string | undefined;
  config: StravaConfig | undefined;
  origin: string;
  state: string;
}): Response {
  if (request.userId === undefined) {
    return redirectTo(`${request.origin}/auth/login`);
  }
  if (request.config === undefined) {
    return redirectTo(`${request.origin}/runs/strava`);
  }
  const response = redirectTo(
    stravaAuthorizeUrl(
      request.config.clientId,
      `${request.origin}/runs/strava-callback`,
      request.state,
    ),
  );
  // `Path=/` because the callback is a different path from this one, and a
  // cookie with no path is scoped to the directory that set it.
  response.headers.append(
    "set-cookie",
    `${STRAVA_STATE_COOKIE}=${request.state}; Path=/; Max-Age=${String(STATE_COOKIE_MAX_AGE_S)}; HttpOnly; Secure; SameSite=Lax`,
  );
  return response;
}

function redirectTo(location: string): Response {
  return new Response(undefined, { status: 302, headers: { location } });
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
 * What T1 and T3a draw: whether this runner is connected, and when Strava
 * last told us a run landed (round 25: "CONNECTED · LAST RUN SEEN …").
 *
 * The time is the newest reminder's, because a reminder is the only trace
 * a run landing leaves — we keep no activity. A reminder is marked read
 * when its file is uploaded, never deleted, so the time outlives that.
 * Read on `notifications_dedupe`, whose (user, kind) prefix covers it.
 */
export async function stravaStatusOf(
  db: CoreDb,
  userId: string,
): Promise<{ connected: boolean; lastRunSeenAt: number | undefined }> {
  const reminderRows = and(
    eq(notifications.userId, userId),
    eq(notifications.kind, "strava_reminder"),
  );
  const [connection, [latest]] = await Promise.all([
    getStravaConnection(db, userId),
    db
      .select({ at: notifications.createdAt })
      .from(notifications)
      .where(reminderRows)
      .orderBy(desc(notifications.createdAt))
      .limit(1),
  ]);
  return { connected: connection !== undefined, lastRunSeenAt: latest?.at };
}

/**
Exchanges the OAuth `code` and upserts the connection as `ok`. Re-running
with a fresh code (the runner reconnects) replaces the row outright.
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
 * Strava's refusal when the app is at its athlete capacity (STR-6): the
 * friends stage runs at the self-serve cap of ten, and the eleventh
 * friend's token exchange is refused with **403** and the message "Limit
 * of connected athletes exceeded".
 *
 * Both halves are keyed on, so a 403 for any other reason stays a generic
 * failure rather than telling a runner the app is full when it is not.
 */
export function isCapacityRefusal(error: unknown): boolean {
  return (
    error instanceof StravaApiError &&
    error.status === 403 &&
    (error.refusal?.includes("connected athletes") ?? false)
  );
}

/**
 * What the callback screen draws: connected, or why not — with `full`
 * set only for the capacity refusal, which has its own receipt.
 */
export type StravaConnectResult =
  { ok: true } | { ok: false; reason: string; full: boolean };

/**
 * The whole callback, as one decision the server function delegates to:
 * the CSRF guard, the configuration, the exchange, and what each failure
 * tells the runner.
 *
 * An exchange Strava refuses or never answers is a result, not a throw —
 * the screen says so and offers Try again, where a throw from a loader was
 * a crash page. It is reported, because a failure here that is not the
 * capacity is something we did not expect.
 */
export async function connectFromCallback(
  db: CoreDb,
  api: StravaApi | undefined,
  userId: string,
  callback: Parameters<typeof stravaCallbackOutcome>[0],
): Promise<StravaConnectResult> {
  const outcome = stravaCallbackOutcome(callback);
  if (!outcome.ok) return { ...outcome, full: false };
  if (api === undefined) {
    return { ok: false, reason: "Strava isn't configured yet.", full: false };
  }
  try {
    await completeStravaConnect(db, api, userId, outcome.code);
    return { ok: true };
  } catch (error) {
    if (isCapacityRefusal(error)) {
      return { ok: false, reason: "Strava is full for now.", full: true };
    }
    captureException(error, { userId, surface: "strava-connect" });
    return { ok: false, reason: "Strava didn't connect.", full: false };
  }
}

/**
 * Disconnect locally, then hand the upstream revoke to the queue.
 *
 * The local delete is what the user asked for and it happens immediately —
 * law 5, a failing upstream must never block the user's own action. The
 * revoke is owed to another system, so its intent is a row
 * (`strava_revocations`) written in the same batch as the delete (law 8c),
 * and the queue message is only a fast path to it.
 *
 * **The row carries the refresh token** (STR-2). It used to copy the
 * access token, which Strava kills six hours after issue — so a
 * revocation drained any later than that was refused, retried and
 * re-dispatched every day, forever, while the grant stayed live.
 */
export async function disconnectStrava(
  db: CoreDb,
  queue: RevokeQueueProducer | undefined,
  userId: string,
): Promise<void> {
  const connection = await getStravaConnection(db, userId);
  if (connection === undefined) return;

  const revocationId = newUlid();
  await db.batch([
    db.delete(stravaConnections).where(eq(stravaConnections.userId, userId)),
    db.insert(stravaRevocations).values({
      id: revocationId,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      createdAt: nowSeconds(),
    }),
  ]);

  // Fast path. If it fails the row stays, and the daily digest re-dispatches
  // it — so this is an optimisation, not the guarantee.
  if (queue === undefined) return;
  try {
    await queue.send({ type: "strava_revoke", revocationId });
  } catch (error) {
    captureException(error, {
      surface: "strava-revoke-dispatch",
      revocationId,
    });
  }
}
