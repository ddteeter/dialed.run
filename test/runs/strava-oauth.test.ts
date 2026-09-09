import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  notifications,
  stravaConnections,
  stravaRevocations,
} from "../../src/db/schema-core";
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
  stravaCallbackOutcome,
} from "../../src/modules/runs/strava/oauth";

/**
 * What a maintainer would see in Sentry.
 *
 * `captureException` is imported by the module rather than injected, and
 * with no DSN bound it writes `["[sentry-disabled]", context, error]` to
 * the console. That line is the only observable side of a report, so this
 * captures it. `stubGlobal`, not `spyOn(console, …)`: inside the workers
 * pool the console a test file holds is not the one a src module writes to.
 */
async function reportsDuring(
  work: () => Promise<void>,
): Promise<{ context: Record<string, string>; error: unknown }[]> {
  const lines: unknown[][] = [];
  vi.stubGlobal("console", {
    ...globalThis.console,
    error: (...args: unknown[]) => {
      lines.push(args);
    },
  });
  try {
    await work();
  } finally {
    vi.unstubAllGlobals();
  }
  return lines
    .filter((line) => line[0] === "[sentry-disabled]")
    .map((line) => ({
      context: line[1] as Record<string, string>,
      error: line[2],
    }));
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
  it("deletes the connection and records the revoke in one batch", async () => {
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

    // The durable half: the intent is a row, written with the delete.
    const [pending] = await db
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.accessToken, "access-live"));
    expect(pending?.accessToken).toBe("access-live");

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
    const token = `access-${newUlid()}`;
    await db.insert(stravaConnections).values({
      userId,
      athleteId: newUlid(),
      accessToken: token,
      refreshToken: "refresh-1",
      expiresAt: nowS() + 3600,
      status: "ok",
    });
    const failing = {
      sent: [] as unknown[],
      send: () => Promise.reject(new Error("queue unavailable")),
    };

    const reports = await reportsDuring(async () => {
      await expect(
        disconnectStrava(db, failing, userId),
      ).resolves.toBeUndefined();
    });

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    // Scoped to this test's token: these tests share a database, so a
    // bare count would pick up rows other cases left behind.
    const rows = await db
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.accessToken, token));
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

    const reports = await reportsDuring(async () => {
      await disconnectStrava(db, undefined, userId);
    });

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    // No queue is a configuration, not a failure — nothing to report.
    expect(reports).toHaveLength(0);
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

describe("completeStravaConnect writes every token it was given", () => {
  it("stores the athlete, both tokens and the expiry", async () => {
    const db = coreDb();
    const userId = newUlid();

    await completeStravaConnect(
      db,
      fakeApi({
        exchangeCode: () =>
          Promise.resolve({
            athleteId: `athlete-${newUlid()}`,
            accessToken: "access-9",
            refreshToken: "refresh-9",
            expiresAt: 1_768_485_600,
          }),
      }),
      userId,
      "the-code",
    );

    expect(await getStravaConnection(db, userId)).toMatchObject({
      accessToken: "access-9",
      refreshToken: "refresh-9",
      expiresAt: 1_768_485_600,
      status: "ok",
    });
  });

  it("stamps the connection's expiry in epoch seconds", async () => {
    // `expires_at` from Strava is already epoch seconds; storing anything
    // else makes every refresh look overdue or never due.
    const db = coreDb();
    const userId = newUlid();
    const expiresAt = nowS() + 3600;

    await completeStravaConnect(
      db,
      fakeApi({
        exchangeCode: () =>
          Promise.resolve({
            athleteId: `athlete-${newUlid()}`,
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt,
          }),
      }),
      userId,
      "code",
    );

    const connection = await getStravaConnection(db, userId);
    expect(connection?.expiresAt).toBe(expiresAt);
  });

  it("clears a broken status when the user reconnects", async () => {
    // Reconnecting is the only way out of `broken`, so the upsert has to
    // set the status rather than leaving whatever was there.
    const db = coreDb();
    const userId = newUlid();
    const freshAthlete = `athlete-${newUlid()}`;
    await db.insert(stravaConnections).values({
      userId,
      athleteId: `athlete-old-${newUlid()}`,
      accessToken: "access-old",
      refreshToken: "refresh-old",
      expiresAt: nowS() - 10,
      status: "broken",
      refreshFailureCount: 3,
    });

    await completeStravaConnect(
      db,
      fakeApi({
        exchangeCode: () =>
          Promise.resolve({
            athleteId: freshAthlete,
            accessToken: "access-new",
            refreshToken: "refresh-new",
            expiresAt: nowS() + 3600,
          }),
      }),
      userId,
      "code",
    );

    const connection = await getStravaConnection(db, userId);
    expect(connection?.status).toBe("ok");
    expect(connection?.athleteId).toBe(freshAthlete);
    expect(connection?.accessToken).toBe("access-new");
  });
});

describe("disconnectStrava when there is nothing connected", () => {
  it("does nothing to revoke, and does not fail", async () => {
    // Pressing disconnect twice, or on an account that never connected.
    const db = coreDb();
    const queue = fakeRevokeQueue();

    await disconnectStrava(db, queue, newUlid());

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
      accessToken: "access-noqueue",
      refreshToken: "refresh",
      expiresAt: nowS() + 3600,
      status: "ok",
    });

    await disconnectStrava(db, undefined, userId);

    expect(await getStravaConnection(db, userId)).toBeUndefined();
    const [pending] = await db
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.accessToken, "access-noqueue"));
    expect(pending).toBeDefined();
  });
});

async function connectionThatHasBeenFailing(overrides: {
  status?: "ok" | "broken";
  refreshFailureCount?: number;
  refreshFirstFailedAt?: number;
}): Promise<string> {
  const db = coreDb();
  const userId = newUlid();
  await db.insert(stravaConnections).values({
    userId,
    athleteId: newUlid(),
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: nowS() - 10,
    status: overrides.status ?? "ok",
    refreshFailureCount: overrides.refreshFailureCount ?? 0,
    refreshFirstFailedAt: overrides.refreshFirstFailedAt,
  });
  return userId;
}

describe("refreshStravaToken: who hears about a broken connection", () => {

  it("tells the user when Strava says the grant is dead", async () => {
    // A terminal failure is per-user and true, so the user is told — once,
    // on the ok -> broken transition.
    const db = coreDb();
    const userId = await connectionThatHasBeenFailing({ status: "ok" });

    let result;
    const reports = await reportsDuring(async () => {
      result = await refreshStravaToken(
        db,
        fakeApi({ refreshFailsTerminally: true }),
        userId,
      );
    });

    expect(result).toBe("broken");
    expect(await unreadNotificationCount(db, userId)).toBe(1);

    // The runner reads this sentence, so it is pinned: it has to name the
    // action they can take, and it is the only record they get.
    const [told] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId));
    expect(told?.kind).toBe("strava_broken");
    expect(told?.body).toBe("Your Strava connection needs to be reconnected.");

    // And nobody is paged: a dead grant is the user's to fix, not ours.
    expect(reports).toHaveLength(0);
  });

  it("does not tell them twice for a connection already broken", async () => {
    const db = coreDb();
    const userId = await connectionThatHasBeenFailing({ status: "broken" });

    await refreshStravaToken(
      db,
      fakeApi({ refreshFailsTerminally: true }),
      userId,
    );

    expect(await unreadNotificationCount(db, userId)).toBe(0);
  });

  it("tells nobody but a maintainer when the failures are only exhausted", async () => {
    // Strava down, our config wrong, a network partition — all ambiguous.
    // Telling a runner to reconnect then is worse than saying nothing:
    // they would disconnect a working account to fix a problem that was
    // never theirs.
    const db = coreDb();
    const userId = await connectionThatHasBeenFailing({
      status: "ok",
      refreshFailureCount: 2,
      refreshFirstFailedAt: nowS() - 4 * 24 * 60 * 60,
    });

    let result;
    const reports = await reportsDuring(async () => {
      result = await refreshStravaToken(db, fakeApi({ refreshFails: true }), userId);
    });

    expect(result).toBe("broken");
    expect(await unreadNotificationCount(db, userId)).toBe(0);
    expect(await getStravaConnection(db, userId)).toMatchObject({
      status: "broken",
    });

    // Law 6: the failure lands where a human eventually sees it, with
    // enough context to tell an outage from a config mistake.
    expect(reports).toHaveLength(1);
    expect((reports[0]?.error as Error).message).toBe(
      "strava refresh exhausted without a 4xx",
    );
    expect(reports[0]?.context).toStrictEqual({
      userId,
      failureCount: "3",
      firstFailedAt: String(nowS() - 4 * 24 * 60 * 60),
    });
  });

  it("does not page a maintainer twice for the same broken connection", async () => {
    // The transition is the guard here too. A connection already marked
    // broken keeps failing on every cron pass, and one ambiguous outage
    // must not become a report per pass.
    const db = coreDb();
    const userId = await connectionThatHasBeenFailing({
      status: "broken",
      refreshFailureCount: 2,
      refreshFirstFailedAt: nowS() - 4 * 24 * 60 * 60,
    });

    const reports = await reportsDuring(async () => {
      await refreshStravaToken(db, fakeApi({ refreshFails: true }), userId);
    });

    expect(reports).toHaveLength(0);
  });

  it("needs both the count and the window, not either", async () => {
    // Three failures inside one short outage must not break a connection,
    // and neither must one failure that happens to be old.
    const db = coreDb();
    const manyButRecent = await connectionThatHasBeenFailing({
      refreshFailureCount: 5,
      refreshFirstFailedAt: nowS() - 60,
    });
    const oldButFew = await connectionThatHasBeenFailing({
      refreshFailureCount: 1,
      refreshFirstFailedAt: nowS() - 30 * 24 * 60 * 60,
    });

    expect(
      await refreshStravaToken(db, fakeApi({ refreshFails: true }), manyButRecent),
    ).toBe("degraded");
    expect(
      await refreshStravaToken(db, fakeApi({ refreshFails: true }), oldButFew),
    ).toBe("degraded");
  });

  it("gives up at exactly three days, not a moment before", async () => {
    const db = coreDb();
    const threeDays = 3 * 24 * 60 * 60;
    const atTheLimit = await connectionThatHasBeenFailing({
      refreshFailureCount: 2,
      refreshFirstFailedAt: nowS() - threeDays,
    });
    const justInside = await connectionThatHasBeenFailing({
      refreshFailureCount: 2,
      refreshFirstFailedAt: nowS() - threeDays + 60,
    });

    expect(
      await refreshStravaToken(db, fakeApi({ refreshFails: true }), atTheLimit),
    ).toBe("broken");
    expect(
      await refreshStravaToken(db, fakeApi({ refreshFails: true }), justInside),
    ).toBe("degraded");
  });

  it("remembers when the failures started, not when the last one was", async () => {
    // The window is measured from the first failure of the run. Resetting
    // it on every failure means a connection that fails daily is never
    // called broken.
    const db = coreDb();
    const firstFailedAt = nowS() - 2 * 24 * 60 * 60;
    const userId = await connectionThatHasBeenFailing({
      refreshFailureCount: 1,
      refreshFirstFailedAt: firstFailedAt,
    });

    await refreshStravaToken(db, fakeApi({ refreshFails: true }), userId);

    const connection = await getStravaConnection(db, userId);
    expect(connection?.refreshFirstFailedAt).toBe(firstFailedAt);
    expect(connection?.refreshFailureCount).toBe(2);
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
    ["no cookie to compare against", { expectedState: undefined, state, code: "c" }],
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
      stravaCallbackOutcome({ expectedState: undefined, error: "access_denied" }),
    ).toMatchObject({ reason: "Strava connection was cancelled." });
  });
});
