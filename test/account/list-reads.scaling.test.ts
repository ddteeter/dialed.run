import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  accessRequests,
  entryPhotos,
  entryTags,
  inviteCodes,
  inviteRedemptions,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { accountCount, listAccounts } from "../../src/modules/account/accounts";
import { exportData } from "../../src/modules/account/export";
import { accessDesk } from "../../src/modules/account/invites";
import { deskRunners, runnersWhere } from "../../src/modules/safety";
import { cacheKeyFor } from "../../src/modules/weather";

import { queryCounts, type QueryCounts } from "../d1-spy";
import { makeEntry, makeItem, makeRun, makeUser, NOW } from "../feed/helpers";

/**
 * Design 182: the account lists ask D1 the same number of statements for
 * 1 row as for 25. Rows read may grow; the statement count may not.
 */

const core = () => drizzle(env.DIALED_CORE);
const weather = () => drizzle(env.DIALED_WEATHER);
const LAT = 44.98;
const LNG = -93.27;

async function counted<T>(
  read: () => Promise<T>,
): Promise<{ counts: QueryCounts; result: T }> {
  let result: T | undefined;
  const counts = await queryCounts(async () => {
    result = await read();
  });
  if (result === undefined) throw new Error("the read returned nothing");
  return { counts, result };
}

function expectFlat(one: QueryCounts, many: QueryCounts): void {
  expect(many.core).toBe(one.core);
  expect(many.weather).toBe(one.weather);
  expect(many.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
}

/**
An account row, as Better Auth would have made it, with a profile.
*/
async function account(index: number): Promise<string> {
  const userId = await makeUser();
  await core()
    .insert(user)
    .values({
      id: userId,
      name: "",
      email: `r${String(index)}-${userId.toLowerCase()}@example.test`,
      emailVerified: true,
      createdAt: new Date((NOW + index) * 1000),
      updatedAt: new Date((NOW + index) * 1000),
    });
  return userId;
}

beforeEach(async () => {
  await core().batch([
    core().delete(user),
    core().delete(userProfiles),
    core().delete(runs),
    core().delete(inviteCodes),
    core().delete(inviteRedemptions),
    core().delete(accessRequests),
  ]);
});

/**
The Desk's runner page as its loader reads it: the accounts, their runners' facts, and the header count.
*/
async function deskPage() {
  const accounts = await listAccounts(core(), {
    query: undefined,
    only: runnersWhere("all"),
  });
  const [runners, total] = await Promise.all([
    deskRunners(core(), accounts),
    accountCount(core()),
  ]);
  return { runners, total };
}

/**
`n` accounts, each with a run, and the runner page counted.
*/
async function seededDesk(n: number) {
  await core().delete(user);
  await core().delete(userProfiles);
  await core().delete(runs);
  for (let index = 0; index < n; index += 1) {
    const userId = await account(index);
    await makeRun({ userId });
  }
  return counted(deskPage);
}

describe("the Desk's runner list (listAccounts + deskRunners + accountCount)", () => {
  // A legitimate formula: 1 list + 5 reads per `IN_LIST_CHUNK` (80,
  // src/lib/chunked.ts) of listed accounts (`deskRunners`: runs, profile
  // reports, profiles, pending deletions, open flags) + 1 count. A page is
  // at most `ACCOUNTS_PAGE` (100, src/modules/account/accounts.ts), so
  // 1 + 5×2 + 1 at most; 1 and 25 accounts are both one chunk.
  it("asks 1 + 5 + 1 for 1 account and for 25", async () => {
    const one = await seededDesk(1);
    const many = await seededDesk(25);

    expect(one.result.runners).toHaveLength(1);
    expect(many.result.runners).toHaveLength(25);
    expect(many.result.total).toBe(25);
    expect(one.counts.core).toBe(1 + 5 + 1);
    expectFlat(one.counts, many.counts);
  });
});

/**
`n` access requests and `n` codes, each spent once, and the access desk counted.
*/
async function seededAccess(n: number) {
  await core().delete(inviteCodes);
  await core().delete(inviteRedemptions);
  await core().delete(accessRequests);
  await core().delete(user);
  await core().delete(userProfiles);
  for (let index = 0; index < n; index += 1) {
    await core()
      .insert(accessRequests)
      .values({
        id: newUlid(),
        email: `ask-${String(index)}@example.test`,
        createdAt: NOW + index,
        updatedAt: NOW + index,
      });
    const codeId = newUlid();
    await core()
      .insert(inviteCodes)
      .values({ id: codeId, code: `DIAL-${String(index)}`, createdAt: NOW });
    const userId = await account(index);
    await core()
      .insert(inviteRedemptions)
      .values({
        userId,
        codeId,
        email: `r${String(index)}@example.test`,
        heldUntil: NOW + 3600,
        redeemedAt: NOW + index,
      });
  }
  return counted(async () => accessDesk(core()));
}

/**
 * A runner with `n` runs, each with an entry, a tag, a photo and a
 * garment, every run at the same place and hour so one observation
 * answers them all; their export counted.
 */
async function seededExport(n: number) {
  const userId = await account(0);
  for (let index = 0; index < n; index += 1) {
    const runId = await makeRun({ userId, lat: LAT, lng: LNG });
    const itemId = await makeItem({ userId });
    const entryId = await makeEntry({ userId, runId, itemIds: [itemId] });
    await core().insert(entryTags).values({ entryId, tag: "easy" });
    await core()
      .insert(entryPhotos)
      .values({
        id: newUlid(),
        entryId,
        photoKey: `entries/${userId}/${entryId}/p`,
        position: 0,
      });
  }
  return counted(async () => exportData(core(), userId));
}

describe("accessDesk", () => {
  it("asks one batch of three, whatever the desk holds", async () => {
    const one = await seededAccess(1);
    const many = await seededAccess(25);

    expect(one.result.requests).toHaveLength(1);
    expect(many.result.requests).toHaveLength(25);
    expect(many.result.codes).toHaveLength(25);
    expect(many.result.codes.every((code) => code.usedBy.length === 1)).toBe(
      true,
    );
    expect(one.counts.core).toBe(3);
    expectFlat(one.counts, many.counts);
  });
});

describe("exportData", () => {
  // A legitimate formula, for a history of R runs and E entries:
  // core = account + profile + one batch of 5 + 3·⌈E/80⌉ (kit, tags,
  // photos) + ⌈R/80⌉ (the runs' places), by `IN_LIST_CHUNK` (80,
  // src/lib/chunked.ts:43); weather = ⌈R/80⌉ (manual bands) +
  // ⌈located R/30⌉, by `CELLS_PER_READ` (30, src/modules/weather/read.ts:69).
  // 1 and 25 are one chunk of each.
  it("asks 2 + 5 + 3 + 1 of core and 1 + 1 of weather for 1 run and for 25", async () => {
    const key = cacheKeyFor(LAT, LNG, new Date(NOW * 1000));
    await weather().delete(weatherObservations);
    await weather().insert(weatherObservations).values({
      id: newUlid(),
      latR: key.latR,
      lngR: key.lngR,
      hourBucket: key.hourBucket,
      tempC: 4,
      feelsLikeC: 1,
      humidity: 71,
      windKph: 14,
      precipMm: 0,
      condition: "overcast",
      source: "visualcrossing",
      timeZone: "America/Chicago",
      fetchedAt: NOW,
    });

    const one = await seededExport(1);
    const many = await seededExport(25);

    expect(one.result.runs).toHaveLength(1);
    expect(many.result.runs).toHaveLength(25);
    expect(many.result.entries).toHaveLength(25);
    expect(
      many.result.runs.every(
        (run) => run.conditions?.source === "visualcrossing",
      ),
    ).toBe(true);
    expect(one.counts.core).toBe(2 + 5 + 3 + 1);
    expect(one.counts.weather).toBe(1 + 1);
    expectFlat(one.counts, many.counts);
  });
});
