import { beforeEach, describe, expect, it } from "vitest";

import { DAY, HOUR, MAYA_ID, buildDenseSeed } from "../../e2e/audit/dense-seed";
import {
  BLOCKED,
  EMPTY_HANDLE,
  EMPTY_ID,
  NOWHERE,
  ONBOARD_HANDLE,
  ONBOARD_ID,
  nowhereObservations,
  photoAt,
  planGaps,
  runIn,
  type GapSeed,
  type GapsInput,
  type GapsRows,
  type PhotoOnFile,
} from "../../e2e/audit/gaps-plan";

/**
 * The gaps seed's plan (design 205): rows for the states the dense seed
 * does not reach, built from what the dense seed left in the database.
 */
const NOW = 1_794_000_000;

const photos: PhotoOnFile[] = Array.from({ length: 60 }, (_, index) => ({
  id: `photo-${String(index)}`,
  entryId: `entry-${String(index)}`,
  photoKey: `entries/owner-${String(index)}/entry-${String(index)}/photo-${String(index)}`,
  ownerId: `audit-r${String(index)}`,
}));

const input: GapsInput = {
  now: NOW,
  photos,
  usernames: new Map([["audit-r40", "runner_forty"]]),
  mayaRuns: [
    { id: "run-a", weatherStatus: "attached" },
    { id: "run-f", weatherStatus: "failed" },
    { id: "run-p", weatherStatus: "pending" },
    { id: "run-f2", weatherStatus: "failed" },
  ],
};

describe("the gaps plan's fixed runners", () => {
  it("names the brand-new runner, the one onboarding, and a place nobody runs", () => {
    expect([EMPTY_ID, EMPTY_HANDLE]).toStrictEqual([
      "audit-gnew",
      "first_day_fran",
    ]);
    expect([ONBOARD_ID, ONBOARD_HANDLE]).toStrictEqual([
      "audit-gonb",
      "newbie_noor_26",
    ]);
    expect(NOWHERE).toStrictEqual({ lat: 23.45, lng: 67.89 });
  });
});

describe("photoAt", () => {
  it("returns the dense seed's photo, or says the seed is missing", () => {
    expect(photoAt(photos, 2)).toBe(photos[2]);
    expect(() => photoAt(photos.slice(0, 2), 2)).toThrow(
      "the dense seed is not in this database",
    );
  });
});

describe("runIn", () => {
  it("finds Maya's first run in a status, or nothing", () => {
    expect(runIn(input.mayaRuns, "failed")).toBe("run-f");
    expect(runIn(input.mayaRuns, "manual")).toBe("");
  });
});

describe("planGaps", () => {
  // Planned for each test, not once for the file, so Stryker can tell
  // which tests cover which mutant.
  let rows: GapsRows;
  let seed: GapSeed;
  beforeEach(() => {
    ({ rows, seed } = planGaps(input));
  });

  it("reports what a spec visits", () => {
    expect(seed).toStrictEqual({
      failedRunId: "run-f",
      pendingRunId: "run-p",
      matchPhotoId: "audit-gph00",
      takedownEntryId: "entry-40",
    });
  });

  it("blocks five runners from Maya, one with no city", () => {
    expect(rows.blocks).toHaveLength(5);
    expect(rows.blocks[1]).toStrictEqual({
      blockerId: MAYA_ID,
      blockedId: "audit-gb2",
      createdAt: NOW - 10 * DAY,
    });
    expect(rows.user[2]).toStrictEqual({
      id: "audit-gb3",
      name: BLOCKED[2]?.handle,
      email: `${String(BLOCKED[2]?.handle)}@example.com`,
      emailVerified: true,
      createdAt: new Date((NOW - 42 * DAY) * 1000),
      updatedAt: new Date((NOW - 42 * DAY) * 1000),
    });
    expect(rows.userProfiles[3]).toMatchObject({
      userId: "audit-gb4",
      username: "mo",
      onboardingComplete: true,
      usernameScreen: "clear",
    });
    expect(rows.userProfiles[3]?.cityLabel).toBeNull();
    expect(rows.userProfiles[0]?.cityLabel).toBe("Columbus, OH");
  });

  it("holds a photo with sixteen near copies on other kits", () => {
    const [held, ...copies] = rows.entryPhotos;
    expect(held).toStrictEqual({
      id: "audit-gph00",
      entryId: "entry-0",
      photoKey: photos[0]?.photoKey,
      position: 6,
      fingerprint: "c3a1f09b5d2e7684",
      screenStatus: "hidden_pending_review",
    });
    expect(copies).toHaveLength(16);
    expect(copies[0]).toStrictEqual({
      id: "audit-gm00",
      entryId: "entry-3",
      photoKey: photos[0]?.photoKey,
      position: 7,
      fingerprint: "c3a1f09b5d2e7684",
      screenStatus: "pass",
    });
    expect(copies.at(-1)).toMatchObject({
      id: "audit-gm15",
      entryId: "entry-33",
      fingerprint: "c3a1f09b5d2e768c",
    });
    expect(copies[5]?.fingerprint).toBe("c3a1f09b5d2e7685");
    expect(rows.reviewQueue).toStrictEqual([
      {
        id: "audit-gq-match",
        subjectType: "photo",
        subjectId: "audit-gph00",
        source: "fingerprint",
        status: "pending",
        createdAt: NOW - 1200,
        openedAt: NOW - 1200,
      },
    ]);
  });

  it("waits on three removal requests: held, unconfirmed, and through the valve", () => {
    const [held, confirm, valve] = rows.takedownRequests;
    expect(held).toMatchObject({
      id: "audit-gtd1",
      status: "pending",
      dueAt: NOW + DAY,
      createdAt: NOW - 7 * HOUR,
      idempotencyKey: "audit-gtd1",
      requesterKey: "audit-gkey1",
      requesterEmail: "rowan.whitlock@example.com",
      location: "http://localhost:3777/kit/entry-40",
      subjectType: "photo",
      subjectId: "photo-40",
      holdState: "held",
      heldAt: NOW - 6 * HOUR,
      confirmedAt: NOW - 6 * HOUR,
      posterUsername: "runner_forty",
    });
    expect(confirm).toMatchObject({
      id: "audit-gtd2",
      dueAt: NOW,
      createdAt: NOW - 14 * HOUR,
      holdState: "confirm",
      signature: "Bartholomew Aurelius Featherstonehaugh-Montgomery III",
    });
    expect(confirm?.subjectId).toBeUndefined();
    expect(valve).toMatchObject({
      id: "audit-gtd3",
      location: "http://localhost:3777/kit/entry-44",
      subjectType: "entry",
      subjectId: "entry-44",
      holdState: "valve",
      confirmedAt: NOW - 20 * HOUR,
      signature: "Acme Photo Co",
    });
    expect(valve?.posterUsername).toBeUndefined();
  });

  it("holds three photos for copyright, at three points of the thirty days", () => {
    expect(rows.moderationActions.map((row) => row.id)).toStrictEqual([
      "audit-ghold0",
      "audit-ghold1",
      "audit-ghold2",
    ]);
    expect(rows.moderationActions[1]).toMatchObject({
      actorId: "e2e-desk-operator",
      action: "takedown",
      subjectType: "photo",
      subjectId: "audit-gheld1",
      subjectOwnerId: "audit-r51",
      createdAt: NOW - 7 * DAY,
    });
    expect(rows.moderationActions[0]?.reason).toMatch(/Acme Photo Co/u);
    const [fresh, countered, inCourt] = rows.copyrightHolds;
    expect(fresh).toStrictEqual({
      id: "audit-gch0",
      moderationActionId: "audit-ghold0",
      subjectType: "photo",
      subjectId: "audit-gheld0",
      ownerId: "audit-r50",
      entryId: "entry-50",
      status: "hidden",
      hiddenAt: NOW - 2 * DAY,
      purgeAt: NOW + 28 * DAY,
    });
    expect(countered).toMatchObject({
      counterNoticeAt: NOW - 3 * DAY,
      counterNoticeBy: "e2e-desk-operator",
      restoreAt: NOW + 11 * DAY,
      purgeAt: NOW + 23 * DAY,
    });
    expect(countered?.courtActionAt).toBeUndefined();
    expect(inCourt).toMatchObject({
      counterNoticeAt: NOW - 9 * DAY,
      restoreAt: NOW + 5 * DAY,
      courtActionAt: NOW - 2 * DAY,
      courtActionBy: "e2e-desk-operator",
      entryId: "entry-52",
    });
  });

  it("quarantines two items, one already reported", () => {
    const [waiting, reported] = rows.quarantinedContent;
    expect(waiting).toStrictEqual({
      id: "audit-gqc0",
      moderationActionId: "audit-gqact0",
      subjectType: "entry",
      subjectId: "audit-gqsub0",
      uploaderId: "audit-b01",
      entryId: "audit-gqent0",
      entrySnapshot: "{}",
      photosSnapshot: "[]",
      quarantinedAt: NOW - DAY,
      retainUntil: NOW + 365 * DAY,
    });
    expect(reported).toMatchObject({
      subjectType: "photo",
      uploaderId: "audit-b02",
      quarantinedAt: NOW - 5 * DAY,
      retainUntil: NOW + 361 * DAY,
      ncmecReportedAt: NOW - 4 * DAY,
      ncmecReportId: "AUDIT-20261108",
    });
  });

  it("writes only ids cleanGaps can find, and only example.com addresses", () => {
    for (const table of [
      rows.entryPhotos,
      rows.reviewQueue,
      rows.takedownRequests,
      rows.moderationActions,
      rows.copyrightHolds,
      rows.quarantinedContent,
    ]) {
      for (const row of table) expect(row.id).toMatch(/^audit-g/u);
    }
    for (const row of rows.user) expect(row.id).toMatch(/^audit-gb/u);
    const emails = [
      ...rows.user.map((row) => row.email),
      ...rows.takedownRequests.map((row) => row.requesterEmail),
    ];
    for (const email of emails) {
      expect(email).toMatch(/[.@]example\.com$/u);
    }
  });

  it("plans from a real dense seed, which has photos enough", () => {
    const dense = buildDenseSeed(NOW);
    const ownerOf = new Map(
      dense.core.outfitEntries.map((entry) => [entry.id, entry.userId]),
    );
    const shared = dense.core.entryPhotos
      .filter(
        (row) =>
          row.screenStatus === "pass" &&
          ownerOf.get(row.entryId)?.startsWith("audit-r") === true,
      )
      .map((row) => ({ ...row, ownerId: ownerOf.get(row.entryId) ?? "" }));
    const mayaRuns = dense.core.runs
      .filter((run) => run.userId === MAYA_ID)
      .map((run) => ({ id: run.id, weatherStatus: run.weatherStatus ?? "" }));
    const planned = planGaps({
      now: NOW,
      photos: shared.slice(0, 60),
      usernames: new Map(),
      mayaRuns,
    });
    expect(planned.seed.failedRunId).not.toBe("");
    expect(planned.seed.pendingRunId).not.toBe("");
  });
});

describe("nowhereObservations", () => {
  it("reads the brand-new runner's place an hour either side of now", () => {
    const readings = nowhereObservations(NOW + 1800, -4);
    const hour = Math.floor((NOW + 1800) / HOUR);
    expect(readings.map((row) => [row.id, row.hourBucket])).toStrictEqual([
      ["audit-gobs0", hour - 1],
      ["audit-gobs1", hour],
      ["audit-gobs2", hour + 1],
      ["audit-gobs3", hour + 2],
    ]);
    expect(readings[0]).toStrictEqual({
      id: "audit-gobs0",
      latR: 23.45,
      lngR: 67.89,
      hourBucket: hour - 1,
      tempC: -3,
      feelsLikeC: -4,
      humidity: 60,
      windKph: 10,
      precipMm: 0,
      condition: "clear",
      source: "visualcrossing",
      fetchedAt: NOW + 1800,
    });
  });
});
