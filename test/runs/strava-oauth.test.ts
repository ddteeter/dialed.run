import { eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  notifications,
  stravaConnections,
  stravaRevocations,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import type {
  ExchangedTokens,
  StravaApi,
} from "../../src/modules/runs/strava/api";
import { StravaApiError } from "../../src/modules/runs/strava/api";
import {
  completeStravaConnect,
  connectFromCallback,
  disconnectStrava,
  getStravaConnection,
  isCapacityRefusal,
  STRAVA_STATE_COOKIE,
  stravaAuthorizeUrl,
  stravaCallbackOutcome,
  stravaConnectRedirect,
  stravaStatusOf,
} from "../../src/modules/runs/strava/oauth";

import { nowSeconds } from "../../src/lib/now";
/**
 * `captureException` is injected (the same seam as `StravaApi` and the
 * revoke queue) rather than imported from `modules/ops`, so this module has
 * no edge back into ops at all — importing it would reintroduce the cycle
 * `runs -> strava/oauth -> ops -> queues/scheduled -> runs`
 * (dependency-cruiser's `no-circular`). `functions.ts` wires the real
 * `captureException`; this stands in for it and records every call.
 */
function captureExceptionSpy(): {
  reports: { context: Record<string, string>; error: unknown }[];
  captureException: (error: unknown, context: Record<string, string>) => void;
} {
  const reports: { context: Record<string, string>; error: unknown }[] = [];
  return {
    reports,
    captureException: (error, context) => {
      reports.push({ error, context });
    },
  };
}

function fakeRevokeQueue(): {
  sent: unknown[];
  send: (message: unknown) => Promise<unknown>;
} {
  const sent: unknown[] = [];
  return {
    sent,
    send(message: unknown) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

function nowS(): number {
  return nowSeconds();
}

function fakeApi(
  overrides: Partial<{
    exchangeCode: () => Promise<ExchangedTokens>;
  }> = {},
): StravaApi {
  return {
    exchangeCode:
      overrides.exchangeCode ??
      (() =>
        Promise.resolve({
          // Unique per fixture: strava_connections.athlete_id is UNIQUE
          // (one athlete belongs to one user), and these tests share a
          // database within the file.
          athleteId: newUlid(),
          refreshToken: "refresh-1",
        })),
    revoke: () => Promise.reject(new Error("oauth.ts never revokes")),
  };
}

describe("stravaAuthorizeUrl", () => {
  it("builds the authorize URL with client id, redirect, and state", () => {
    const url = stravaAuthorizeUrl(
      "client-1",
      "https://dialed.run/runs/strava-callback",
      "state-1",
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://www.strava.com/oauth/authorize",
    );
    expect(parsed.searchParams.get("client_id")).toBe("client-1");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://dialed.run/runs/strava-callback",
    );
    expect(parsed.searchParams.get("state")).toBe("state-1");
  });
});

describe("completeStravaConnect (102 §6)", () => {
  it("inserts a connection row from the exchanged tokens", async () => {
    const db = coreDb();
    const userId = newUlid();
    const athleteId = newUlid();
    await completeStravaConnect(
      db,
      fakeApi({
        exchangeCode: () =>
          Promise.resolve({
            athleteId,
            refreshToken: "refresh-1",
          }),
      }),
      userId,
      "auth-code",
    );

    const connection = await getStravaConnection(db, userId);
    expect(connection?.athleteId).toBe(athleteId);
    expect(connection?.refreshToken).toBe("refresh-1");
  });

  it("reconnecting replaces the existing row rather than erroring", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");
    await completeStravaConnect(
      db,
      fakeApi({
        exchangeCode: () =>
          Promise.resolve({
            athleteId: "222",
            refreshToken: "refresh-new",
          }),
      }),
      userId,
      "auth-code-2",
    );

    const connection = await getStravaConnection(db, userId);
    expect(connection?.athleteId).toBe("222");
    expect(connection?.refreshToken).toBe("refresh-new");
  });
});

describe("disconnectStrava", () => {
  /**
   * The revoke is queued, not called. The user's own action must not wait
   * on Strava (law 5), and the previous version swallowed a failed revoke
   * in a catch — leaving a live grant behind forever whenever Strava
   * happened to be down at that moment.
   */
  it("deletes the connection and records the revoke in one batch", async () => {
    const db = coreDb();
    const userId = newUlid();
    const athleteId = newUlid();
    await db.insert(stravaConnections).values({
      userId,
      athleteId,
      refreshToken: "refresh-live",
    });
    const queue = fakeRevokeQueue();

    await disconnectStrava(
      db,
      queue,
      userId,
      captureExceptionSpy().captureException,
    );

    expect(await getStravaConnection(db, userId)).toBeUndefined();

    // The durable half: the intent is a row, written with the delete.
    const [pending] = await db
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.refreshToken, "refresh-live"));
    // STR-2: the token a revoke can still use however late the drain
    // runs — a refresh token lives until rotated.
    expect(pending?.refreshToken).toBe("refresh-live");

    // The queue message is only a pointer to it — no secret on the wire.
    expect(queue.sent).toEqual([
      { type: "strava_revoke", revocationId: pending?.id },
    ]);
  });

  /**
   * The failure this design exists for: dispatch is a fast path, not the
   * guarantee. A queue that is down must not lose the revocation.
   */
  it("still records the revocation when dispatch fails", async () => {
    const db = coreDb();
    const userId = newUlid();
    const token = `refresh-${newUlid()}`;
    await db.insert(stravaConnections).values({
      userId,
      athleteId: newUlid(),
      refreshToken: token,
    });
    const failing = {
      sent: [] as unknown[],
      send: () => Promise.reject(new Error("queue unavailable")),
    };

    const spy = captureExceptionSpy();
    await expect(
      disconnectStrava(db, failing, userId, spy.captureException),
    ).resolves.toBeUndefined();
    const reports = spy.reports;

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    // Scoped to this test's token: these tests share a database, so a
    // bare count would pick up rows other cases left behind.
    const rows = await db
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.refreshToken, token));
    expect(rows).toHaveLength(1);

    // A dropped dispatch is not silent: the digest re-dispatches the row,
    // and the report says which row and which surface dropped it.
    expect(reports).toHaveLength(1);
    expect((reports[0]?.error as Error).message).toBe("queue unavailable");
    expect(reports[0]?.context).toStrictEqual({
      surface: "strava-revoke-dispatch",
      revocationId: rows[0]?.id,
    });
  });

  it("deletes the local row even with no queue to revoke through", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    const spy = captureExceptionSpy();
    await disconnectStrava(db, undefined, userId, spy.captureException);

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    // No queue is a configuration, not a failure — nothing to report.
    expect(spy.reports).toHaveLength(0);
  });

  it("is a no-op (besides being idempotent) when there is no connection", async () => {
    const db = coreDb();
    const queue = fakeRevokeQueue();
    await expect(
      disconnectStrava(
        db,
        queue,
        newUlid(),
        captureExceptionSpy().captureException,
      ),
    ).resolves.toBeUndefined();
    expect(queue.sent).toHaveLength(0);
  });
});

describe("stravaAuthorizeUrl carries every parameter Strava needs", () => {
  it("asks for the scope this app uses and nothing more", () => {
    // `activity:read` is the whole ask. A wider scope is a permission
    // prompt that scares people off and data this app is forbidden to
    // store anyway (D-33).
    const url = new URL(
      stravaAuthorizeUrl("client-1", "https://dialed.run/cb", "state-1"),
    );

    expect(url.origin + url.pathname).toBe(
      "https://www.strava.com/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://dialed.run/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("approval_prompt")).toBe("auto");
    expect(url.searchParams.get("scope")).toBe("activity:read");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("escapes a redirect and a state that need it", () => {
    // The state is a CSRF nonce and the redirect is built from the live
    // request; either can contain characters a query string cares about.
    const url = new URL(
      stravaAuthorizeUrl("id", "https://dialed.run/cb?a=b&c=d", "st ate/+"),
    );

    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://dialed.run/cb?a=b&c=d",
    );
    expect(url.searchParams.get("state")).toBe("st ate/+");
  });
});

describe("completeStravaConnect stores only what a revoke needs (D-54)", () => {
  it("stores the athlete and the refresh token, and nothing else", async () => {
    const db = coreDb();
    const userId = newUlid();
    const athleteId = `athlete-${newUlid()}`;
    const before = nowS();

    await completeStravaConnect(
      db,
      fakeApi({
        exchangeCode: () =>
          Promise.resolve({ athleteId, refreshToken: "refresh-9" }),
      }),
      userId,
      "the-code",
    );

    // No access token, no expiry, no refresh-failure tracking: the row
    // is the grant's identity and the one token that revokes it.
    const connection = await getStravaConnection(db, userId);
    const connectedAt = connection?.connectedAt ?? 0;
    expect(connectedAt).toBeGreaterThanOrEqual(before);
    expect(connection).toStrictEqual({
      userId,
      athleteId,
      refreshToken: "refresh-9",
      connectedAt,
    });
  });
});

describe("disconnectStrava when there is nothing connected", () => {
  it("does nothing to revoke, and does not fail", async () => {
    // Pressing disconnect twice, or on an account that never connected.
    const db = coreDb();
    const queue = fakeRevokeQueue();

    await disconnectStrava(
      db,
      queue,
      newUlid(),
      captureExceptionSpy().captureException,
    );

    expect(queue.sent).toStrictEqual([]);
  });

  it("still disconnects with no queue configured at all", async () => {
    // No Strava credentials means no queue producer is passed. The local
    // delete is the user's own action and must not depend on it.
    const db = coreDb();
    const userId = newUlid();
    await db.insert(stravaConnections).values({
      userId,
      athleteId: newUlid(),
      refreshToken: "refresh-noqueue",
    });

    await disconnectStrava(
      db,
      undefined,
      userId,
      captureExceptionSpy().captureException,
    );

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    const [pending] = await db
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.refreshToken, "refresh-noqueue"));
    expect(pending).toBeDefined();
  });
});

describe("stravaCallbackOutcome (the CSRF guard, D-41)", () => {
  /**
   * This used to be a branch inside `functions.ts`, which imports TanStack
   * Start and so cannot be imported by a test at all — the one security
   * check in the module was the one thing nothing could assert on.
   */
  const state = "01STATE";

  it("exchanges a callback whose state matches the cookie", () => {
    expect(
      stravaCallbackOutcome({
        expectedState: state,
        state,
        code: "auth-code",
        error: undefined,
      }),
    ).toStrictEqual({ ok: true, code: "auth-code" });
  });

  it("refuses a state that does not match the cookie", () => {
    // The attack: a third party sends the user to /runs/strava-callback
    // with their own `code`, connecting the victim's account to the
    // attacker's Strava. The nonce is what makes that fail.
    expect(
      stravaCallbackOutcome({
        expectedState: state,
        state: "01SOMEONEELSE",
        code: "auth-code",
        error: undefined,
      }),
    ).toStrictEqual({
      ok: false,
      reason: "That connection link expired. Try again.",
    });
  });

  it.each([
    [
      "no cookie to compare against",
      { expectedState: undefined, state, code: "c" },
    ],
    ["no state on the callback", { expectedState: state, code: "c" }],
    ["no code to exchange", { expectedState: state, state }],
    // The one a naive `state !== expectedState` would let through:
    // undefined equals undefined, so a link with no state at all would
    // match a browser that never got a cookie.
    ["neither a cookie nor a state", { expectedState: undefined, code: "c" }],
  ])("refuses a callback with %s", (_label, callback) => {
    expect(stravaCallbackOutcome(callback)).toStrictEqual({
      ok: false,
      reason: "That connection link expired. Try again.",
    });
  });

  it("says a cancelled connection was cancelled, not that it expired", () => {
    // Strava sends `error=access_denied` when the user declines on its own
    // screen. Telling them the link expired would send them round again.
    expect(
      stravaCallbackOutcome({
        expectedState: state,
        error: "access_denied",
      }),
    ).toStrictEqual({
      ok: false,
      reason: "Strava connection was cancelled.",
    });
  });

  it("reports a cancellation ahead of a missing state", () => {
    // A declined connection arrives with no code and no state, so the
    // order of these two checks is what the user reads.
    expect(
      stravaCallbackOutcome({
        expectedState: undefined,
        error: "access_denied",
      }),
    ).toMatchObject({ reason: "Strava connection was cancelled." });
  });
});

describe("isCapacityRefusal (STR-6: the eleventh athlete)", () => {
  it("is Strava's 403 naming the connected-athlete limit", () => {
    // The response pinned: status 403, message "Limit of connected
    // athletes exceeded" — what the token exchange answers when the app is
    // at its athlete cap.
    expect(
      isCapacityRefusal(
        new StravaApiError(
          "Strava responded 403",
          403,
          "Limit of connected athletes exceeded",
        ),
      ),
    ).toBe(true);
  });

  it("needs both the status and the message", () => {
    expect(
      isCapacityRefusal(
        new StravaApiError(
          "Strava responded 400",
          400,
          "Limit of connected athletes exceeded",
        ),
      ),
    ).toBe(false);
    expect(
      isCapacityRefusal(
        new StravaApiError("Strava responded 403", 403, "Forbidden"),
      ),
    ).toBe(false);
    expect(
      isCapacityRefusal(new StravaApiError("Strava responded 403", 403)),
    ).toBe(false);
  });

  it("is never true of an error that is not Strava's", () => {
    expect(isCapacityRefusal(new Error("connected athletes"))).toBe(false);
    expect(isCapacityRefusal(undefined)).toBe(false);
  });
});

describe("connectFromCallback (the callback, as one decision)", () => {
  const GOOD = { expectedState: "s-1", state: "s-1", code: "code-1" };

  it("connects a callback whose state matches", async () => {
    const db = coreDb();
    const userId = newUlid();

    const result = await connectFromCallback(
      db,
      fakeApi(),
      userId,
      GOOD,
      captureExceptionSpy().captureException,
    );

    expect(result).toStrictEqual({ ok: true });
    const connection = await getStravaConnection(db, userId);
    expect(connection?.refreshToken).toBe("refresh-1");
  });

  it("refuses a forged callback without calling Strava", async () => {
    const db = coreDb();
    const userId = newUlid();
    const exchangeCode = vi.fn(() =>
      Promise.reject(new Error("must not be called")),
    );

    const result = await connectFromCallback(
      db,
      { ...fakeApi(), exchangeCode },
      userId,
      { ...GOOD, state: "other" },
      captureExceptionSpy().captureException,
    );

    expect(result).toStrictEqual({
      ok: false,
      reason: "That connection link expired. Try again.",
      full: false,
    });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(await getStravaConnection(db, userId)).toBeUndefined();
  });

  it("says Strava is not configured when there is no api", async () => {
    const result = await connectFromCallback(
      coreDb(),
      undefined,
      newUlid(),
      GOOD,
      captureExceptionSpy().captureException,
    );

    expect(result).toStrictEqual({
      ok: false,
      reason: "Strava isn't configured yet.",
      full: false,
    });
  });

  it("tells the eleventh athlete the app is full, and reports nothing", async () => {
    const db = coreDb();
    const userId = newUlid();
    const full = fakeApi({
      exchangeCode: () =>
        Promise.reject(
          new StravaApiError(
            "Strava responded 403",
            403,
            "Limit of connected athletes exceeded",
          ),
        ),
    });

    const spy = captureExceptionSpy();
    const result = await connectFromCallback(
      db,
      full,
      userId,
      GOOD,
      spy.captureException,
    );

    expect(result).toStrictEqual({
      ok: false,
      reason: "Strava is full for now.",
      full: true,
    });
    // Expected, not a fault: capacity is a known limit of the friends stage.
    expect(spy.reports).toHaveLength(0);
    expect(await getStravaConnection(db, userId)).toBeUndefined();
  });

  it("answers any other exchange failure as a result, and reports it", async () => {
    const db = coreDb();
    const userId = newUlid();
    const down = fakeApi({
      exchangeCode: () =>
        Promise.reject(new StravaApiError("Strava responded 500", 500)),
    });

    const spy = captureExceptionSpy();
    const result = await connectFromCallback(
      db,
      down,
      userId,
      GOOD,
      spy.captureException,
    );

    expect(result).toStrictEqual({
      ok: false,
      reason: "Strava didn't connect.",
      full: false,
    });
    expect(spy.reports).toHaveLength(1);
    expect(spy.reports[0]?.context).toStrictEqual({
      userId,
      surface: "strava-connect",
    });
  });
});

describe("stravaConnectRedirect (STR-7: the official button is a link)", () => {
  const CONFIG = { clientId: "client-1", clientSecret: "secret" };

  it("sends a runner to Strava with a fresh nonce in a cookie", () => {
    const response = stravaConnectRedirect({
      userId: newUlid(),
      config: CONFIG,
      origin: "https://dialed.run",
      state: "nonce-1",
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://www.strava.com/oauth/authorize",
    );
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.get("state")).toBe("nonce-1");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://dialed.run/runs/strava-callback",
    );
    expect(response.headers.get("set-cookie")).toBe(
      `${STRAVA_STATE_COOKIE}=nonce-1; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(STRAVA_STATE_COOKIE).toBe("strava_oauth_state");
  });

  it("sends a signed-out visitor to log in, with no nonce", () => {
    const response = stravaConnectRedirect({
      userId: undefined,
      config: CONFIG,
      origin: "https://dialed.run",
      state: "nonce-1",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://dialed.run/auth/login",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends a runner back to Strava settings when Strava is not configured", () => {
    const response = stravaConnectRedirect({
      userId: newUlid(),
      config: undefined,
      origin: "https://dialed.run",
      state: "nonce-1",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://dialed.run/runs/strava",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

async function reminder(
  userId: string,
  createdAt: number,
  kind = "strava_reminder",
) {
  await coreDb().insert(notifications).values({
    id: newUlid(),
    userId,
    kind,
    subjectId: newUlid(),
    body: "New run on Strava",
    createdAt,
  });
}

describe("stravaStatusOf (T1 and T3a)", () => {
  it("is not connected, with no run seen, for a runner who never connected", async () => {
    expect(await stravaStatusOf(coreDb(), newUlid())).toStrictEqual({
      connected: false,
      lastRunSeenAt: undefined,
    });
  });

  it("is connected, and names the newest reminder's time", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "code");
    await reminder(userId, 1000);
    await reminder(userId, 3000);
    await reminder(userId, 2000);
    // Neither another kind nor another runner's reminder counts.
    await reminder(userId, 9000, "kit_reminder");
    await reminder(newUlid(), 8000);

    expect(await stravaStatusOf(db, userId)).toStrictEqual({
      connected: true,
      lastRunSeenAt: 3000,
    });
  });
});

describe("completeStravaConnect: a grant made now", () => {
  it("stamps when the grant was made", async () => {
    const db = coreDb();
    const userId = newUlid();
    const before = nowS();

    await completeStravaConnect(db, fakeApi(), userId, "code");

    const connection = await getStravaConnection(db, userId);
    expect(connection?.connectedAt).toBeGreaterThanOrEqual(before);
    expect(connection?.connectedAt).toBeLessThanOrEqual(nowS());
  });

  it("cancels a revocation still owed for the grant it reconnects", async () => {
    // Strava may return the refresh token it issued before; a stale
    // revocation would then revoke the grant just made.
    const db = coreDb();
    const userId = newUlid();
    const refreshToken = `refresh-${newUlid()}`;
    const otherToken = `refresh-${newUlid()}`;
    await db.insert(stravaRevocations).values([
      { id: newUlid(), refreshToken, createdAt: 1 },
      { id: newUlid(), refreshToken: otherToken, createdAt: 1 },
    ]);

    await completeStravaConnect(
      db,
      fakeApi({
        exchangeCode: () =>
          Promise.resolve({
            athleteId: newUlid(),
            refreshToken,
          }),
      }),
      userId,
      "code",
    );

    const owed = await db
      .select({ token: stravaRevocations.refreshToken })
      .from(stravaRevocations)
      .where(
        inArray(stravaRevocations.refreshToken, [refreshToken, otherToken]),
      );
    expect(owed).toStrictEqual([{ token: otherToken }]);
  });
});
