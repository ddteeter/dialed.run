import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import {
  copyrightHolds,
  entryPhotos,
  heldTakeDowns,
  notifications,
  outbox,
  outfitEntries,
  removedFingerprints,
  reviewQueue,
  takedownRequests,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { isoDayOf } from "../../src/lib/contracts/age";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { getEntryDetail } from "../../src/modules/feed/entries/entries";
import {
  deleteAfterCase,
  moderateContent,
  sweepCopyrightHolds,
} from "../../src/modules/feed/moderation/moderation";
import { isPhotoVisible } from "../../src/modules/feed/entries/photos";
import {
  deleteEntryPhoto,
  deleteRun,
  retractEntries,
  retractEntry,
} from "../../src/modules/feed/entries/retract";
import { ControlRefusal } from "../../src/lib/control-refusal";
import { oweInCore } from "../../src/modules/ops/outbox";
import { resolveReview } from "../../src/modules/safety";
import { releaseReview } from "../../src/modules/safety/review/review";
import { fileTakedownRequest } from "../../src/modules/safety/takedowns/takedown-requests";
import { oweInCoreWhere } from "../../src/modules/ops/outbox/owe-in-core";
import { fileReport } from "../../src/modules/safety/reports/reports";
import {
  COPYRIGHT_HOLD_PAGE,
  COPYRIGHT_HOLD_SECONDS,
  heldCopyrightContent,
  recordCounterNotice,
  recordCourtAction,
  restoreAfterCase,
  restoreDayAfter,
  restoreDueHolds,
} from "../../src/modules/safety/takedowns/copyright-holds";
import { removalsOnRun } from "../../src/modules/safety/takedowns/run-removals";

import { noPurge } from "../purge-spy";
import {
  firstBatchAfter,
  makeEntry,
  makeRun,
  makeUser,
  resetSafetyTables,
} from "./helpers";

/**
 * D-130, design 149: a copyright takedown hides for 30 days; a counter-
 * notice restores it on the 12th weekday after, unless a court action is
 * recorded; with none pending, the sweep deletes it.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  // The fast path is live; nothing here expects a report.
}

const DAY = 24 * 60 * 60;
/**
A column D1 left empty, as drizzle reads it back.
*/
const NOT_SET = z.null().parse(JSON.parse("null"));

function utc(month: number, day: number, hour = 0): number {
  return Date.UTC(2026, month - 1, day, hour) / 1000;
}

async function isStored(key: string): Promise<boolean> {
  return (await env.MEDIA.head(key)) !== null;
}

/**
A runner's shared kit with one screened photo, fingerprinted.
*/
async function posted() {
  const author = await makeUser();
  await core()
    .insert(user)
    .values({
      id: author,
      name: author,
      email: `${author.toLowerCase()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId });
  const photoId = newUlid();
  const key = entryPhotoKeyFor(author, entryId, photoId);
  await env.MEDIA.put(key, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await core().insert(entryPhotos).values({
    id: photoId,
    entryId,
    photoKey: key,
    position: 0,
    screenStatus: "pass",
    fingerprint: "00ff00ff00ff00ff",
  });
  return { author, runId, entryId, photoId, key };
}

async function takeDown(
  subjectType: "entry" | "photo",
  subjectId: string,
  reason: "copyright" | "intimate" = "copyright",
) {
  return moderateContent(
    core(),
    {
      actorId: "desk",
      action: "takedown",
      subjectType,
      subjectId,
      reason,
      notice: "Acme Photo Co, ref 7",
    },
    quiet,
  );
}

async function holdOf(subjectId: string) {
  const [hold] = await core()
    .select()
    .from(copyrightHolds)
    .where(eq(copyrightHolds.subjectId, subjectId));
  if (hold === undefined) throw new Error("no hold");
  return hold;
}

/**
Moves a hold's hide to a known moment, so its day can be reasoned about.
*/
async function hiddenOn(holdId: string, hiddenAt: number): Promise<void> {
  await core()
    .update(copyrightHolds)
    .set({ hiddenAt })
    .where(eq(copyrightHolds.id, holdId));
}

async function holdStatus(subjectId: string) {
  const hold = await holdOf(subjectId);
  return hold.status;
}

async function holdIdOf(subjectId: string) {
  const hold = await holdOf(subjectId);
  return hold.id;
}

async function screenOf(photoId: string) {
  const row = await photoRow(photoId);
  return row?.screenStatus;
}

async function photoRow(photoId: string) {
  const [row] = await core()
    .select({
      screenStatus: entryPhotos.screenStatus,
      fingerprint: entryPhotos.fingerprint,
    })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
  return row;
}

async function entryStatus(entryId: string) {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.status;
}

async function mediaDebts() {
  const rows = await core()
    .select({ kind: outbox.kind })
    .from(outbox)
    .where(eq(outbox.kind, "entry_media_delete"));
  return rows.length;
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(notifications);
});

describe("restoreDayAfter: the 12th weekday after the counter-notice", () => {
  it("counts weekdays only, from the UTC day, to its midnight", () => {
    // Fri Oct 23 2026: two weeks and a Tuesday, skipping two weekends.
    expect(restoreDayAfter(utc(10, 23, 15))).toBe(utc(11, 10));
    expect(restoreDayAfter(utc(10, 23, 23) + 3599)).toBe(utc(11, 10));
    // A weekend counts from the Monday after it.
    expect(restoreDayAfter(utc(10, 24, 9))).toBe(utc(11, 10));
    expect(restoreDayAfter(utc(10, 25, 9))).toBe(utc(11, 10));
    expect(restoreDayAfter(utc(10, 26))).toBe(utc(11, 11));
    expect(restoreDayAfter(utc(10, 22, 12))).toBe(utc(11, 9));
  });
});

describe("a copyright takedown hides (D-130)", () => {
  it("keeps the photo, its bytes and its fingerprint, and holds it 30 days", async () => {
    const { author, photoId, key } = await posted();
    const before = nowSeconds();

    expect(await takeDown("photo", photoId)).toBe("removed");

    expect(await photoRow(photoId)).toStrictEqual({
      screenStatus: "removed",
      fingerprint: "00ff00ff00ff00ff",
    });
    expect(await isStored(key)).toBe(true);
    expect(await mediaDebts()).toBe(0);
    const hold = await holdOf(photoId);
    expect(hold).toMatchObject({
      subjectType: "photo",
      ownerId: author,
      status: "hidden",
      counterNoticeAt: NOT_SET,
      restoreAt: NOT_SET,
      courtActionAt: NOT_SET,
    });
    expect(hold.hiddenAt).toBeGreaterThanOrEqual(before);
    expect(hold.purgeAt).toBe(hold.hiddenAt + COPYRIGHT_HOLD_SECONDS);
    expect(COPYRIGHT_HOLD_SECONDS).toBe(30 * DAY);
  });

  it("hides the photo from its author too, who was told it was removed", async () => {
    const { author, entryId, photoId, key } = await posted();

    await takeDown("photo", photoId);

    expect(await isPhotoVisible(key, author)).toBe(false);
    const detail = await getEntryDetail(entryId, author);
    expect(detail?.photoKeys).toStrictEqual([]);
  });

  it("takes an entry out of every stranger's sight, and keeps its rows", async () => {
    const { entryId, key } = await posted();

    await takeDown("entry", entryId);

    expect(await entryStatus(entryId)).toBe("removed");
    expect(await isPhotoVisible(key, await makeUser())).toBe(false);
    expect(await isStored(key)).toBe(true);
    expect(await holdOf(entryId)).toMatchObject({
      subjectType: "entry",
      entryId,
      status: "hidden",
    });
  });

  it("answers a second takedown of what it holds as already removed", async () => {
    const { photoId } = await posted();

    await takeDown("photo", photoId);

    expect(await takeDown("photo", photoId)).toBe("already_removed");
  });

  it("leaves a removal request's takedown deleting at once", async () => {
    const { photoId, key } = await posted();

    expect(await takeDown("photo", photoId, "intimate")).toBe("removed");
    // Gone, so a repeat is answered from the audit row.
    expect(await takeDown("photo", photoId, "intimate")).toBe(
      "already_removed",
    );

    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
    expect(await core().select().from(copyrightHolds)).toStrictEqual([]);
  });

  it("is not brought back by a report's hide and a review's Approve", async () => {
    const { entryId, photoId } = await posted();
    await takeDown("photo", photoId);
    await takeDown("entry", entryId);

    for (const [subjectType, subjectId] of [
      ["entry", entryId],
      ["photo", photoId],
    ] as const) {
      await fileReport(
        {
          reporterId: await makeUser(),
          subjectType,
          subjectId,
          reason: "intimate",
        },
        oweInCore,
        noPurge,
      );
    }
    expect(await entryStatus(entryId)).toBe("removed");
    expect(await screenOf(photoId)).toBe("removed");

    const queued = await core()
      .select({ id: reviewQueue.id })
      .from(reviewQueue);
    expect(queued).toHaveLength(2);
    for (const row of queued) {
      expect(await resolveReview(row.id, "desk", "approve")).toBe("resolved");
    }
    expect(await entryStatus(entryId)).toBe("removed");
    expect(await screenOf(photoId)).toBe("removed");
  });
});

describe("the Desk's counter-notice and court action", () => {
  it("records the counter-notice once, with the day it comes back", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await holdOf(photoId);
    await hiddenOn(id, utc(10, 20, 9));
    // RECEIVED ON (round 39 #73): the day it arrived, kept as its 00:00 UTC.
    const at = utc(10, 23);

    expect(
      await recordCounterNotice(core(), "desk", id, "2026-10-23"),
    ).toStrictEqual({
      outcome: "recorded",
      counterNoticeAt: at,
      restoreAt: utc(11, 10),
    });
    expect(
      await recordCounterNotice(core(), "desk", id, "2026-10-24"),
    ).toStrictEqual({ outcome: "already" });
    expect(await holdOf(photoId)).toMatchObject({
      counterNoticeAt: at,
      counterNoticeBy: "desk",
      restoreAt: utc(11, 10),
    });
  });

  it("refuses a day before the hide, and takes the hide's own day (round 39 #73)", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await holdOf(photoId);
    await hiddenOn(id, utc(10, 21));

    expect(
      await recordCounterNotice(core(), "desk", id, "2026-10-20"),
    ).toStrictEqual({ outcome: "before_hidden" });
    expect(await holdOf(photoId)).toMatchObject({ counterNoticeAt: NOT_SET });
    expect(
      await recordCounterNotice(core(), "desk", id, "2026-10-21"),
    ).toMatchObject({
      outcome: "recorded",
      counterNoticeAt: utc(10, 21),
    });
  });

  it("takes the hide's day even when it was hidden late that day", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await holdOf(photoId);
    await hiddenOn(id, utc(10, 22) - 1);

    expect(
      await recordCounterNotice(core(), "desk", id, "2026-10-21"),
    ).toMatchObject({ outcome: "recorded" });
  });

  it("records a court action only after a counter-notice, and once", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await holdOf(photoId);

    expect(await recordCourtAction(core(), "desk", id, 100)).toStrictEqual({
      outcome: "no_counter_notice",
    });
    await recordCounterNotice(core(), "desk", id, isoDayOf(nowSeconds()));
    expect(await recordCourtAction(core(), "op", id, 300)).toStrictEqual({
      outcome: "recorded",
      courtActionAt: 300,
    });
    expect(await recordCourtAction(core(), "op", id, 400)).toStrictEqual({
      outcome: "already",
    });
    expect(await holdOf(photoId)).toMatchObject({
      courtActionAt: 300,
      courtActionBy: "op",
    });
  });

  it("answers gone for a hold that is settled, or never was", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const hold = await holdOf(photoId);
    await sweepCopyrightHolds(core(), hold.purgeAt, quiet);

    expect(
      await recordCounterNotice(core(), "desk", hold.id, "2026-10-23"),
    ).toStrictEqual({ outcome: "gone" });
    expect(await recordCourtAction(core(), "desk", hold.id)).toStrictEqual({
      outcome: "gone",
    });
    expect(
      await recordCounterNotice(core(), "desk", newUlid(), "2026-10-23"),
    ).toStrictEqual({ outcome: "gone" });
  });
});

describe("the daily sweep's restore", () => {
  it("puts a photo back for screening on its day, not before", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await holdOf(photoId);
    const { restoreAt } = await counterNotice(id);

    await sweepCopyrightHolds(core(), restoreAt - 1, quiet);
    expect(await screenOf(photoId)).toBe("removed");

    await sweepCopyrightHolds(core(), restoreAt, quiet);
    expect(await screenOf(photoId)).toBe("pending");
    expect(await holdOf(photoId)).toMatchObject({
      status: "restored",
      settledAt: restoreAt,
    });
  });

  it("puts an entry back in the feed", async () => {
    const { entryId } = await posted();
    await takeDown("entry", entryId);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(entryId)).toBe("ok");
  });

  it("does not restore once a court action is recorded", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await holdOf(photoId);
    const { restoreAt } = await counterNotice(id);
    await recordCourtAction(core(), "desk", id);

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await screenOf(photoId)).toBe("removed");
    expect(await holdStatus(photoId)).toBe("hidden");
  });

  it("is safe to run again: a restored photo screened since is left alone", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    await sweepCopyrightHolds(core(), restoreAt, quiet);
    await core()
      .update(entryPhotos)
      .set({ screenStatus: "pass" })
      .where(eq(entryPhotos.id, photoId));

    await sweepCopyrightHolds(core(), restoreAt, quiet);
    await sweepCopyrightHolds(core(), restoreAt + DAY, quiet);

    expect(await screenOf(photoId)).toBe("pass");
  });

  it("gives back only what is still held: a subject moved since stays put", async () => {
    const { entryId, photoId } = await posted();
    await takeDown("entry", entryId);
    await takeDown("photo", photoId);
    const entryBack = await counterNotice(await holdIdOf(entryId));
    await counterNotice(await holdIdOf(photoId));
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, entryId));
    await core()
      .update(entryPhotos)
      .set({ screenStatus: "flagged" })
      .where(eq(entryPhotos.id, photoId));

    await sweepCopyrightHolds(core(), entryBack.restoreAt, quiet);

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await screenOf(photoId)).toBe("flagged");
  });

  it("drops the author's removed band once the photo is back", async () => {
    const { author, runId, photoId } = await posted();
    await takeDown("photo", photoId);
    expect(await removalsOnRun(core(), author, runId)).toHaveLength(1);
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await removalsOnRun(core(), author, runId)).toStrictEqual([]);
  });
});

describe("the daily sweep's purge", () => {
  it("deletes a photo 30 days on, with its bytes and fingerprint", async () => {
    const { photoId, key } = await posted();
    await takeDown("photo", photoId);
    const { purgeAt } = await holdOf(photoId);

    await sweepCopyrightHolds(core(), purgeAt - 1, quiet);
    expect(await photoRow(photoId)).toBeDefined();

    await sweepCopyrightHolds(core(), purgeAt, quiet);
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
    expect(await holdOf(photoId)).toMatchObject({
      status: "purged",
      settledAt: purgeAt,
    });
  });

  it("deletes an entry and keeps the author's notice of its removal", async () => {
    const { author, entryId } = await posted();
    await takeDown("entry", entryId);
    const { purgeAt } = await holdOf(entryId);

    await sweepCopyrightHolds(core(), purgeAt, quiet);

    expect(await entryStatus(entryId)).toBeUndefined();
    const told = await core()
      .select({ kind: notifications.kind })
      .from(notifications)
      .where(eq(notifications.userId, author));
    expect(told).toStrictEqual([{ kind: "content_removed" }]);
  });

  it("waits while a counter-notice is pending", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id, purgeAt } = await holdOf(photoId);
    await recordCounterNotice(core(), "desk", id, isoDayOf(purgeAt + 10 * DAY));

    await sweepCopyrightHolds(core(), purgeAt + DAY, quiet);
    expect(await holdStatus(photoId)).toBe("hidden");
    expect(await photoRow(photoId)).toBeDefined();
  });

  it("never restores what it purged", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id, purgeAt } = await holdOf(photoId);
    await sweepCopyrightHolds(core(), purgeAt, quiet);

    await recordCounterNotice(core(), "desk", id, isoDayOf(purgeAt));
    await sweepCopyrightHolds(core(), purgeAt + 30 * DAY, quiet);

    expect(await photoRow(photoId)).toBeUndefined();
    expect(await holdStatus(photoId)).toBe("purged");
  });

  it("takes over a purge a failed sweep left claimed, and not one in flight", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id, purgeAt } = await holdOf(photoId);
    const now = purgeAt + DAY;
    await core()
      .update(copyrightHolds)
      .set({ status: "purging", settledAt: now - 60 })
      .where(eq(copyrightHolds.id, id));

    await sweepCopyrightHolds(core(), now, quiet);
    expect(await photoRow(photoId)).toBeDefined();

    await sweepCopyrightHolds(core(), now - 60 + 60 * 60 + 1, quiet);
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await holdStatus(photoId)).toBe("purged");
  });

  it("finishes a hold whose subject is already gone", async () => {
    const { author, entryId } = await posted();
    await takeDown("entry", entryId);
    const { purgeAt } = await holdOf(entryId);
    // Gone some way other than the runner's own delete, which a live hold
    // refuses (SA-L09): a row deleted before that rule, say.
    await retractEntries(core(), author, [entryId], quiet, noPurge);

    await sweepCopyrightHolds(core(), purgeAt, quiet);

    expect(await holdStatus(entryId)).toBe("purged");
  });
});

describe("the litigation hold after a court action (D-146)", () => {
  it("keeps the material hidden past its 30 days, however long the case runs", async () => {
    const { photoId, key } = await posted();
    await takeDown("photo", photoId);
    const { id, purgeAt } = await inCourt(photoId);

    await sweepCopyrightHolds(core(), purgeAt, quiet);
    await sweepCopyrightHolds(core(), purgeAt + 400 * DAY, quiet);

    expect(await holdStatus(photoId)).toBe("hidden");
    expect(await photoRow(photoId)).toStrictEqual({
      screenStatus: "removed",
      fingerprint: "00ff00ff00ff00ff",
    });
    expect(await isStored(key)).toBe(true);
    const listed = await heldCopyrightContent(core());
    expect(listed.map((hold) => hold.id)).toStrictEqual([id]);
  });

  it("Case over: delete deletes it now, bytes and fingerprint with it, and counts", async () => {
    const { author, photoId, key } = await posted();
    await takeDown("photo", photoId);
    const { id } = await inCourt(photoId);

    expect(await deleteAfterCase(core(), "op", id, 5000, quiet)).toStrictEqual({
      outcome: "recorded",
    });

    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
    expect(await holdOf(photoId)).toMatchObject({
      status: "purged",
      settledAt: 5000,
      caseClosedBy: "op",
    });
    // This one and the fresh one.
    expect(await strikesWithOneMore(author)).toBe(2);
  });

  it("Case over: delete deletes an entry, and a repeat deletes nothing more", async () => {
    const { author, entryId } = await posted();
    await takeDown("entry", entryId);
    const { id } = await inCourt(entryId);
    await deleteAfterCase(core(), "op", id, 5000, quiet);
    const debts = await mediaDebts();

    expect(await deleteAfterCase(core(), "op", id, 6000, quiet)).toStrictEqual({
      outcome: "gone",
    });

    expect(await entryStatus(entryId)).toBeUndefined();
    expect(await mediaDebts()).toBe(debts);
    expect(await holdOf(entryId)).toMatchObject({
      status: "purged",
      settledAt: 5000,
    });
    const told = await core()
      .select({ kind: notifications.kind })
      .from(notifications)
      .where(eq(notifications.userId, author));
    expect(told).toStrictEqual([{ kind: "content_removed" }]);
  });

  it("Case over: restore puts a photo back for screening, and is no strike", async () => {
    const { author, runId, photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await inCourt(photoId);

    expect(await restoreAfterCase(core(), "op", id, 5000)).toStrictEqual({
      outcome: "recorded",
    });

    expect(await screenOf(photoId)).toBe("pending");
    expect(await holdOf(photoId)).toMatchObject({
      status: "restored",
      settledAt: 5000,
      caseClosedBy: "op",
    });
    // Only the fresh one.
    expect(await strikesWithOneMore(author)).toBe(1);
    expect(await removalsOnRun(core(), author, runId)).toStrictEqual([]);
  });

  it("Case over: restore puts an entry back, once, and the sweep leaves it", async () => {
    const { entryId } = await posted();
    await takeDown("entry", entryId);
    const { id, purgeAt } = await inCourt(entryId);
    await restoreAfterCase(core(), "op", id, 5000);
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, entryId));

    expect(await restoreAfterCase(core(), "op", id, 5000)).toStrictEqual({
      outcome: "gone",
    });
    await sweepCopyrightHolds(core(), purgeAt + DAY, quiet);

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await holdStatus(entryId)).toBe("restored");
  });

  it("acts only on the hold named, and only once a court action holds it", async () => {
    const one = await posted();
    const two = await posted();
    await takeDown("photo", one.photoId);
    await takeDown("photo", two.photoId);
    const first = await inCourt(one.photoId);
    await inCourt(two.photoId);
    const noCase = await posted();
    await takeDown("photo", noCase.photoId);
    const pending = await holdIdOf(noCase.photoId);
    await counterNotice(pending);

    await restoreAfterCase(core(), "op", first.id, 5000);

    expect(await screenOf(two.photoId)).toBe("removed");
    expect(await holdStatus(two.photoId)).toBe("hidden");
    for (const act of [restoreAfterCase, caseOverDelete]) {
      expect(await act(core(), "op", pending, 6000)).toStrictEqual({
        outcome: "not_held",
      });
      expect(await act(core(), "op", newUlid(), 6000)).toStrictEqual({
        outcome: "gone",
      });
    }
    expect(await holdOf(noCase.photoId)).toMatchObject({
      status: "hidden",
      caseClosedBy: NOT_SET,
    });
    expect(await screenOf(noCase.photoId)).toBe("removed");
  });

  it("leaves a case-over delete that failed for the sweep to finish", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await inCourt(photoId);
    await core()
      .update(copyrightHolds)
      .set({ status: "purging", settledAt: 5000, caseClosedBy: "op" })
      .where(eq(copyrightHolds.id, id));

    expect(await deleteAfterCase(core(), "op", id, 5001, quiet)).toStrictEqual({
      outcome: "gone",
    });
    await sweepCopyrightHolds(core(), 5000 + 60 * 60 + 1, quiet);

    expect(await photoRow(photoId)).toBeUndefined();
    expect(await holdStatus(photoId)).toBe("purged");
  });
});

describe("Review's list of holds, and strikes", () => {
  it("lists what is hidden, soonest deletion first, with the notice", async () => {
    const first = await posted();
    const second = await posted();
    await takeDown("photo", second.photoId);
    await takeDown("photo", first.photoId);
    await core()
      .update(copyrightHolds)
      .set({ purgeAt: 1 })
      .where(eq(copyrightHolds.subjectId, first.photoId));

    const listed = await heldCopyrightContent(core());

    expect(listed.map((hold) => hold.subjectId)).toStrictEqual([
      first.photoId,
      second.photoId,
    ]);
    expect(listed[0]).toMatchObject({
      subjectType: "photo",
      ownerId: first.author,
      notice: "it uses someone else's work — Acme Photo Co, ref 7",
      purgeAt: 1,
      counterNoticeAt: NOT_SET,
      restoreAt: NOT_SET,
      courtActionAt: NOT_SET,
      strikes: 1,
    });
    // Each hold names its own owner's handle (R55·199's head).
    const handles = await core()
      .select({ id: userProfiles.userId, handle: userProfiles.username })
      .from(userProfiles);
    const handleOf = (id: string) =>
      handles.find((row) => row.id === id)?.handle;
    expect(listed.map((hold) => hold.ownerHandle)).toStrictEqual([
      handleOf(first.author),
      handleOf(second.author),
    ]);
    expect(listed[0]?.ownerHandle).toEqual(expect.any(String));
    expect(listed[0]?.ownerHandle).not.toBe(listed[1]?.ownerHandle);
    expect(COPYRIGHT_HOLD_PAGE).toBe(100);
  });

  it("lists a hold whose owner has no profile, naming no handle", async () => {
    const { author, photoId } = await posted();
    await takeDown("photo", photoId);
    await core().delete(userProfiles).where(eq(userProfiles.userId, author));

    const listed = await heldCopyrightContent(core());

    expect(
      listed.map((hold) => [hold.subjectId, hold.ownerHandle]),
    ).toStrictEqual([[photoId, undefined]]);
  });

  it("counts every takedown a restore did not undo, and lists only the hidden", async () => {
    const { author, entryId, photoId } = await posted();
    const other = await makeEntry({
      userId: author,
      runId: await makeRun({ userId: author }),
    });
    const third = await makeEntry({
      userId: author,
      runId: await makeRun({ userId: author }),
    });
    await takeDown("photo", photoId);
    await takeDown("entry", entryId);
    await takeDown("entry", other);
    await takeDown("entry", third);
    const restored = await counterNotice(await holdIdOf(photoId));
    const purged = await holdOf(other);
    await core()
      .update(copyrightHolds)
      .set({ purgeAt: purged.hiddenAt })
      .where(eq(copyrightHolds.id, purged.id));
    await sweepCopyrightHolds(core(), restored.restoreAt, quiet);

    const listed = await heldCopyrightContent(core());

    // The photo came back, the second entry was deleted: three strikes,
    // two of them still held.
    expect(listed.map((hold) => [hold.subjectId, hold.strikes])).toStrictEqual([
      [entryId, 3],
      [third, 3],
    ]);
  });
});

async function counterNotice(holdId: string) {
  const answer = await recordCounterNotice(
    core(),
    "desk",
    holdId,
    isoDayOf(nowSeconds()),
  );
  if (answer.outcome !== "recorded") throw new Error(answer.outcome);
  return answer;
}

/**
A hold the Desk has recorded a counter-notice and then a court action on.
*/
async function inCourt(subjectId: string) {
  const hold = await holdOf(subjectId);
  await counterNotice(hold.id);
  const answer = await recordCourtAction(core(), "desk", hold.id);
  if (answer.outcome !== "recorded") throw new Error(answer.outcome);
  return hold;
}

function caseOverDelete(
  db: ReturnType<typeof core>,
  actorId: string,
  holdId: string,
  now: number,
) {
  return deleteAfterCase(db, actorId, holdId, now, quiet);
}

/**
 * A runner's strikes as Review shows them: on a fresh takedown of theirs,
 * which is itself one.
 */
async function strikesWithOneMore(author: string) {
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId });
  await takeDown("entry", entryId);
  const listed = await heldCopyrightContent(core());
  return listed.find((hold) => hold.subjectId === entryId)?.strikes;
}

function heldSentence(noun: string): string {
  return `This ${noun} is held while a copyright claim is settled, so it can't be deleted yet.`;
}

/**
The sentence a delete was refused with, failing unless it was a ControlRefusal.
*/
async function refusalOf(attempt: Promise<void>): Promise<string> {
  try {
    await attempt;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ControlRefusal);
    return error instanceof Error ? error.message : "";
  }
  throw new Error("the delete was not refused");
}

describe("the runner's own delete of what a hold names (SA-L09)", () => {
  beforeEach(resetSafetyTables);

  it.each([
    ["the kit", "entry"],
    ["a photo on it", "photo"],
  ] as const)(
    "refuses the kit, its run and each photo while %s is held, and keeps it all",
    async (_case, subject) => {
      const { author, runId, entryId, photoId, key } = await posted();
      await takeDown(subject, subject === "entry" ? entryId : photoId);

      const kit = await refusalOf(retractEntry(core(), author, entryId, quiet));
      const run = await refusalOf(deleteRun(core(), author, runId, quiet));
      const photo = await refusalOf(
        deleteEntryPhoto(core(), author, photoId, quiet, noPurge),
      );

      expect([kit, run, photo]).toStrictEqual([
        heldSentence("kit"),
        heldSentence("run"),
        heldSentence("photo"),
      ]);
      expect(await entryStatus(entryId)).toBeDefined();
      expect(await photoRow(photoId)).toBeDefined();
      expect(await isStored(key)).toBe(true);
    },
  );

  it.each(["kit", "run", "photo"] as const)(
    "refuses the %s when the hold lands between the delete's reads and its write",
    async (noun) => {
      const { author, runId, entryId, photoId, key } = await posted();
      // The Desk's takedown commits after every read the delete makes,
      // just before its batch.
      const landing = firstBatchAfter(() => takeDown("entry", entryId));
      const attempts = {
        kit: () => retractEntry(landing, author, entryId, quiet),
        run: () => deleteRun(landing, author, runId, quiet),
        photo: () => deleteEntryPhoto(landing, author, photoId, quiet, noPurge),
      };

      expect(await refusalOf(attempts[noun]())).toBe(heldSentence(noun));
      expect(await entryStatus(entryId)).toBeDefined();
      expect(await photoRow(photoId)).toBeDefined();
      expect(await isStored(key)).toBe(true);
      expect(await holdOf(entryId)).toMatchObject({ status: "hidden" });
    },
  );

  it.each([
    "D1_ERROR: the database is unavailable",
    "D1_ERROR: NOT NULL constraint failed: entry_photos.photo_key: SQLITE_CONSTRAINT",
    "D1_ERROR: CHECK constraint failed: copyright_holds.status: SQLITE_CONSTRAINT",
  ])(
    "lets any other failure of the delete's batch through: %s",
    async (text) => {
      const { author, entryId } = await posted();
      const failing = firstBatchAfter(() => {
        throw new Error(text);
      });

      const attempt = retractEntry(failing, author, entryId, quiet);
      await expect(attempt).rejects.toThrow(text);
      await expect(attempt).rejects.not.toBeInstanceOf(ControlRefusal);
      expect(await entryStatus(entryId)).toBeDefined();
    },
  );

  it("refuses under a litigation hold too", async () => {
    const { author, entryId, photoId } = await posted();
    await takeDown("photo", photoId);
    await inCourt(photoId);

    const kit = await refusalOf(retractEntry(core(), author, entryId, quiet));
    expect(kit).toBe(heldSentence("kit"));
  });

  it("deletes once the hold is restored", async () => {
    const { author, entryId } = await posted();
    await takeDown("entry", entryId);
    await core()
      .update(copyrightHolds)
      .set({ status: "restored" })
      .where(eq(copyrightHolds.subjectId, entryId));

    await retractEntry(core(), author, entryId, quiet);

    expect(await entryStatus(entryId)).toBeUndefined();
  });

  it("leaves another kit of the same runner deletable", async () => {
    const { author, entryId } = await posted();
    const other = await posted();
    await takeDown("entry", other.entryId);

    await retractEntry(core(), author, entryId, quiet);
    expect(await entryStatus(entryId)).toBeUndefined();
  });
});

/**
A report on a subject from a new runner, for a reason that hides at once.
*/
async function reported(subjectType: "entry" | "photo", subjectId: string) {
  await fileReport(
    {
      reporterId: await makeUser(),
      subjectType,
      subjectId,
      reason: "intimate",
    },
    oweInCore,
    noPurge,
  );
}

/**
A pending removal request naming the kit, in the hold state given.
*/
async function requested(subjectId: string, holdState: "held" | "confirm") {
  await core()
    .insert(takedownRequests)
    .values({
      id: newUlid(),
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      location: `https://dialed.run/kit/${subjectId}`,
      subjectType: "entry",
      subjectId,
      dueAt: nowSeconds() + DAY,
      createdAt: nowSeconds(),
      idempotencyKey: newUlid(),
      holdState,
    });
}

async function openRows() {
  return core().select({ status: reviewQueue.status }).from(reviewQueue);
}

describe("a restore of what something else still holds", () => {
  it("hands a kit to review when a report's review opened before the hold", async () => {
    const { author, entryId } = await posted();
    await reported("entry", entryId);
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    await core().delete(notifications);
    await takeDown("entry", entryId);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await openRows()).toStrictEqual([{ status: "pending" }]);
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    expect(await holdStatus(entryId)).toBe("restored");
    const hidden = await core()
      .select({
        userId: notifications.userId,
        subjectId: notifications.subjectId,
      })
      .from(notifications)
      .where(eq(notifications.kind, "content_hidden"));
    expect(hidden).toStrictEqual([{ userId: author, subjectId: entryId }]);
  });

  it("hands a kit to review when a report came in while it was held", async () => {
    const { entryId } = await posted();
    await takeDown("entry", entryId);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));
    await reported("entry", entryId);

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
  });

  it("hands a photo to review rather than to screening", async () => {
    const { author, photoId } = await posted();
    await takeDown("photo", photoId);
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    await reported("photo", photoId);
    await core().delete(notifications);

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await screenOf(photoId)).toBe("hidden_pending_review");
    const hidden = await core()
      .select({ userId: notifications.userId, kind: notifications.kind })
      .from(notifications);
    expect(hidden).toStrictEqual([{ userId: author, kind: "content_hidden" }]);
  });

  it("hands a kit to review while a removal request that may hide names it", async () => {
    const { entryId } = await posted();
    await takeDown("entry", entryId);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));
    await requested(entryId, "held");

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
  });

  it("restores past a request still waiting on its confirm, and tells nobody", async () => {
    const { entryId } = await posted();
    await takeDown("entry", entryId);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));
    await requested(entryId, "confirm");
    await core().delete(notifications);

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(entryId)).toBe("ok");
    expect(await core().select().from(notifications)).toStrictEqual([]);
  });

  it("restores past a review already decided", async () => {
    const { entryId } = await posted();
    await reported("entry", entryId);
    const [row] = await core().select({ id: reviewQueue.id }).from(reviewQueue);
    if (row === undefined) throw new Error("no row");
    await resolveReview(row.id, "desk", "approve");
    await takeDown("entry", entryId);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(entryId)).toBe("ok");
  });

  it("does the same on Case over: restore", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await inCourt(photoId);
    await reported("photo", photoId);

    expect(await restoreAfterCase(core(), "op", id, 5000)).toStrictEqual({
      outcome: "recorded",
    });

    expect(await screenOf(photoId)).toBe("hidden_pending_review");
  });

  it("names each hold's own subject to review, and gives the other back", async () => {
    const one = await posted();
    const two = await posted();
    await takeDown("entry", one.entryId);
    await takeDown("entry", two.entryId);
    await counterNotice(await holdIdOf(one.entryId));
    const { restoreAt } = await counterNotice(await holdIdOf(two.entryId));
    await reported("entry", one.entryId);
    await core().delete(notifications);

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(one.entryId)).toBe("hidden_pending_review");
    expect(await entryStatus(two.entryId)).toBe("ok");
    const told = await core()
      .select({ userId: notifications.userId })
      .from(notifications);
    expect(told).toStrictEqual([{ userId: one.author }]);
  });
});

/**
What the take-downs of held material recorded, subject by subject.
*/
async function takenDown() {
  return core()
    .select({
      subjectType: heldTakeDowns.subjectType,
      subjectId: heldTakeDowns.subjectId,
    })
    .from(heldTakeDowns)
    .orderBy(heldTakeDowns.createdAt, heldTakeDowns.actionId);
}

describe("a take-down of held material (owner, 2026-11-21)", () => {
  it("keeps a held photo, its bytes and fingerprint, and records the take-down", async () => {
    const { photoId, key } = await posted();
    await takeDown("photo", photoId);

    expect(await takeDown("photo", photoId, "intimate")).toBe("removed");

    expect(await photoRow(photoId)).toStrictEqual({
      screenStatus: "removed",
      fingerprint: "00ff00ff00ff00ff",
    });
    expect(await isStored(key)).toBe(true);
    expect(await mediaDebts()).toBe(0);
    expect(await takenDown()).toStrictEqual([
      { subjectType: "photo", subjectId: photoId },
    ]);
    expect(await takeDown("photo", photoId, "intimate")).toBe(
      "already_removed",
    );
    expect(await takenDown()).toHaveLength(1);
  });

  it("keeps a kit a moderator removes while it is held, and settles its rows", async () => {
    const { entryId, photoId } = await posted();
    await reported("entry", entryId);
    await reported("photo", photoId);
    await takeDown("entry", entryId);

    const outcome = await moderateContent(
      core(),
      {
        actorId: "desk",
        action: "remove",
        subjectType: "entry",
        subjectId: entryId,
        reason: "intimate",
      },
      quiet,
    );

    expect(outcome).toBe("removed");
    expect(await entryStatus(entryId)).toBe("removed");
    expect(await openRows()).toStrictEqual([
      { status: "removed" },
      { status: "removed" },
    ]);
    expect(await takenDown()).toStrictEqual([
      { subjectType: "entry", subjectId: entryId },
    ]);
  });

  it("keeps a held kit's photo when the kit itself is taken down", async () => {
    const { entryId, photoId, key } = await posted();
    await takeDown("photo", photoId);

    expect(await takeDown("entry", entryId, "intimate")).toBe("removed");

    expect(await entryStatus(entryId)).toBe("removed");
    expect(await isStored(key)).toBe(true);
    expect(await takenDown()).toStrictEqual([
      { subjectType: "entry", subjectId: entryId },
    ]);
  });

  it("keeps a photo on a held kit when the photo is taken down", async () => {
    const { entryId, photoId, key } = await posted();
    await takeDown("entry", entryId);

    expect(await takeDown("photo", photoId, "intimate")).toBe("removed");

    expect(await isStored(key)).toBe(true);
    expect(await takenDown()).toStrictEqual([
      { subjectType: "photo", subjectId: photoId },
    ]);
  });

  it("leaves another kit's hold alone", async () => {
    const one = await posted();
    const two = await posted();
    await takeDown("photo", one.photoId);
    await takeDown("photo", two.photoId);

    await takeDown("photo", one.photoId, "intimate");

    expect(await takenDown()).toStrictEqual([
      { subjectType: "photo", subjectId: one.photoId },
    ]);
    expect(await screenOf(two.photoId)).toBe("removed");
    expect(await entryStatus(two.entryId)).toBe("ok");
  });

  it("is never restored, and is deleted once the hold ends: no strike", async () => {
    const { author, runId, photoId, key } = await posted();
    await takeDown("photo", photoId);
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    await takeDown("photo", photoId, "intimate");

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await holdStatus(photoId)).toBe("restored");
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
    expect(await strikesWithOneMore(author)).toBe(1);
    // The take-down's own band stays on the run.
    expect(await removalsOnRun(core(), author, runId)).toHaveLength(1);
  });

  it("deletes a taken-down kit at the 30-day purge, which is a strike", async () => {
    const { author, entryId } = await posted();
    await takeDown("entry", entryId);
    await takeDown("entry", entryId, "intimate");
    const { purgeAt } = await holdOf(entryId);

    await sweepCopyrightHolds(core(), purgeAt, quiet);

    expect(await holdStatus(entryId)).toBe("purged");
    expect(await entryStatus(entryId)).toBeUndefined();
    expect(await strikesWithOneMore(author)).toBe(2);
  });

  it("waits out a litigation hold, then Case over: restore deletes at the sweep", async () => {
    const { author, photoId, key } = await posted();
    await takeDown("photo", photoId);
    const { id } = await inCourt(photoId);
    await takeDown("photo", photoId, "intimate");
    await sweepCopyrightHolds(core(), nowSeconds() + 400 * DAY, quiet);
    expect(await isStored(key)).toBe(true);

    await restoreAfterCase(core(), "op", id, 5000);
    expect(await screenOf(photoId)).toBe("removed");
    await sweepCopyrightHolds(core(), 5000, quiet);

    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
    expect(await strikesWithOneMore(author)).toBe(1);
  });

  it("deletes a kit taken down whole only once its photo's hold ends", async () => {
    const { entryId, photoId } = await posted();
    await takeDown("photo", photoId);
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    await takeDown("entry", entryId, "intimate");

    await sweepCopyrightHolds(core(), restoreAt - DAY, quiet);
    expect(await entryStatus(entryId)).toBe("removed");

    await sweepCopyrightHolds(core(), restoreAt, quiet);
    expect(await entryStatus(entryId)).toBeUndefined();
    const debts = await mediaDebts();
    await sweepCopyrightHolds(core(), restoreAt + DAY, quiet);
    expect(await mediaDebts()).toBe(debts);
  });
});

/**
A second screened photo on the kit, with its bytes.
*/
async function secondPhoto(author: string, entryId: string) {
  const photoId = newUlid();
  const key = entryPhotoKeyFor(author, entryId, photoId);
  await env.MEDIA.put(key, new Uint8Array([4, 5, 6]));
  await core().insert(entryPhotos).values({
    id: photoId,
    entryId,
    photoKey: key,
    position: 1,
    screenStatus: "pass",
  });
  return { photoId, key };
}

describe("which holds a take-down reads (owner, 2026-11-21)", () => {
  it("owes R2 nothing while a hold keeps the kit: an unnamed object stays", async () => {
    const { author, entryId, photoId } = await posted();
    const stray = entryPhotoKeyFor(author, entryId, newUlid());
    await env.MEDIA.put(stray, new Uint8Array([9]));

    await takeDown("photo", photoId);
    await takeDown("photo", photoId, "intimate");

    expect(await isStored(stray)).toBe(true);
  });

  it("deletes a held photo a moderator quarantines, which keeps its own copy", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);

    const outcome = await moderateContent(
      core(),
      {
        actorId: "desk",
        action: "quarantine",
        subjectType: "photo",
        subjectId: photoId,
        reason: "intimate",
      },
      quiet,
    );

    expect(outcome).toBe("removed");
    expect(await photoRow(photoId)).toBeUndefined();
  });

  it("leaves another photo's hold alone, and deletes the photo taken down", async () => {
    const { author, entryId, photoId } = await posted();
    const other = await secondPhoto(author, entryId);
    await takeDown("photo", photoId);

    expect(await takeDown("photo", other.photoId, "intimate")).toBe("removed");

    expect(await photoRow(other.photoId)).toBeUndefined();
    expect(await isStored(other.key)).toBe(false);
    expect(await takenDown()).toStrictEqual([]);
  });

  it("settles only the taken-down photo's review, not its kit's other photos'", async () => {
    const { author, entryId, photoId } = await posted();
    const other = await secondPhoto(author, entryId);
    await takeDown("entry", entryId);
    await reported("photo", other.photoId);

    await takeDown("photo", photoId, "intimate");

    expect(await openRows()).toStrictEqual([{ status: "pending" }]);
  });

  it("takes down a kit whose photo's hold is already taken down but whose own is not", async () => {
    const { entryId, photoId } = await posted();
    await takeDown("photo", photoId);
    await takeDown("photo", photoId, "intimate");
    await takeDown("entry", entryId);

    expect(await takeDown("entry", entryId, "intimate")).toBe("removed");

    expect(await takenDown()).toStrictEqual([
      { subjectType: "photo", subjectId: photoId },
      { subjectType: "entry", subjectId: entryId },
    ]);
    expect(await takeDown("entry", entryId, "intimate")).toBe(
      "already_removed",
    );
  });
});

/**
 * A handle whose first batch runs `first` before it: a write that lands
 * between a take-down's reads and its batch.
 */
function racedBy(first: () => Promise<void>) {
  const real = core();
  const counter = { batches: 0 };
  const batch: typeof real.batch = async (items) => {
    counter.batches += 1;
    if (counter.batches === 1) await first();
    return real.batch(items);
  };
  return new Proxy(real, {
    get(target, property, receiver): unknown {
      return property === "batch"
        ? batch
        : Reflect.get(target, property, receiver);
    },
  });
}

describe("held take-downs, in sequence (owner, 2026-11-21)", () => {
  it("gives a held kit back without its photo taken down, and deletes the photo", async () => {
    const { entryId, photoId, key } = await posted();
    await takeDown("entry", entryId);
    await takeDown("photo", photoId, "intimate");
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(entryId)).toBe("ok");
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
  });

  it("records a kit's take-down after its photo's under one hold, and deletes both at its end", async () => {
    const { author, runId, entryId, photoId, key } = await posted();
    await takeDown("entry", entryId);
    await takeDown("photo", photoId, "intimate");

    expect(await takeDown("entry", entryId, "intimate")).toBe("removed");
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));
    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await entryStatus(entryId)).toBeUndefined();
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
    // Each take-down is its own audit row: the copyright notice's band
    // goes with the restore, and both take-downs' bands stay.
    expect(await takenDown()).toStrictEqual([
      { subjectType: "photo", subjectId: photoId },
      { subjectType: "entry", subjectId: entryId },
    ]);
    expect(await removalsOnRun(core(), author, runId)).toHaveLength(2);
  });

  it("deletes at the next sweep a take-down that landed after the hold ended", async () => {
    const { photoId, key } = await posted();
    await takeDown("photo", photoId);
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    const raced = racedBy(() => sweepCopyrightHolds(core(), restoreAt, quiet));

    expect(
      await moderateContent(
        raced,
        {
          actorId: "desk",
          action: "takedown",
          subjectType: "photo",
          subjectId: photoId,
          reason: "intimate",
        },
        quiet,
      ),
    ).toBe("removed");
    expect(await holdStatus(photoId)).toBe("restored");
    expect(await screenOf(photoId)).toBe("removed");

    await sweepCopyrightHolds(core(), restoreAt + DAY, quiet);

    expect(await photoRow(photoId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
  });

  it("forgets a take-down's row the sweep after its subject's delete", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    await takeDown("photo", photoId, "intimate");
    await sweepCopyrightHolds(core(), restoreAt, quiet);
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await takenDown()).toHaveLength(1);

    await sweepCopyrightHolds(core(), restoreAt + DAY, quiet);

    expect(await takenDown()).toStrictEqual([]);
  });

  it("keeps the row of a take-down whose subject is still there", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    await takeDown("photo", photoId, "intimate");

    await sweepCopyrightHolds(core(), nowSeconds(), quiet);

    expect(await takenDown()).toHaveLength(1);
  });

  it("keeps a kit taken down under its photo's hold out when a later hold on the kit ends", async () => {
    const { entryId, photoId, key } = await posted();
    await takeDown("photo", photoId);
    await takeDown("entry", entryId, "intimate");
    await takeDown("entry", entryId);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));

    await sweepCopyrightHolds(core(), restoreAt, quiet);

    expect(await holdStatus(entryId)).toBe("restored");
    expect(await entryStatus(entryId)).toBe("removed");
    // The photo's hold still keeps the kit, so nothing is deleted yet.
    expect(await isStored(key)).toBe(true);
  });

  it("deletes that kit once its photo's hold ends too", async () => {
    const { entryId, photoId, key } = await posted();
    await takeDown("photo", photoId);
    await takeDown("entry", entryId, "intimate");
    await takeDown("entry", entryId);
    const kitHold = await counterNotice(await holdIdOf(entryId));
    await sweepCopyrightHolds(core(), kitHold.restoreAt, quiet);

    const photoHold = await counterNotice(await holdIdOf(photoId));
    await sweepCopyrightHolds(core(), photoHold.restoreAt, quiet);

    expect(await entryStatus(entryId)).toBeUndefined();
    expect(await isStored(key)).toBe(false);
  });

  it("gives back no photo whose kit was taken down while the photo was held", async () => {
    const { entryId, photoId } = await posted();
    await takeDown("photo", photoId);
    await takeDown("entry", entryId, "intimate");
    const hold = await holdOf(photoId);
    await core()
      .update(copyrightHolds)
      .set({ restoreAt: nowSeconds() - 1 })
      .where(eq(copyrightHolds.id, hold.id));

    await restoreDueHolds(core(), nowSeconds());

    expect(await holdStatus(photoId)).toBe("restored");
    expect(await screenOf(photoId)).toBe("removed");
  });

  it("keeps a fingerprint for each take-down when the kit follows its photo", async () => {
    const { entryId, photoId } = await posted();
    await takeDown("entry", entryId);
    await takeDown("photo", photoId, "intimate");
    await takeDown("entry", entryId, "intimate");
    const takeDowns = await core()
      .select({ actionId: heldTakeDowns.actionId })
      .from(heldTakeDowns);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));
    await sweepCopyrightHolds(core(), restoreAt, quiet);

    const kept = await core()
      .select({
        fingerprint: removedFingerprints.fingerprint,
        actionId: removedFingerprints.moderationActionId,
      })
      .from(removedFingerprints)
      .where(
        inArray(
          removedFingerprints.moderationActionId,
          takeDowns.map((row) => row.actionId),
        ),
      );
    expect(takeDowns).toHaveLength(2);
    expect(kept.map((row) => row.fingerprint)).toStrictEqual([
      "00ff00ff00ff00ff",
      "00ff00ff00ff00ff",
    ]);
    expect(new Set(kept.map((row) => row.actionId)).size).toBe(2);
  });
});

/**
A removal request for `location`, filed as the form files one.
*/
async function fileRequest(location: string): Promise<void> {
  await fileTakedownRequest(
    core(),
    {
      email: `${newUlid().toLowerCase()}@example.com`,
      signature: "Sam Runner",
      location,
      description: "",
      isAttested: true,
      idempotencyKey: newUlid(),
      attempt: "token",
      remoteIp: "203.0.113.9",
      isLimited: false,
    },
    {
      verify: () => Promise.resolve({ ok: true }),
      oweWhere: oweInCoreWhere,
      purge: noPurge,
    },
  );
}

/**
The one open Review row's id.
*/
async function openRowId(): Promise<string> {
  const [row] = await core()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(eq(reviewQueue.status, "pending"));
  if (row === undefined) throw new Error("no open row");
  return row.id;
}

describe("a removal request filed during a copyright hold, after the restore", () => {
  it("keeps the kit from a review's Approve", async () => {
    const { entryId } = await posted();
    await takeDown("entry", entryId);
    await fileRequest(`https://dialed.run/kit/${entryId}`);
    const { restoreAt } = await counterNotice(await holdIdOf(entryId));
    await sweepCopyrightHolds(core(), restoreAt, quiet);
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    await reported("entry", entryId);

    await resolveReview(await openRowId(), await makeUser(), "approve");

    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
  });

  it("keeps a photo from a review's Approve", async () => {
    const { author, entryId, photoId } = await posted();
    await takeDown("photo", photoId);
    await fileRequest(
      `https://dialed.run/feed/photo/entries/${author}/${entryId}/${photoId}`,
    );
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    await sweepCopyrightHolds(core(), restoreAt, quiet);
    expect(await screenOf(photoId)).toBe("hidden_pending_review");
    await reported("photo", photoId);

    await resolveReview(await openRowId(), await makeUser(), "approve");

    expect(await screenOf(photoId)).toBe("hidden_pending_review");
  });

  it("keeps a photo from a burst release", async () => {
    const { author, entryId, photoId } = await posted();
    await takeDown("photo", photoId);
    await fileRequest(
      `https://dialed.run/feed/photo/entries/${author}/${entryId}/${photoId}`,
    );
    const { restoreAt } = await counterNotice(await holdIdOf(photoId));
    await sweepCopyrightHolds(core(), restoreAt, quiet);
    const queueId = newUlid();
    await core().insert(reviewQueue).values({
      id: queueId,
      subjectType: "photo",
      subjectId: photoId,
      source: "fingerprint",
      status: "pending",
      createdAt: nowSeconds(),
      openedAt: nowSeconds(),
    });

    await releaseReview(queueId, await makeUser());

    expect(await screenOf(photoId)).toBe("hidden_pending_review");
  });
});
