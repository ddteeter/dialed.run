import { eq, inArray } from "drizzle-orm";
import { forgetMaker } from "../../src/modules/products";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  accountDeletions,
  outfitEntries,
  runs,
} from "../../src/db/schema-core";
import { manualConditions } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  PURGE_LEASE_S,
  PURGE_PER_ROUND,
  PURGE_RUNS_PAGE,
  PURGE_RUNS_PER_FIRING,
  purgeDueAccounts,
} from "../../src/modules/account/purge/purge";
import type { PurgeDeps } from "../../src/modules/account/purge/purge";
import { forgetManualBands } from "../../src/modules/weather";
import { runnerCacheTag } from "../../src/lib/cache-tags";
import { purgeSpy } from "../purge-spy";

/**
 * The purge deletes a runner's runs a page at a time, under one bound
 * for the whole firing: what is left keeps its claim for the next one.
 */

const core = drizzle(env.DIALED_CORE);
const weather = drizzle(env.DIALED_WEATHER);
const NOW = 1_780_000_000;

interface Firing {
  readonly deps: PurgeDeps;
  readonly handed: number[];
  readonly reported: unknown[];
  readonly purged: string[][];
}

function firingAt(
  now: number,
  runPages: { page: number; perFiring: number },
): Firing {
  const handed: number[] = [];
  const reported: unknown[] = [];
  const { purge, calls } = purgeSpy();
  return {
    handed,
    reported,
    purged: calls,
    deps: {
      core,
      forgetBands: async (runIds) => {
        handed.push(runIds.length);
        await forgetManualBands(runIds);
      },
      revokeStrava: () => Promise.resolve(),
      importsBucket: env.IMPORTS,
      report: (error) => {
        reported.push(error);
      },
      now,
      runPages,
      forgetMaker,
      purgePages: purge,
    },
  };
}

/**
An account due for its purge, with `count` runs, each with a band.
*/
async function dueAccount(count: number): Promise<string> {
  const userId = newUlid();
  const at = new Date(NOW * 1000);
  await core.insert(user).values({
    id: userId,
    name: "Runner",
    email: `${userId.toLowerCase()}@example.test`,
    emailVerified: true,
    createdAt: at,
    updatedAt: at,
  });
  await core.insert(accountDeletions).values({
    userId,
    requestedAt: NOW - 8 * 86_400,
    purgeAfter: NOW - 1,
  });
  for (let index = 0; index < count; index += 1) {
    const runId = newUlid();
    await core.insert(runs).values({
      id: runId,
      userId,
      source: "manual",
      startedAt: NOW - 86_400 - index * 3600,
      durationS: 1800,
      distanceM: 5000,
      indoor: true,
      title: "Run",
      weatherStatus: "none",
    });
    await weather
      .insert(manualConditions)
      .values({ runId, tempC: 10, setAt: NOW });
  }
  return userId;
}

async function runIdsOf(userId: string): Promise<string[]> {
  const rows = await core
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.userId, userId));
  return rows.map((row) => row.id);
}

function byId(a: string, b: string): number {
  return a.localeCompare(b);
}

beforeEach(async () => {
  await core.delete(accountDeletions);
});

describe("the purge's run pages", () => {
  it("are 400 runs, and 8,000 a firing", () => {
    expect(PURGE_RUNS_PAGE).toBe(400);
    expect(PURGE_RUNS_PER_FIRING).toBe(8000);
  });

  it("delete a bounded number of runs a firing, keep the claim, report nothing, and the next firing finishes", async () => {
    const userId = await dueAccount(7);
    const first = firingAt(NOW, { page: 2, perFiring: 3 });
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, first.deps);

    expect(first.handed).toStrictEqual([2, 1]);
    expect(await runIdsOf(userId)).toHaveLength(4);
    expect(
      await core
        .select({ userId: accountDeletions.userId })
        .from(accountDeletions),
    ).toStrictEqual([{ userId }]);
    expect(first.reported).toStrictEqual([]);
    expect(anomalies).toStrictEqual([
      "1 account deletion(s) are part way through and continue on the next firing",
    ]);

    const next = firingAt(NOW + PURGE_LEASE_S + 1, { page: 2, perFiring: 10 });
    await purgeDueAccounts([], next.deps);

    expect(next.handed).toStrictEqual([2, 2]);
    expect(await runIdsOf(userId)).toStrictEqual([]);
    expect(
      await core.select().from(user).where(eq(user.id, userId)),
    ).toStrictEqual([]);
    expect(await core.select().from(accountDeletions)).toStrictEqual([]);
  });

  it("forget the band of every run they delete, and only those", async () => {
    const userId = await dueAccount(5);
    const before = await runIdsOf(userId);

    await purgeDueAccounts([], firingAt(NOW, { page: 2, perFiring: 2 }).deps);

    const left = await runIdsOf(userId);
    const bands = await weather
      .select({ runId: manualConditions.runId })
      .from(manualConditions)
      .where(inArray(manualConditions.runId, before));
    expect(bands.map((band) => band.runId).toSorted(byId)).toStrictEqual(
      left.toSorted(byId),
    );
    expect(left).toHaveLength(3);
  });

  it("delete the entries on the runs they delete, and only those", async () => {
    const userId = await dueAccount(5);
    const runIds = await runIdsOf(userId);
    await core.insert(outfitEntries).values(
      runIds.map((runId) => ({
        id: newUlid(),
        runId,
        userId,
        createdAt: NOW,
      })),
    );

    await purgeDueAccounts([], firingAt(NOW, { page: 2, perFiring: 2 }).deps);

    const entries = await core
      .select({ runId: outfitEntries.runId })
      .from(outfitEntries)
      .where(eq(outfitEntries.userId, userId));
    const left = await runIdsOf(userId);
    expect(entries.map((entry) => entry.runId).toSorted(byId)).toStrictEqual(
      left.toSorted(byId),
    );
    expect(left).toHaveLength(3);
  });

  it("share one bound across every account the firing purges", async () => {
    const first = await dueAccount(3);
    const second = await dueAccount(3);
    const firing = firingAt(NOW, { page: 10, perFiring: 4 });
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, firing.deps);

    expect(firing.handed.reduce((sum, n) => sum + n, 0)).toBe(4);
    const left = [...(await runIdsOf(first)), ...(await runIdsOf(second))];
    expect(left).toHaveLength(2);
    expect(anomalies).toContain(
      "1 account deletion(s) are part way through and continue on the next firing",
    );
  });

  it("claim no further round once the bound is spent", async () => {
    for (let index = 0; index <= PURGE_PER_ROUND; index += 1) {
      await dueAccount(1);
    }
    const firing = firingAt(NOW, { page: 10, perFiring: PURGE_PER_ROUND });

    await purgeDueAccounts([], firing.deps);

    expect(firing.handed).toStrictEqual(
      Array.from({ length: PURGE_PER_ROUND }, () => 1),
    );
    // The first round's last account is left part way, holding its claim;
    // the one past the round is never claimed.
    const claims = await core
      .select({ startedAt: accountDeletions.purgeStartedAt })
      .from(accountDeletions);
    expect(claims).toHaveLength(2);
    expect(claims.filter((claim) => claim.startedAt === NOW)).toHaveLength(1);
  });

  it("finish an account whose runs end exactly on the bound on the next firing", async () => {
    const userId = await dueAccount(2);

    await purgeDueAccounts([], firingAt(NOW, { page: 2, perFiring: 2 }).deps);
    expect(await runIdsOf(userId)).toStrictEqual([]);

    const next = firingAt(NOW + PURGE_LEASE_S + 1, { page: 2, perFiring: 2 });
    await purgeDueAccounts([], next.deps);

    expect(next.handed).toStrictEqual([]);
    expect(await core.select().from(accountDeletions)).toStrictEqual([]);
  });

  it("purge the runner's pages once, after their last page", async () => {
    const userId = await dueAccount(5);
    const firing = firingAt(NOW, { page: 2, perFiring: 10 });

    await purgeDueAccounts([], firing.deps);

    expect(firing.handed).toStrictEqual([2, 2, 1]);
    expect(firing.purged).toStrictEqual([[runnerCacheTag(userId)]]);
  });

  it("purge an account a firing leaves part way once, on the firing that finishes it", async () => {
    const userId = await dueAccount(5);
    const first = firingAt(NOW, { page: 2, perFiring: 3 });

    await purgeDueAccounts([], first.deps);

    expect(first.handed).toStrictEqual([2, 1]);
    expect(first.purged).toStrictEqual([]);

    const next = firingAt(NOW + PURGE_LEASE_S + 1, { page: 2, perFiring: 10 });
    await purgeDueAccounts([], next.deps);

    expect(next.handed).toStrictEqual([2]);
    expect(next.purged).toStrictEqual([[runnerCacheTag(userId)]]);
  });
});
