import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { stravaConnections } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import { unreadNotificationCount } from "../../src/modules/notifications";
import type {
  ExchangedTokens,
  RefreshedTokens,
  StravaApi,
} from "../../src/modules/runs/strava/api";
import { StravaApiError } from "../../src/modules/runs/strava/api";
import {
  completeStravaConnect,
  disconnectStrava,
  getStravaConnection,
  refreshStravaToken,
  stravaAuthorizeUrl,
} from "../../src/modules/runs/strava/oauth";

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
  return Math.floor(Date.now() / 1000);
}

interface FakeApiCalls {
  refreshCalls: string[];
  deauthorizeCalls: string[];
}

function fakeApi(
  overrides: Partial<{
    exchangeCode: () => Promise<ExchangedTokens>;
    refreshToken: () => Promise<RefreshedTokens>;
    deauthorizeFails: boolean;
    refreshFails: boolean;
    refreshFailsTerminally: boolean;
  }> = {},
): StravaApi & FakeApiCalls {
  const refreshCalls: string[] = [];
  const deauthorizeCalls: string[] = [];
  return {
    refreshCalls,
    deauthorizeCalls,
    exchangeCode:
      overrides.exchangeCode ??
      (() =>
        Promise.resolve({
          // Unique per fixture: strava_connections.athlete_id is UNIQUE
          // (one athlete belongs to one user), and these tests share a
          // database within the file.
          athleteId: newUlid(),
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresAt: nowS() + 3600,
        })),
    async refreshToken(token: string) {
      refreshCalls.push(token);
      if (overrides.refreshFailsTerminally === true) {
        // What a revoked grant looks like: Strava rejects the token itself.
        throw new StravaApiError("Strava responded 401", true);
      }
      if (overrides.refreshFails === true) {
        // What a blip looks like: fetch itself failed, so not even a
        // StravaApiError.
        throw new Error("refresh failed");
      }
      if (overrides.refreshToken) return overrides.refreshToken();
      return { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: nowS() + 3600 };
    },
    deauthorize(accessToken: string) {
      deauthorizeCalls.push(accessToken);
      if (overrides.deauthorizeFails === true) {
        return Promise.reject(new Error("deauthorize failed"));
      }
      return Promise.resolve();
    },
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
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresAt: nowS() + 3600,
          }),
      }),
      userId,
      "auth-code",
    );

    const connection = await getStravaConnection(db, userId);
    expect(connection?.athleteId).toBe(athleteId);
    expect(connection?.status).toBe("ok");
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
            accessToken: "access-new",
            refreshToken: "refresh-new",
            expiresAt: nowS() + 7200,
          }),
      }),
      userId,
      "auth-code-2",
    );

    const connection = await getStravaConnection(db, userId);
    expect(connection?.athleteId).toBe("222");
    expect(connection?.accessToken).toBe("access-new");
  });
});

describe("refreshStravaToken (resilience: never loop on a dead grant)", () => {
  it("persists refreshed tokens on success", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    const result = await refreshStravaToken(db, fakeApi(), userId);

    expect(result).toBe("ok");
    const connection = await getStravaConnection(db, userId);
    expect(connection?.accessToken).toBe("access-2");
    expect(connection?.status).toBe("ok");
  });

  it("marks the connection broken immediately when Strava revokes the grant", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    const result = await refreshStravaToken(
      db,
      fakeApi({ refreshFailsTerminally: true }),
      userId,
    );

    expect(result).toBe("broken");
    const connection = await getStravaConnection(db, userId);
    expect(connection?.status).toBe("broken");
    expect(await unreadNotificationCount(db, userId)).toBe(1);
  });

  /**
   * The bug this policy exists for: one blip used to tell a user with a
   * perfectly good connection to go and reconnect it.
   */
  it("leaves a working connection alone through a transient failure", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    const result = await refreshStravaToken(
      db,
      fakeApi({ refreshFails: true }),
      userId,
    );

    expect(result).toBe("degraded");
    const connection = await getStravaConnection(db, userId);
    expect(connection?.status).toBe("ok");
    expect(connection?.refreshFailureCount).toBe(1);
    expect(await unreadNotificationCount(db, userId)).toBe(0);
  });

  it("does not break on repeated transient failures inside the window", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    // Three failures in quick succession — a short outage, not a
    // revocation. The count is reached but the window is not.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await refreshStravaToken(db, fakeApi({ refreshFails: true }), userId);
    }

    const connection = await getStravaConnection(db, userId);
    expect(connection?.status).toBe("ok");
    expect(connection?.refreshFailureCount).toBe(3);
    expect(await unreadNotificationCount(db, userId)).toBe(0);
  });

  it("breaks once failures have persisted past the window", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");
    await refreshStravaToken(db, fakeApi({ refreshFails: true }), userId);

    // Backdate the run of failures past the window: same count, but now it
    // has been going on long enough to stop retrying.
    await db
      .update(stravaConnections)
      .set({
        refreshFailureCount: 2,
        refreshFirstFailedAt: nowS() - 4 * 24 * 60 * 60,
      })
      .where(eq(stravaConnections.userId, userId));

    const result = await refreshStravaToken(
      db,
      fakeApi({ refreshFails: true }),
      userId,
    );

    expect(result).toBe("broken");
    const broken = await getStravaConnection(db, userId);
    expect(broken?.status).toBe("broken");

    // Deliberately NOT notified. A transient failure that never resolved
    // could be Strava being down for everyone, and telling a user to
    // reconnect then makes them break a working grant. A human hears about
    // it via Sentry instead.
    expect(await unreadNotificationCount(db, userId)).toBe(0);
  });

  it("clears the failure run on a later success", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");
    await refreshStravaToken(db, fakeApi({ refreshFails: true }), userId);
    const afterFailure = await getStravaConnection(db, userId);
    expect(afterFailure?.refreshFailureCount).toBe(1);

    await refreshStravaToken(db, fakeApi(), userId);

    const connection = await getStravaConnection(db, userId);
    expect(connection?.refreshFailureCount).toBe(0);
    expect(connection?.refreshFirstFailedAt).toBeNull();
    expect(connection?.status).toBe("ok");
  });

  it("reports not_connected when there's nothing to refresh", async () => {
    const db = coreDb();
    const result = await refreshStravaToken(db, fakeApi(), newUlid());
    expect(result).toBe("not_connected");
  });
});

describe("disconnectStrava", () => {
  /**
   * The revoke is queued, not called. The user's own action must not wait
   * on Strava (law 5), and the previous version swallowed a failed revoke
   * in a catch — leaving a live grant behind forever whenever Strava
   * happened to be down at that moment.
   */
  it("deletes the connection and queues the revoke", async () => {
    const db = coreDb();
    const userId = newUlid();
    const athleteId = newUlid();
    await db.insert(stravaConnections).values({
      userId,
      athleteId,
      accessToken: "access-live",
      refreshToken: "refresh-1",
      expiresAt: nowS() + 3600,
      status: "ok",
    });
    const queue = fakeRevokeQueue();

    await disconnectStrava(db, queue, userId);

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    expect(queue.sent).toEqual([
      { type: "strava_revoke", accessToken: "access-live" },
    ]);
  });

  it("deletes the local row even with no queue to revoke through", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    await disconnectStrava(db, undefined, userId);

    expect(await getStravaConnection(db, userId)).toBeUndefined();
  });

  it("is a no-op (besides being idempotent) when there is no connection", async () => {
    const db = coreDb();
    const queue = fakeRevokeQueue();
    await expect(
      disconnectStrava(db, queue, newUlid()),
    ).resolves.toBeUndefined();
    expect(queue.sent).toHaveLength(0);
  });
});
