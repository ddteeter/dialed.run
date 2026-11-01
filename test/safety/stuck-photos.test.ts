/**
 * D-157, design 167: a photo still pending screening a day after upload
 * goes to the Desk's review queue, once, saying whether its file is
 * missing or the classifier never answered.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { ulid } from "ulidx";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryPhotos,
  moderationActions,
  notifications,
  outbox,
  outfitEntries,
  reviewQueue,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  garmentOriginalKey,
  garmentVersionId,
} from "../../src/lib/garment-photo-key";
import { newUlid, type Ulid, ulidSchema, ulidSeconds } from "../../src/lib/ids";
import {
  clearMissingPhoto,
  MISSING_PHOTO_NOTICE,
} from "../../src/modules/feed/missing-photo";
import { decideReview } from "../../src/modules/feed/moderation";
import { nowSeconds } from "../../src/lib/now";
import {
  imageCategories,
  retryPendingScreenings,
  type CategoryScores,
  type Classify,
} from "../../src/modules/safety";
import { isStuck, STUCK_AFTER_SECONDS } from "../../src/modules/safety/stuck";

import {
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  resetSafetyTables,
} from "./helpers";

const DAY = 24 * 60 * 60;

function core() {
  return drizzle(env.DIALED_CORE);
}

function scores(overrides: Partial<CategoryScores> = {}): CategoryScores {
  const zeroes = Object.fromEntries(
    imageCategories.map((category) => [category, 0]),
  ) as CategoryScores;
  return { ...zeroes, ...overrides };
}

const clean: Classify = () =>
  Promise.resolve({ flagged: false, scores: scores() });
const explicit: Classify = () =>
  Promise.resolve({ flagged: true, scores: scores({ sexual: 0.99 }) });
const unavailable: Classify = () => Promise.reject(new Error("503"));

/**
A ULID minted `age` seconds before `now`, as an upload then would have.
*/
function mintedAgo(now: number, age: number): string {
  return ulid((now - age) * 1000);
}

/**
 * A pending entry photo uploaded `age` seconds before `now`: its id is
 * the ULID the upload minted, which is the only clock it has.
 */
async function entryPhoto(
  now: number,
  age: number,
  hasBytes = true,
): Promise<string> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, audience: "runners" });
  const photoId = mintedAgo(now, age);
  const photoKey = `entries/${userId}/${entryId}/${photoId}`;
  await core()
    .insert(entryPhotos)
    .values({ id: photoId, entryId, photoKey, position: 0 });
  if (hasBytes) {
    await env.MEDIA.put(photoKey, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }
  return photoId;
}

/**
 * A pending garment photo whose version was uploaded `age` seconds ago.
 * The garment itself is much older than its photo, so a sweep timing the
 * garment rather than the version would get this wrong.
 */
async function garmentPhoto(
  now: number,
  age: number,
  hasBytes = true,
): Promise<string> {
  const userId = await makeUser();
  const itemId = await makeItem({ userId });
  const versionKey = `items/${userId}/${itemId}/${mintedAgo(now, age)}`;
  await core()
    .update(wardrobeItems)
    .set({ photoKey: versionKey, visibility: "pending" })
    .where(eq(wardrobeItems.id, itemId));
  if (hasBytes) {
    await env.MEDIA.put(
      garmentOriginalKey(versionKey),
      new Uint8Array([1, 2, 3]),
      { httpMetadata: { contentType: "image/jpeg" } },
    );
  }
  return itemId;
}

/**
The queue as the tests read it, an unset column as `undefined`.
*/
async function queueRows() {
  const rows = await core()
    .select({
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      source: reviewQueue.source,
      status: reviewQueue.status,
      resolvedBy: reviewQueue.resolvedBy,
      resolvedAt: reviewQueue.resolvedAt,
    })
    .from(reviewQueue);
  return rows.map((row) => ({
    ...row,
    resolvedBy: row.resolvedBy ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
  }));
}

async function queuedIds(): Promise<string[]> {
  const rows = await queueRows();
  return rows.map((row) => row.subjectId);
}

async function settle(
  subjectId: string,
  status: "approved" | "removed",
  resolvedAt: number,
): Promise<void> {
  await core()
    .update(reviewQueue)
    .set({ status, resolvedBy: "operator", resolvedAt })
    .where(eq(reviewQueue.subjectId, subjectId));
}

describe("a photo still pending a day after upload", () => {
  beforeEach(resetSafetyTables);

  it("goes to the Desk as unscreened when the classifier never answers", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, DAY + 60);
    const anomalies: string[] = [];

    const report = await retryPendingScreenings(unavailable, anomalies, now);

    expect(report).toMatchObject({ considered: 1, deferred: 1, escalated: 1 });
    expect(await queueRows()).toEqual([
      {
        subjectType: "photo",
        subjectId: photoId,
        source: "unscreened",
        status: "pending",
        resolvedBy: undefined,
        resolvedAt: undefined,
      },
    ]);
    expect(anomalies).toEqual([
      `1 of 1 photos still pending after a screening sweep: photo ${photoId}`,
      `1 photos still pending a day after upload went to the Desk: photo ${photoId}`,
    ]);
  });

  it("goes as missing_file when storage has no object, and the lines say so", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, DAY + 60, false);
    const anomalies: string[] = [];

    await retryPendingScreenings(clean, anomalies, now);

    const [row] = await queueRows();
    expect(row).toMatchObject({ subjectId: photoId, source: "missing_file" });
    expect(anomalies).toEqual([
      `1 of 1 photos still pending after a screening sweep: photo ${photoId} (missing)`,
      `1 photos still pending a day after upload went to the Desk: photo ${photoId} (missing)`,
    ]);
    // Ids only (law 7): never the storage key, which names the runner.
    expect(anomalies.join(" ")).not.toContain("entries/");
  });

  it("waits until the day is out: a second short is not yet, the day itself is", async () => {
    const now = nowSeconds();
    const young = await entryPhoto(now, DAY - 1);
    const due = await entryPhoto(now, DAY);

    const report = await retryPendingScreenings(unavailable, [], now);

    expect(report.escalated).toBe(1);
    expect(await queuedIds()).toEqual([due]);
    expect(young).not.toBe(due);
  });

  it("does not go when screening lands, whatever its age", async () => {
    const now = nowSeconds();
    await entryPhoto(now, 3 * DAY);
    const anomalies: string[] = [];

    const report = await retryPendingScreenings(clean, anomalies, now);

    expect(report).toMatchObject({ passed: 1, escalated: 0 });
    expect(await queueRows()).toEqual([]);
    expect(anomalies).toEqual([]);
  });

  it("times a garment's photo from its version, not from the garment", async () => {
    const now = nowSeconds();
    const old = await garmentPhoto(now, 2 * DAY);
    const missing = await garmentPhoto(now, 2 * DAY, false);
    await garmentPhoto(now, 60);
    const anomalies: string[] = [];

    await retryPendingScreenings(unavailable, anomalies, now);

    // Oldest first by garment id, as the sweep reads them.
    const [first, second] = [old, missing].toSorted((one, other) =>
      one.localeCompare(other),
    );
    const named = (id: string | undefined) =>
      id === missing ? `garment ${id} (missing)` : `garment ${String(id)}`;
    expect(anomalies[1]).toBe(
      `2 photos still pending a day after upload went to the Desk: ${named(first)}, ${named(second)}`,
    );
    const rows = await queueRows();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectType: "garment",
          subjectId: old,
          source: "unscreened",
        }),
        expect.objectContaining({
          subjectType: "garment",
          subjectId: missing,
          source: "missing_file",
        }),
      ]),
    );
  });

  it("goes even with no classifier configured, and tells missing from waiting", async () => {
    const now = nowSeconds();
    const waiting = await entryPhoto(now, DAY + 1);
    const gone = await entryPhoto(now, DAY + 1, false);
    const anomalies: string[] = [];

    const report = await retryPendingScreenings(undefined, anomalies, now);

    expect(report).toMatchObject({ considered: 2, deferred: 2, escalated: 2 });
    const rows = await queueRows();
    expect(rows.find((row) => row.subjectId === waiting)?.source).toBe(
      "unscreened",
    );
    expect(rows.find((row) => row.subjectId === gone)?.source).toBe(
      "missing_file",
    );
    // The key line, and the Desk line; not one line per held photo.
    expect(anomalies).toHaveLength(2);
    expect(anomalies[0]).toContain("OPENAI_API_KEY");
    expect(anomalies[1]).toContain(`photo ${gone} (missing)`);
  });
});

describe("escalation re-runs safely (laws 1, 2)", () => {
  beforeEach(resetSafetyTables);

  it("makes one row however many times the hour fires", async () => {
    const now = nowSeconds();
    await entryPhoto(now, 2 * DAY);

    await retryPendingScreenings(unavailable, [], now);
    const anomalies: string[] = [];
    const second = await retryPendingScreenings(unavailable, anomalies, now);

    expect(second.escalated).toBe(0);
    expect(await queueRows()).toHaveLength(1);
    // Still pending, so still named; but nothing new went to the Desk.
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toContain("still pending after a screening sweep");
  });

  it("leaves a row a person settled within the day settled", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 3 * DAY);
    await retryPendingScreenings(unavailable, [], now);
    // Exactly a day ago is still "within": the row comes back after it.
    await settle(photoId, "approved", now - DAY);

    const report = await retryPendingScreenings(unavailable, [], now);

    expect(report.escalated).toBe(0);
    expect(await queueRows()).toEqual([
      expect.objectContaining({ status: "approved", resolvedBy: "operator" }),
    ]);
  });

  it("re-opens a row settled more than a day ago, as if new", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 3 * DAY);
    await retryPendingScreenings(unavailable, [], now);
    await settle(photoId, "approved", now - DAY - 1);

    const report = await retryPendingScreenings(unavailable, [], now);

    expect(report.escalated).toBe(1);
    expect(await queueRows()).toEqual([
      {
        subjectType: "photo",
        subjectId: photoId,
        source: "unscreened",
        status: "pending",
        resolvedBy: undefined,
        resolvedAt: undefined,
      },
    ]);
  });

  it("leaves an open row alone, whatever opened it", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 3 * DAY);
    await core().insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "photo",
      subjectId: photoId,
      source: "reports",
      status: "reviewing",
      resolvedBy: "operator",
      claimedAt: now,
      createdAt: now,
    });

    const report = await retryPendingScreenings(unavailable, [], now);

    expect(report.escalated).toBe(0);
    expect(await queueRows()).toEqual([
      expect.objectContaining({
        source: "reports",
        status: "reviewing",
        resolvedBy: "operator",
      }),
    ]);
  });
});

describe("a verdict that lands after the photo went to the Desk", () => {
  beforeEach(resetSafetyTables);

  it("settles the stuck row when it passes", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY);
    await retryPendingScreenings(unavailable, [], now);

    await retryPendingScreenings(clean, [], now);

    const [row] = await queueRows();
    expect(row).toMatchObject({
      subjectId: photoId,
      source: "unscreened",
      status: "approved",
      resolvedBy: "screening",
    });
    expect(row?.resolvedAt).toBeGreaterThanOrEqual(now);
  });

  it("settles a garment's stuck row by the garment", async () => {
    const now = nowSeconds();
    const itemId = await garmentPhoto(now, 2 * DAY);
    await retryPendingScreenings(unavailable, [], now);

    await retryPendingScreenings(clean, [], now);

    expect(await queueRows()).toEqual([
      expect.objectContaining({
        subjectType: "garment",
        subjectId: itemId,
        status: "approved",
      }),
    ]);
  });

  it("leaves a row reports opened for a person", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 60);
    await core().insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "photo",
      subjectId: photoId,
      source: "reports",
      status: "pending",
      createdAt: now,
    });

    await retryPendingScreenings(clean, [], now);

    expect(await queueRows()).toEqual([
      expect.objectContaining({ source: "reports", status: "pending" }),
    ]);
  });

  it("re-points the row to the classifier when it flags", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY);
    await retryPendingScreenings(unavailable, [], now);

    await retryPendingScreenings(explicit, [], now);

    const rows = await core()
      .select({ source: reviewQueue.source, status: reviewQueue.status })
      .from(reviewQueue)
      .where(
        and(
          eq(reviewQueue.subjectType, "photo"),
          eq(reviewQueue.subjectId, photoId),
        ),
      );
    expect(rows).toEqual([{ source: "classifier", status: "pending" }]);
  });
});

describe("the clock a photo carries", () => {
  it("reads a ULID's time in seconds", () => {
    const ms = Date.UTC(2026, 9, 31, 12, 0, 0, 999);
    expect(ulidSeconds(ulid(ms))).toBe(Math.floor(ms / 1000));
  });

  it("reads nothing from what is not a ULID", () => {
    expect(ulidSeconds("legacy-key")).toBeUndefined();
  });

  it("takes a garment photo's version from the last segment of its key", () => {
    const version = newUlid();
    expect(garmentVersionId(`items/u1/i1/${version}`)).toBe(version);
  });

  it("counts a photo with no readable time as stuck", () => {
    expect(isStuck(undefined, STUCK_AFTER_SECONDS)).toBe(true);
    expect(isStuck(1, STUCK_AFTER_SECONDS)).toBe(false);
    expect(STUCK_AFTER_SECONDS).toBe(DAY);
  });
});

/**
The open queue row a stuck photo's escalation made, by its subject.
*/
async function queueIdOf(subjectId: string): Promise<Ulid> {
  const [row] = await core()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(eq(reviewQueue.subjectId, subjectId));
  if (row === undefined) throw new Error(`no queue row for ${subjectId}`);
  return ulidSchema.parse(row.id);
}

/**
What a runner's bell says about missing photos.
*/
async function missingNotices(userId: string) {
  return core()
    .select({ subjectId: notifications.subjectId, body: notifications.body })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "photo_missing"),
      ),
    );
}

async function entryPhotoRow(photoId: string) {
  const [row] = await core()
    .select({ screenStatus: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
  return row;
}

async function ownerOfPhoto(photoId: string): Promise<string> {
  const [row] = await core()
    .select({ userId: outfitEntries.userId })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(eq(entryPhotos.id, photoId));
  if (row === undefined) throw new Error(`no photo ${photoId}`);
  return row.userId;
}

async function garmentRow(itemId: string) {
  const [row] = await core()
    .select({
      userId: wardrobeItems.userId,
      photoKey: wardrobeItems.photoKey,
      visibility: wardrobeItems.visibility,
    })
    .from(wardrobeItems)
    .where(eq(wardrobeItems.id, itemId));
  if (row === undefined) throw new Error(`no garment ${itemId}`);
  return { ...row, photoKey: row.photoKey ?? undefined };
}

describe("Approve on a stuck photo (owner, 2026-10-31)", () => {
  beforeEach(resetSafetyTables);

  it("publishes a photo the classifier never answered for", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY);
    await retryPendingScreenings(unavailable, [], now);

    const outcome = await decideReview(core(), "op", {
      queueId: await queueIdOf(photoId),
      action: "approve",
    });

    expect(outcome).toBe("resolved");
    expect(await entryPhotoRow(photoId)).toEqual({ screenStatus: "pass" });
    expect(await queueRows()).toEqual([
      expect.objectContaining({ status: "approved", resolvedBy: "op" }),
    ]);
  });

  it("leaves a missing file pending: there are no bytes to publish", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY, false);
    await retryPendingScreenings(clean, [], now);

    await decideReview(core(), "op", {
      queueId: await queueIdOf(photoId),
      action: "approve",
    });

    expect(await entryPhotoRow(photoId)).toEqual({ screenStatus: "pending" });
  });
});

describe("Clear photo on a missing file (owner, 2026-10-31)", () => {
  beforeEach(resetSafetyTables);

  it("takes a kit's photo off, settles the row and asks its owner to add it again", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY, false);
    const ownerId = await ownerOfPhoto(photoId);
    await retryPendingScreenings(clean, [], now);

    const outcome = await decideReview(core(), "op", {
      queueId: await queueIdOf(photoId),
      action: "clear",
    });

    expect(outcome).toBe("resolved");
    expect(await entryPhotoRow(photoId)).toBeUndefined();
    expect(await queueRows()).toEqual([
      expect.objectContaining({
        source: "missing_file",
        status: "removed",
        resolvedBy: "op",
      }),
    ]);
    expect(await missingNotices(ownerId)).toEqual([
      { subjectId: photoId, body: MISSING_PHOTO_NOTICE.photo },
    ]);
    // No verdict on the runner: nothing a run reads back as a removal.
    expect(await core().select().from(moderationActions)).toEqual([]);
    // The bytes were owed and the fast path settled the debt.
    expect(await core().select().from(outbox)).toEqual([]);
  });

  it("takes a garment's photo off and tells its owner in Closet words", async () => {
    const now = nowSeconds();
    const itemId = await garmentPhoto(now, 2 * DAY, false);
    const { userId } = await garmentRow(itemId);
    await retryPendingScreenings(clean, [], now);

    const outcome = await decideReview(core(), "op", {
      queueId: await queueIdOf(itemId),
      action: "clear",
    });

    expect(outcome).toBe("resolved");
    expect(await garmentRow(itemId)).toEqual({
      userId,
      photoKey: undefined,
      visibility: "ok",
    });
    expect(await queueRows()).toEqual([
      expect.objectContaining({ status: "removed", resolvedBy: "op" }),
    ]);
    expect(await missingNotices(userId)).toEqual([
      { subjectId: itemId, body: MISSING_PHOTO_NOTICE.garment },
    ]);
    expect(await core().select().from(moderationActions)).toEqual([]);
    expect(await core().select().from(outbox)).toEqual([]);
  });

  it("owes storage the kit's prefix, so a part of the upload that landed late goes", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY, false);
    await retryPendingScreenings(clean, [], now);
    const [photo] = await core()
      .select({ photoKey: entryPhotos.photoKey })
      .from(entryPhotos)
      .where(eq(entryPhotos.id, photoId));
    const late = photo?.photoKey ?? "";
    await env.MEDIA.put(late, new Uint8Array([1]));

    await decideReview(core(), "op", {
      queueId: await queueIdOf(photoId),
      action: "clear",
    });

    expect(await env.MEDIA.head(late)).toBeNull();
  });

  it("owes storage the garment's photo, so a part of the upload that landed late goes", async () => {
    const now = nowSeconds();
    const itemId = await garmentPhoto(now, 2 * DAY, false);
    await retryPendingScreenings(clean, [], now);
    const { photoKey } = await garmentRow(itemId);
    const late = garmentOriginalKey(photoKey ?? "");
    await env.MEDIA.put(late, new Uint8Array([1]));

    await decideReview(core(), "op", {
      queueId: await queueIdOf(itemId),
      action: "clear",
    });

    expect(await env.MEDIA.head(late)).toBeNull();
  });

  it("keeps a garment photo added again within the day", async () => {
    const now = nowSeconds();
    const itemId = await garmentPhoto(now, 2 * DAY, false);
    await retryPendingScreenings(clean, [], now);
    const { userId } = await garmentRow(itemId);
    const fresh = `items/${userId}/${itemId}/${mintedAgo(now, 60)}`;
    await core()
      .update(wardrobeItems)
      .set({ photoKey: fresh })
      .where(eq(wardrobeItems.id, itemId));

    const outcome = await clearMissingPhoto(
      core(),
      "op",
      await queueIdOf(itemId),
      undefined,
      now,
    );

    expect(outcome).toBe("not_found");
    expect(await garmentRow(itemId)).toMatchObject({ photoKey: fresh });
    expect(await missingNotices(userId)).toEqual([]);
  });

  it("clears nothing on a photo the classifier never answered for", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY);
    await retryPendingScreenings(unavailable, [], now);

    const outcome = await decideReview(core(), "op", {
      queueId: await queueIdOf(photoId),
      action: "clear",
    });

    expect(outcome).toBe("not_found");
    expect(await entryPhotoRow(photoId)).toEqual({ screenStatus: "pending" });
    expect(await queueRows()).toEqual([
      expect.objectContaining({ status: "pending" }),
    ]);
  });

  it("clears nothing once the photo is no longer pending", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY, false);
    await retryPendingScreenings(clean, [], now);
    await core()
      .update(entryPhotos)
      .set({ screenStatus: "flagged" })
      .where(eq(entryPhotos.id, photoId));

    const outcome = await decideReview(core(), "op", {
      queueId: await queueIdOf(photoId),
      action: "clear",
    });

    expect(outcome).toBe("not_found");
    expect(await entryPhotoRow(photoId)).toEqual({ screenStatus: "flagged" });
  });

  it("clears nothing on a garment whose photo is no longer pending", async () => {
    const now = nowSeconds();
    const itemId = await garmentPhoto(now, 2 * DAY, false);
    await retryPendingScreenings(clean, [], now);
    await core()
      .update(wardrobeItems)
      .set({ visibility: "flagged" })
      .where(eq(wardrobeItems.id, itemId));
    const before = await garmentRow(itemId);

    const outcome = await decideReview(core(), "op", {
      queueId: await queueIdOf(itemId),
      action: "clear",
    });

    expect(outcome).toBe("not_found");
    expect(await garmentRow(itemId)).toEqual(before);
    expect(before.photoKey).toMatch(/^items\//);
  });

  it("clears nothing on a subject that has no photo to clear", async () => {
    const queueId = newUlid();
    await core().insert(reviewQueue).values({
      id: queueId,
      subjectType: "product",
      subjectId: newUlid(),
      source: "missing_file",
      status: "pending",
      createdAt: nowSeconds(),
    });

    expect(await decideReview(core(), "op", { queueId, action: "clear" })).toBe(
      "not_found",
    );
  });

  it("answers a second Clear as already settled", async () => {
    const now = nowSeconds();
    const photoId = await entryPhoto(now, 2 * DAY, false);
    await retryPendingScreenings(clean, [], now);
    const queueId = await queueIdOf(photoId);
    await decideReview(core(), "op", { queueId, action: "clear" });

    expect(await decideReview(core(), "op", { queueId, action: "clear" })).toBe(
      "already_resolved",
    );
  });
});
