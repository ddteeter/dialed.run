import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  reviewQueue,
  userProfiles,
  usernameHistory,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  RESCREEN_CAP,
  RESCREEN_LEASE_S,
  rescreenHandles,
  rescreenHandlesFromEnv,
  rescreenWithKey,
  type Rescreen,
} from "../../src/modules/account/handle-rescreen";
import type { ScreenHandle } from "../../src/modules/account/handle-screen";
import { claimUsername, forceRename } from "../../src/modules/account/username";

/**
 * The handle re-ask (task 126 PR B): a claim moderation could not answer
 * is stored `unknown`, and the `:15` firing asks again until it answers.
 */
const db = drizzle(env.DIALED_CORE);

beforeEach(async () => {
  await db.batch([
    db.delete(userProfiles),
    db.delete(usernameHistory),
    db.delete(reviewQueue),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const UNKNOWN: ScreenHandle = () => Promise.resolve("unknown");

/**
A re-ask that answers `verdict` and remembers what it was asked, and for whom.
*/
function answering(verdict: "clear" | "flagged" | "unknown") {
  const asked: { handle: string; userId: string }[] = [];
  const rescreen: Rescreen = (handle, userId) => {
    asked.push({ handle, userId });
    return Promise.resolve(verdict);
  };
  return { asked, rescreen };
}

/**
A runner whose claim of `handle` moderation could not answer.
*/
async function claimedDuringOutage(handle: string): Promise<string> {
  const userId = newUlid();
  const claim = await claimUsername(db, userId, handle, UNKNOWN);
  expect(claim).toStrictEqual({ kind: "claimed", username: handle });
  return userId;
}

async function screenOf(userId: string) {
  const [row] = await db
    .select({
      username: userProfiles.username,
      screen: userProfiles.usernameScreen,
      at: userProfiles.usernameScreenedAt,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return row;
}

function byId(a: string, b: string): number {
  return a.localeCompare(b);
}

async function stateOf(userId: string) {
  const row = await screenOf(userId);
  return row?.screen;
}

async function reviewRows() {
  return db
    .select({
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      source: reviewQueue.source,
      status: reviewQueue.status,
    })
    .from(reviewQueue);
}

describe("the claim records what moderation said", () => {
  it("records unknown for a claim during an outage, with when", async () => {
    const before = nowSeconds();
    const userId = await claimedDuringOutage("quiet_mile");
    const row = await screenOf(userId);
    expect(row?.screen).toBe("unknown");
    expect(row?.at).toBeGreaterThanOrEqual(before);
  });

  it("records clear when it answered", async () => {
    const userId = newUlid();
    await claimUsername(db, userId, "quiet_mile", () =>
      Promise.resolve("clear"),
    );
    expect(await stateOf(userId)).toBe("clear");
  });

  it("clears it for a moderator's placeholder, which nobody typed", async () => {
    const userId = await claimedDuringOutage("quiet_mile");
    const renamed = await forceRename(db, {
      userId,
      typed: "runner_0042",
      reason: "Advertising",
      recordedAs: () => db.select().from(userProfiles).limit(0),
    });
    expect(renamed).toStrictEqual({ kind: "renamed", username: "runner_0042" });
    const row = await screenOf(userId);
    expect(row?.username).toBe("runner_0042");
    expect(row?.screen).toBeNull();
    expect(row?.at).toBeNull();
  });
});

describe("rescreenHandles", () => {
  it("clears an unknown handle once moderation answers, and stops asking", async () => {
    const userId = await claimedDuringOutage("quiet_mile");
    const { asked, rescreen } = answering("clear");
    const anomalies: string[] = [];

    await rescreenHandles(db, rescreen, anomalies, 5000);
    await rescreenHandles(db, rescreen, anomalies, 9000);

    expect(asked).toStrictEqual([{ handle: "quiet_mile", userId }]);
    expect(await screenOf(userId)).toStrictEqual({
      username: "quiet_mile",
      screen: "clear",
      at: 5000,
    });
    expect(anomalies).toStrictEqual([]);
    expect(await reviewRows()).toStrictEqual([]);
  });

  it("sends a flagged handle to the Desk's review queue, and renames nothing", async () => {
    const userId = await claimedDuringOutage("quiet_mile");
    const { rescreen } = answering("flagged");

    await rescreenHandles(db, rescreen, [], 5000);

    expect(await screenOf(userId)).toStrictEqual({
      username: "quiet_mile",
      screen: "flagged",
      at: 5000,
    });
    expect(await reviewRows()).toStrictEqual([
      {
        subjectType: "profile",
        subjectId: userId,
        source: "classifier",
        status: "pending",
      },
    ]);
  });

  it("gives an unanswered handle back for the next hour, saying how many and never which", async () => {
    const userId = await claimedDuringOutage("quiet_mile");
    await claimedDuringOutage("long_run");
    const { asked, rescreen } = answering("unknown");
    const anomalies: string[] = [];

    await rescreenHandles(db, rescreen, anomalies, 5000);
    expect(await screenOf(userId)).toStrictEqual({
      username: "quiet_mile",
      screen: "unknown",
      at: 5000,
    });
    expect(anomalies).toStrictEqual([
      "2 handle(s) still unscreened: moderation did not answer",
    ]);

    await rescreenHandles(db, rescreen, [], 9000);
    expect(asked).toHaveLength(4);
  });

  it("asks about each handle once when two firings overlap", async () => {
    const ids = await Promise.all(
      ["one_mile", "two_mile", "three_mile"].map((handle) =>
        claimedDuringOutage(handle),
      ),
    );
    const { asked, rescreen } = answering("clear");

    await Promise.all([
      rescreenHandles(db, rescreen, [], 5000),
      rescreenHandles(db, rescreen, [], 5000),
    ]);

    expect(asked.map((ask) => ask.userId).toSorted(byId)).toStrictEqual(
      ids.toSorted(byId),
    );
  });

  it("leaves a live claim alone and takes back one whose lease ran out", async () => {
    const live = await claimedDuringOutage("live_claim");
    const lapsed = await claimedDuringOutage("lapsed_claim");
    const now = 100_000;
    await db
      .update(userProfiles)
      .set({ usernameScreen: "checking", usernameScreenedAt: now - 60 })
      .where(eq(userProfiles.userId, live));
    await db
      .update(userProfiles)
      .set({
        usernameScreen: "checking",
        usernameScreenedAt: now - RESCREEN_LEASE_S - 1,
      })
      .where(eq(userProfiles.userId, lapsed));
    const { asked, rescreen } = answering("clear");

    await rescreenHandles(db, rescreen, [], now);

    expect(asked).toStrictEqual([{ handle: "lapsed_claim", userId: lapsed }]);
    expect(await stateOf(live)).toBe("checking");
  });

  it("takes back a claim exactly one lease old, and not a second sooner", async () => {
    const userId = await claimedDuringOutage("edge_claim");
    await db
      .update(userProfiles)
      .set({ usernameScreen: "checking", usernameScreenedAt: 1000 })
      .where(eq(userProfiles.userId, userId));
    const { asked, rescreen } = answering("clear");

    await rescreenHandles(db, rescreen, [], 1000 + RESCREEN_LEASE_S);
    expect(asked).toStrictEqual([]);
    await rescreenHandles(db, rescreen, [], 1001 + RESCREEN_LEASE_S);
    expect(asked).toHaveLength(1);
  });

  it(`asks about at most ${String(RESCREEN_CAP)} handles a firing`, async () => {
    await Promise.all(
      Array.from({ length: RESCREEN_CAP + 3 }, (_, n) =>
        claimedDuringOutage(`runner_${String(n)}`),
      ),
    );
    const { asked, rescreen } = answering("clear");

    await rescreenHandles(db, rescreen, [], 5000);
    expect(asked).toHaveLength(RESCREEN_CAP);
    await rescreenHandles(db, rescreen, [], 5001);
    expect(asked).toHaveLength(RESCREEN_CAP + 3);
  });

  it("never asks about a handle that was answered, or never asked", async () => {
    const answered = newUlid();
    await claimUsername(db, answered, "answered", () =>
      Promise.resolve("clear"),
    );
    await db.insert(userProfiles).values({ userId: newUlid(), username: "old" });
    const { asked, rescreen } = answering("flagged");

    await rescreenHandles(db, rescreen, [], 5000);
    expect(asked).toStrictEqual([]);
  });

  it.each(["clear", "flagged"] as const)(
    "writes a %s answer about a handle the runner has since changed nowhere",
    async (verdict) => {
      const userId = await claimedDuringOutage("first_pick");
      const rescreen: Rescreen = async () => {
        // The runner picks again while the old handle is being asked about.
        await claimUsername(db, userId, "second_pick", UNKNOWN);
        return verdict;
      };

      await rescreenHandles(db, rescreen, [], 5000);

      const row = await screenOf(userId);
      expect(row?.username).toBe("second_pick");
      expect(row?.screen).toBe("unknown");
      expect(await reviewRows()).toStrictEqual([]);
    },
  );
});

describe("rescreenHandlesFromEnv", () => {
  it("asks the deployment's moderation and reports a failure by runner, never by handle", async () => {
    const userId = await claimedDuringOutage("quiet_mile");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {
      // Sentry is disabled in tests and logs instead; read it here.
    });
    const anomalies: string[] = [];

    await rescreenHandlesFromEnv(anomalies);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await stateOf(userId)).toBe("unknown");
    expect(logged).toHaveBeenCalledWith(
      "[sentry-disabled]",
      { surface: "handle-rescreen", userId },
      expect.any(Error),
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain("quiet");
    expect(anomalies).toHaveLength(1);
  });

  it.each([undefined, ""])(
    "claims nothing with no key (%j): the handles wait for one",
    async (apiKey) => {
      const userId = await claimedDuringOutage("quiet_mile");
      // An old timestamp that `now` (whatever it is) would never produce,
      // so a claim-and-release that stamps `now()` is distinguishable from
      // the guard returning before any row is touched.
      await db
        .update(userProfiles)
        .set({ usernameScreenedAt: 1000 })
        .where(eq(userProfiles.userId, userId));
      const before = await screenOf(userId);
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const anomalies: string[] = [];

      await rescreenWithKey(db, apiKey, anomalies);

      expect(fetchSpy).not.toHaveBeenCalled();
      const after = await screenOf(userId);
      expect(after).toStrictEqual(before);
      expect(after?.at).toBe(1000);
      expect(anomalies).toStrictEqual([]);
    },
  );

  it("flags through the deployment's moderation", async () => {
    const userId = await claimedDuringOutage("quiet_mile");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ results: [{ flagged: true }] }),
    );

    await rescreenHandlesFromEnv([]);

    const [row] = await db
      .select({ id: reviewQueue.id })
      .from(reviewQueue)
      .where(
        and(
          eq(reviewQueue.subjectType, "profile"),
          eq(reviewQueue.subjectId, userId),
        ),
      );
    expect(row).toBeDefined();
  });
});
