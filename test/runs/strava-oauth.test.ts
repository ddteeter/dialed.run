import { describe, expect, it } from "vitest";

import { stravaConnections } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import { unreadNotificationCount } from "../../src/modules/runs/notifications";
import type {
  ExchangedTokens,
  RefreshedTokens,
  StravaApi,
} from "../../src/modules/runs/strava/api";
import {
  completeStravaConnect,
  disconnectStrava,
  getStravaConnection,
  refreshStravaToken,
  stravaAuthorizeUrl,
} from "../../src/modules/runs/strava/oauth";

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
          athleteId: "111",
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresAt: nowS() + 3600,
        })),
    async refreshToken(token: string) {
      refreshCalls.push(token);
      if (overrides.refreshFails === true) {
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
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    const connection = await getStravaConnection(db, userId);
    expect(connection?.athleteId).toBe("111");
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

  it("marks the connection broken and notifies once on refresh failure", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    const result = await refreshStravaToken(
      db,
      fakeApi({ refreshFails: true }),
      userId,
    );

    expect(result).toBe("broken");
    const connection = await getStravaConnection(db, userId);
    expect(connection?.status).toBe("broken");
    expect(await unreadNotificationCount(db, userId)).toBe(1);

    // A second failed refresh doesn't double-notify (dedupe subject = userId).
    await refreshStravaToken(db, fakeApi({ refreshFails: true }), userId);
    expect(await unreadNotificationCount(db, userId)).toBe(1);
  });

  it("reports not_connected when there's nothing to refresh", async () => {
    const db = coreDb();
    const result = await refreshStravaToken(db, fakeApi(), newUlid());
    expect(result).toBe("not_connected");
  });
});

describe("disconnectStrava", () => {
  it("deletes the connection and revokes without refreshing when the token is live", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");
    const api = fakeApi();

    await disconnectStrava(db, api, userId);

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    expect(api.deauthorizeCalls).toEqual(["access-1"]);
    expect(api.refreshCalls).toHaveLength(0);
  });

  it("refreshes first when the stored token has expired, then revokes", async () => {
    const db = coreDb();
    const userId = newUlid();
    await db.insert(stravaConnections).values({
      userId,
      athleteId: "111",
      accessToken: "access-expired",
      refreshToken: "refresh-1",
      expiresAt: nowS() - 10,
      status: "ok",
    });
    const api = fakeApi();

    await disconnectStrava(db, api, userId);

    expect(api.refreshCalls).toEqual(["refresh-1"]);
    expect(api.deauthorizeCalls).toEqual(["access-2"]);
    expect(await getStravaConnection(db, userId)).toBeUndefined();
  });

  it("still deletes the local row when the upstream revoke fails (law 5)", async () => {
    const db = coreDb();
    const userId = newUlid();
    await completeStravaConnect(db, fakeApi(), userId, "auth-code");

    await disconnectStrava(db, fakeApi({ deauthorizeFails: true }), userId);

    expect(await getStravaConnection(db, userId)).toBeUndefined();
  });

  it("is a no-op (besides being idempotent) when there is no connection", async () => {
    const db = coreDb();
    await expect(
      disconnectStrava(db, fakeApi(), newUlid()),
    ).resolves.toBeUndefined();
  });
});
