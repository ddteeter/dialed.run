import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import {
  copyrightHolds,
  entryPhotos,
  notifications,
  outbox,
  outfitEntries,
  reviewQueue,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { getEntryDetail } from "../../src/modules/feed/entries";
import {
  moderateContent,
  sweepCopyrightHolds,
} from "../../src/modules/feed/moderation";
import { isPhotoVisible } from "../../src/modules/feed/photos";
import { retractEntry } from "../../src/modules/feed/retract";
import { oweInCore } from "../../src/modules/ops";
import { fileReport, resolveReview } from "../../src/modules/safety";
import {
  COPYRIGHT_HOLD_PAGE,
  COPYRIGHT_HOLD_SECONDS,
  heldCopyrightContent,
  recordCounterNotice,
  recordCourtAction,
  restoreDayAfter,
} from "../../src/modules/safety/copyright-holds";
import { removalsOnRun } from "../../src/modules/safety/run-removals";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * D-130, design 148: a copyright takedown hides for 30 days; a counter-
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

function utc(year: number, month: number, day: number, hour = 0): number {
  return Date.UTC(year, month - 1, day, hour) / 1000;
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
    expect(restoreDayAfter(utc(2026, 10, 23, 15))).toBe(utc(2026, 11, 10));
    expect(restoreDayAfter(utc(2026, 10, 23, 23) + 3599)).toBe(
      utc(2026, 11, 10),
    );
    // A weekend counts from the Monday after it.
    expect(restoreDayAfter(utc(2026, 10, 24, 9))).toBe(utc(2026, 11, 10));
    expect(restoreDayAfter(utc(2026, 10, 25, 9))).toBe(utc(2026, 11, 10));
    expect(restoreDayAfter(utc(2026, 10, 26))).toBe(utc(2026, 11, 11));
    expect(restoreDayAfter(utc(2026, 10, 22, 12))).toBe(utc(2026, 11, 9));
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
    const at = utc(2026, 10, 23, 15);

    expect(await recordCounterNotice(core(), "desk", id, at)).toStrictEqual({
      outcome: "recorded",
      counterNoticeAt: at,
      restoreAt: utc(2026, 11, 10),
    });
    expect(
      await recordCounterNotice(core(), "desk", id, at + DAY),
    ).toStrictEqual({ outcome: "already" });
    expect(await holdOf(photoId)).toMatchObject({
      counterNoticeAt: at,
      counterNoticeBy: "desk",
      restoreAt: utc(2026, 11, 10),
    });
  });

  it("records a court action only after a counter-notice, and once", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id } = await holdOf(photoId);

    expect(await recordCourtAction(core(), "desk", id, 100)).toStrictEqual({
      outcome: "no_counter_notice",
    });
    await recordCounterNotice(core(), "desk", id, 200);
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

    expect(await recordCounterNotice(core(), "desk", hold.id)).toStrictEqual({
      outcome: "gone",
    });
    expect(await recordCourtAction(core(), "desk", hold.id)).toStrictEqual({
      outcome: "gone",
    });
    expect(await recordCounterNotice(core(), "desk", newUlid())).toStrictEqual({
      outcome: "gone",
    });
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

  it("waits while a counter-notice is pending, and goes once a court action answers it", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id, purgeAt } = await holdOf(photoId);
    await recordCounterNotice(core(), "desk", id, purgeAt + 10 * DAY);

    await sweepCopyrightHolds(core(), purgeAt + DAY, quiet);
    expect(await holdStatus(photoId)).toBe("hidden");
    expect(await photoRow(photoId)).toBeDefined();

    await recordCourtAction(core(), "desk", id);
    await sweepCopyrightHolds(core(), purgeAt + 2 * DAY, quiet);
    expect(await holdStatus(photoId)).toBe("purged");
  });

  it("never restores what it purged", async () => {
    const { photoId } = await posted();
    await takeDown("photo", photoId);
    const { id, purgeAt } = await holdOf(photoId);
    await sweepCopyrightHolds(core(), purgeAt, quiet);

    await recordCounterNotice(core(), "desk", id, purgeAt);
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

  it("finishes a hold whose subject its runner deleted", async () => {
    const { author, entryId } = await posted();
    await takeDown("entry", entryId);
    const { purgeAt } = await holdOf(entryId);
    await retractEntry(core(), author, entryId, quiet);

    await sweepCopyrightHolds(core(), purgeAt, quiet);

    expect(await holdStatus(entryId)).toBe("purged");
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
    expect(COPYRIGHT_HOLD_PAGE).toBe(100);
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
  const answer = await recordCounterNotice(core(), "desk", holdId);
  if (answer.outcome !== "recorded") throw new Error(answer.outcome);
  return answer;
}
