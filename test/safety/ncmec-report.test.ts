import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { quarantinedContent } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { AdminRequiredError } from "../../src/modules/safety/admin";
import {
  purgeExpiredQuarantine,
  QUARANTINE_RETENTION_SECONDS,
  quarantinedContentFor,
  recordNcmecReport,
} from "../../src/modules/safety/quarantine";

/**
 * C12: a completed CyberTipline report is a request to preserve its
 * contents for a year after the report (18 U.S.C. §2258A(h)(1), as the
 * REPORT Act amended it). Recording one moves `retain_until` to at least
 * a year past it; the quarantine's own year stays the floor.
 */

const DAY = 24 * 60 * 60;
const YEAR = 365 * DAY;
const ADMIN = "the-admin";

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
A record quarantined at `quarantinedAt`, its year from then.
*/
async function quarantinedAtTime(quarantinedAt: number): Promise<string> {
  const id = newUlid();
  await core()
    .insert(quarantinedContent)
    .values({
      id,
      moderationActionId: newUlid(),
      subjectType: "photo",
      subjectId: newUlid(),
      uploaderId: newUlid(),
      entryId: newUlid(),
      entrySnapshot: "{}",
      photosSnapshot: "[]",
      quarantinedAt,
      retainUntil: quarantinedAt + YEAR,
    });
  return id;
}

async function recordOf(id: string) {
  const [row] = await core()
    .select()
    .from(quarantinedContent)
    .where(eq(quarantinedContent.id, id));
  return row;
}

const ADMINS: unknown = env.ADMIN_USER_IDS;

beforeEach(async () => {
  await core().delete(quarantinedContent);
  Reflect.set(env, "ADMIN_USER_IDS", ADMIN);
});

afterEach(() => {
  Reflect.set(env, "ADMIN_USER_IDS", ADMINS);
});

describe("recordNcmecReport", () => {
  it("is a year after the report, not after the quarantine", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now - 30 * DAY);

    const recorded = await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id, reportId: "123456" },
      now,
    );

    expect(recorded).toStrictEqual({
      outcome: "recorded",
      ncmecReportedAt: now,
      ncmecReportId: "123456",
      retainUntil: now + YEAR,
    });
    expect(await recordOf(id)).toMatchObject({
      ncmecReportedAt: now,
      ncmecReportId: "123456",
      retainUntil: now + YEAR,
    });
    expect(QUARANTINE_RETENTION_SECONDS).toBe(YEAR);
  });

  it("never moves the clock earlier than it stood", async () => {
    // A retention already past a year from now — a purge's lease, or a
    // floor set some other way — is kept, not shortened.
    const now = nowSeconds();
    const id = await quarantinedAtTime(now);
    const later = now + YEAR + 40 * DAY;
    await core()
      .update(quarantinedContent)
      .set({ retainUntil: later })
      .where(eq(quarantinedContent.id, id));

    const recorded = await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id },
      now,
    );

    expect(recorded).toMatchObject({ outcome: "recorded", retainUntil: later });
    const record = await recordOf(id);
    expect(record).toMatchObject({ ncmecReportedAt: now, retainUntil: later });
    expect(record?.ncmecReportId).toBeNull();
  });

  it("is the first recording's time: recording again moves nothing", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now - 100 * DAY);
    await recordNcmecReport(core(), ADMIN, { recordId: id, reportId: "1" }, now);

    // A double-click, a retry, the same form ten days on.
    const again = await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id },
      now + 10 * DAY,
    );

    expect(again).toStrictEqual({
      outcome: "recorded",
      ncmecReportedAt: now,
      ncmecReportId: "1",
      retainUntil: now + YEAR,
    });
  });

  it("takes a corrected report number without moving the clock", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now - DAY);
    await recordNcmecReport(core(), ADMIN, { recordId: id, reportId: "1" }, now);

    await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id, reportId: "2" },
      now + DAY,
    );

    expect(await recordOf(id)).toMatchObject({
      ncmecReportedAt: now,
      ncmecReportId: "2",
      retainUntil: now + YEAR,
    });
  });

  it("says so when the record is gone, and writes nothing", async () => {
    const now = nowSeconds();
    const other = await quarantinedAtTime(now);

    expect(
      await recordNcmecReport(core(), ADMIN, { recordId: newUlid() }, now),
    ).toStrictEqual({ outcome: "gone" });
    const record = await recordOf(other);
    expect(record?.ncmecReportedAt).toBeNull();
    expect(record?.retainUntil).toBe(now + YEAR);
  });

  it("is an admin's alone, refused before anything is written", async () => {
    const id = await quarantinedAtTime(nowSeconds());

    await expect(
      recordNcmecReport(core(), "someone-else", { recordId: id }),
    ).rejects.toThrow(AdminRequiredError);
    const record = await recordOf(id);
    expect(record?.ncmecReportedAt).toBeNull();
  });
});

describe("the purge, against the report's year", () => {
  it("keeps a reported record past the quarantine's year, and purges it at the report's", async () => {
    const now = nowSeconds();
    const reportedAt = now - 300 * DAY;
    // Quarantined 364 days ago, reported 64 days in.
    const id = await quarantinedAtTime(now - 364 * DAY);
    await recordNcmecReport(core(), ADMIN, { recordId: id }, reportedAt);

    // The quarantine's year is up two days from now; the report's is not.
    await purgeExpiredQuarantine(core(), env.MEDIA, now + 2 * DAY);
    expect(await recordOf(id)).toMatchObject({
      retainUntil: reportedAt + YEAR,
    });

    // A second short of the report's year, then on it.
    await purgeExpiredQuarantine(core(), env.MEDIA, reportedAt + YEAR - 1);
    expect(await recordOf(id)).toBeDefined();
    const purge = await purgeExpiredQuarantine(
      core(),
      env.MEDIA,
      reportedAt + YEAR,
    );
    expect(purge).toStrictEqual({ purged: 1, failed: [] });
    expect(await recordOf(id)).toBeUndefined();
  });

  it("never purges an unreported record before its quarantine's year", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now);

    await purgeExpiredQuarantine(core(), env.MEDIA, now + YEAR - 1);
    const record = await recordOf(id);
    expect(record?.ncmecReportedAt).toBeNull();
    expect(record?.retainUntil).toBe(now + YEAR);
    await purgeExpiredQuarantine(core(), env.MEDIA, now + YEAR);
    expect(await recordOf(id)).toBeUndefined();
  });
});

describe("Review's read of the quarantine", () => {
  it("carries the report and the clock, and none of the content", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now);
    await recordNcmecReport(core(), ADMIN, { recordId: id, reportId: "7" }, now);

    const [record] = await quarantinedContentFor(core(), ADMIN);

    expect(record).toMatchObject({
      id,
      quarantinedAt: now,
      retainUntil: now + YEAR,
      ncmecReportedAt: now,
      ncmecReportId: "7",
    });
    expect(
      Object.keys(record ?? {}).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual([
      "entryId",
      "id",
      "ncmecReportedAt",
      "ncmecReportId",
      "quarantinedAt",
      "retainUntil",
      "subjectId",
      "subjectType",
      "uploaderId",
    ]);
  });
});
