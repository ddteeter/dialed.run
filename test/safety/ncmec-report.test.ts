import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  moderationActions,
  quarantinedContent,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { quarantineKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { AdminRequiredError } from "../../src/modules/safety/rules/admin";
import {
  purgeExpiredQuarantine,
  QUARANTINE_PAGE,
  QUARANTINE_RETENTION_SECONDS,
  quarantineCount,
  quarantinedContentFor,
  recordNcmecReport,
} from "../../src/modules/safety/takedowns/quarantine";

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
  await core().delete(moderationActions);
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
    await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id, reportId: "1" },
      now,
    );

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
    await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id, reportId: "1" },
      now,
    );

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

/**
 * A handle on the core database whose first batch, the purge's claim,
 * lets `after` land once it has: a report recorded inside the firing.
 */
function afterFirstBatch(after: () => Promise<unknown>) {
  const db = core();
  const batch = db.batch.bind(db);
  const seen = { batches: 0 };
  Reflect.set(
    db,
    "batch",
    async (...statements: Parameters<typeof db.batch>) => {
      const result = await batch(...statements);
      seen.batches += 1;
      if (seen.batches === 1) await after();
      return result;
    },
  );
  return db;
}

describe("the purge, against the report's year", () => {
  it("keeps a record and its copy when the report is recorded after the purge claimed it", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now - YEAR - DAY);
    const copy = quarantineKeyFor(`entries/u/e/${newUlid()}`);
    await env.MEDIA.put(copy, "bytes");
    await core()
      .update(quarantinedContent)
      .set({ photosSnapshot: JSON.stringify([{ preservedKey: copy }]) })
      .where(eq(quarantinedContent.id, id));

    const purge = await purgeExpiredQuarantine(
      afterFirstBatch(() =>
        recordNcmecReport(core(), ADMIN, { recordId: id, reportId: "9" }, now),
      ),
      env.MEDIA,
      now,
    );

    expect(purge).toStrictEqual({ purged: 0, failed: [] });
    expect(await recordOf(id)).toMatchObject({
      ncmecReportedAt: now,
      ncmecReportId: "9",
      retainUntil: now + YEAR,
    });
    expect(await env.MEDIA.head(copy)).not.toBeNull();
  });

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

/**
The audit rows on a subject, as the report's tests read them.
*/
async function auditOf(subjectId: string) {
  return core()
    .select({
      actorId: moderationActions.actorId,
      action: moderationActions.action,
      subjectType: moderationActions.subjectType,
      subjectId: moderationActions.subjectId,
      subjectOwnerId: moderationActions.subjectOwnerId,
      reason: moderationActions.reason,
    })
    .from(moderationActions)
    .where(eq(moderationActions.subjectId, subjectId));
}

describe("recording the report, in the audit", () => {
  it("writes a row for each recording, naming who recorded it and the number given", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now);
    const record = await recordOf(id);

    await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id, reportId: "1" },
      now,
    );
    await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id, reportId: "2" },
      now + DAY,
    );
    await recordNcmecReport(core(), ADMIN, { recordId: id }, now + 2 * DAY);

    const rows = await auditOf(record?.subjectId ?? "");
    expect(
      rows.map((row) => row.reason).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["", "1", "2"]);
    for (const row of rows) {
      expect(row).toStrictEqual({
        actorId: ADMIN,
        action: "ncmec_report",
        subjectType: "photo",
        subjectId: record?.subjectId,
        subjectOwnerId: record?.uploaderId,
        reason: row.reason,
      });
    }
  });

  it("writes no row for a record that is gone, or for someone not an admin", async () => {
    const id = await quarantinedAtTime(nowSeconds());

    await recordNcmecReport(core(), ADMIN, { recordId: newUlid() });
    await expect(
      recordNcmecReport(core(), "someone-else", { recordId: id }),
    ).rejects.toThrow(AdminRequiredError);

    expect(await core().select().from(moderationActions)).toStrictEqual([]);
  });
});

describe("Review's read of the quarantine", () => {
  it("counts every record, for an admin only", async () => {
    await quarantinedAtTime(nowSeconds());
    await quarantinedAtTime(nowSeconds() - DAY);

    expect(await quarantineCount(core(), ADMIN)).toBe(2);
    await expect(quarantineCount(core(), "someone-else")).rejects.toThrow(
      AdminRequiredError,
    );
  });

  it("lists a record still owed a report ahead of newer reported ones", async () => {
    const now = nowSeconds();
    const owed = await quarantinedAtTime(now - 30 * DAY);
    const [first, ...rest] = Array.from(
      { length: QUARANTINE_PAGE },
      (_, index) =>
        core()
          .insert(quarantinedContent)
          .values({
            id: newUlid(),
            moderationActionId: newUlid(),
            subjectType: "photo",
            subjectId: newUlid(),
            uploaderId: newUlid(),
            entrySnapshot: "{}",
            photosSnapshot: "[]",
            quarantinedAt: now - index,
            retainUntil: now + YEAR,
            ncmecReportedAt: now,
          }),
    );
    if (first === undefined) throw new Error("a page of records");
    await core().batch([first, ...rest]);

    const listed = await quarantinedContentFor(core(), ADMIN);

    expect(listed).toHaveLength(QUARANTINE_PAGE);
    expect(listed[0]?.id).toBe(owed);
    expect(listed[1]?.quarantinedAt).toBe(now);
    expect(listed[QUARANTINE_PAGE - 1]?.quarantinedAt).toBe(
      now - (QUARANTINE_PAGE - 2),
    );
  });

  it("carries the report and the clock, and none of the content", async () => {
    const now = nowSeconds();
    const id = await quarantinedAtTime(now);
    await recordNcmecReport(
      core(),
      ADMIN,
      { recordId: id, reportId: "7" },
      now,
    );

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
