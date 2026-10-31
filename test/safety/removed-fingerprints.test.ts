import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  entryPhotos,
  moderationActions,
  removedFingerprints,
  reviewQueue,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoIdOf } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { FINGERPRINT_HOLDS_PER_HOUR } from "../../src/modules/safety/breakers";
import { moderateContent } from "../../src/modules/feed/moderation";
import { uploadPhoto } from "../../src/modules/feed/photos";
import type { Classify } from "../../src/modules/safety";
import {
  removedMatchOf,
  removedMatchesOf,
} from "../../src/modules/safety/removed-fingerprints";
import { pendingReviewQueue } from "../../src/modules/safety/review";
import type { RemovalReason } from "../../src/modules/safety/contracts";
import {
  copyOf,
  fingerprintOfBytes,
  flatJpeg,
  quiet,
  sceneJpeg,
  withBitsSet,
} from "../fixtures/scenes";

import { makeEntry, makeRun, makeUser, resetTables } from "../feed/helpers";
import { opened } from "./helpers";

/**
 * D-147 (design 152): a photo removed as an intimate image keeps its
 * fingerprint, and a later kit photo within the match distance of it is
 * held for review instead of screened and published.
 */

const core = () => drizzle(env.DIALED_CORE);

/**
 * A fingerprint the distances are measured from: 32 bits set, so it and
 * everything a few bits from it are distinctive (design 164).
 */
const BASE = "00000000ffffffff";
const byText = (a: string, b: string) => a.localeCompare(b);

/**
A classifier that is never reached for an answer: screening is not what is under test.
*/
const unscreened: Classify = () => Promise.reject(new Error("not screened"));

async function aKit() {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId });
  return { userId, entryId };
}

async function posted(
  bytes: Uint8Array,
  kit?: { userId: string; entryId: string },
  classify: Classify = unscreened,
) {
  const { userId, entryId } = kit ?? (await aKit());
  const key = await uploadPhoto(
    {
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: new Uint8Array(bytes).buffer,
    },
    { classify },
  );
  return { userId, entryId, photoId: entryPhotoIdOf(key) };
}

async function removed(
  subjectType: "photo" | "entry",
  subjectId: string,
  overrides: Partial<{
    reason: RemovalReason;
    action: "remove" | "takedown" | "quarantine";
  }> = {},
) {
  await moderateContent(
    core(),
    {
      actorId: await makeUser(),
      action: overrides.action ?? "remove",
      subjectType,
      subjectId,
      reason: overrides.reason ?? "intimate",
    },
    quiet,
  );
}

async function keptRows() {
  return core()
    .select({
      fingerprint: removedFingerprints.fingerprint,
      photoId: removedFingerprints.photoId,
      moderationActionId: removedFingerprints.moderationActionId,
    })
    .from(removedFingerprints);
}

async function photoRow(photoId: string) {
  const [row] = await core()
    .select({ screenStatus: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
  return row;
}

async function queueRows() {
  return core()
    .select({
      subjectType: reviewQueue.subjectType,
      subjectId: reviewQueue.subjectId,
      source: reviewQueue.source,
      status: reviewQueue.status,
    })
    .from(reviewQueue);
}

beforeEach(resetTables);
beforeEach(async () => {
  await core().delete(removedFingerprints);
  await core().delete(reviewQueue);
  await core().delete(moderationActions);
  vi.spyOn(env.EMAIL, "send").mockRejectedValue(new Error("sender down"));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a Remove for `intimate` keeps the fingerprints (D-147)", () => {
  it("keeps the removed photo's fingerprint, naming its audit row", async () => {
    const bytes = await sceneJpeg(1);
    const { photoId } = await posted(bytes);

    await removed("photo", photoId, { action: "takedown" });

    const [action] = await core()
      .select({ id: moderationActions.id })
      .from(moderationActions);
    expect(await keptRows()).toStrictEqual([
      {
        fingerprint: await fingerprintOfBytes(bytes),
        photoId,
        moderationActionId: action?.id,
      },
    ]);
  });

  it("keeps every photo's on a removed kit, and nothing for one without a fingerprint", async () => {
    const kit = await aKit();
    const one = await sceneJpeg(1);
    const two = await sceneJpeg(2);
    const first = await posted(one, kit);
    const second = await posted(two, kit);
    // A photo uploaded before fingerprints.
    await core().insert(entryPhotos).values({
      id: newUlid(),
      entryId: kit.entryId,
      photoKey: "entries/old",
      position: 2,
    });

    await removed("entry", kit.entryId);

    const rows = await keptRows();
    expect(rows.map((row) => row.fingerprint).toSorted(byText)).toStrictEqual(
      [await fingerprintOfBytes(one), await fingerprintOfBytes(two)].toSorted(
        byText,
      ),
    );
    // Each under its own photo's id, not the kit's (round 41 #84).
    expect(rows.map((row) => row.photoId ?? "").toSorted(byText)).toStrictEqual(
      [first.photoId, second.photoId].toSorted(byText),
    );
  });

  it("keeps only the photo removed, not the rest of its kit", async () => {
    const kit = await aKit();
    const { photoId } = await posted(await sceneJpeg(1), kit);
    await posted(await sceneJpeg(2), kit);

    await removed("photo", photoId);

    expect(await keptRows()).toHaveLength(1);
  });

  it("keeps nothing for any other reason", async () => {
    const { photoId } = await posted(await sceneJpeg(1));

    await removed("photo", photoId, { reason: "explicit" });

    expect(await keptRows()).toStrictEqual([]);
  });

  it("keeps nothing for a picture too plain to tell from others (design 164)", async () => {
    const { photoId } = await posted(await flatJpeg());

    await removed("photo", photoId);

    expect(await keptRows()).toStrictEqual([]);
  });

  it("keeps the band's edges and nothing a bit past either (design 164)", async () => {
    const kit = await aKit();
    const prints = [7, 8, 56, 57].map((bits) => withBitsSet(bits));
    for (const [position, fingerprint] of prints.entries()) {
      await core()
        .insert(entryPhotos)
        .values({
          id: newUlid(),
          entryId: kit.entryId,
          photoKey: `entries/${String(position)}`,
          position,
          fingerprint,
        });
    }

    await removed("entry", kit.entryId);

    const rows = await keptRows();
    expect(rows.map((row) => row.fingerprint).toSorted(byText)).toStrictEqual(
      [withBitsSet(8), withBitsSet(56)].toSorted(byText),
    );
  });

  it("keeps nothing for a quarantine, which keeps its own snapshot", async () => {
    const { photoId } = await posted(await sceneJpeg(1));

    await removed("photo", photoId, { action: "quarantine" });

    expect(await keptRows()).toStrictEqual([]);
  });
});

describe("a copy of a removed image is held for review (D-147)", () => {
  it("is stored hidden, queued as a fingerprint row, and never screened", async () => {
    const bytes = await sceneJpeg(4);
    const first = await posted(bytes);
    await removed("photo", first.photoId);
    const classify = vi.fn<Classify>(unscreened);

    const again = await posted(await copyOf(bytes), undefined, classify);

    expect(await photoRow(again.photoId)).toStrictEqual({
      screenStatus: "hidden_pending_review",
    });
    expect(await queueRows()).toContainEqual({
      subjectType: "photo",
      subjectId: again.photoId,
      source: "fingerprint",
      status: "pending",
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it("holds one under the fingerprint breaker's ceiling (design 164)", async () => {
    const bytes = await sceneJpeg(4);
    const first = await posted(bytes);
    await removed("photo", first.photoId);
    await opened("fingerprint", FINGERPRINT_HOLDS_PER_HOUR - 1, nowSeconds());

    const again = await posted(await copyOf(bytes));

    expect(await photoRow(again.photoId)).toStrictEqual({
      screenStatus: "hidden_pending_review",
    });
  });

  it("screens one past the ceiling instead, queuing nothing (design 164)", async () => {
    const bytes = await sceneJpeg(4);
    const first = await posted(bytes);
    await removed("photo", first.photoId);
    await opened("fingerprint", FINGERPRINT_HOLDS_PER_HOUR, nowSeconds());
    const classify = vi.fn<Classify>(unscreened);

    const again = await posted(await copyOf(bytes), undefined, classify);

    expect(await photoRow(again.photoId)).toStrictEqual({
      screenStatus: "pending",
    });
    expect(classify).toHaveBeenCalledOnce();
    const queued = await queueRows();
    expect(queued.map((row) => row.subjectId)).not.toContain(again.photoId);
  });

  it("never holds a plain picture, whatever was kept (design 164)", async () => {
    await aKept("0000000000000000", 100);

    const { photoId } = await posted(await flatJpeg());

    expect(await photoRow(photoId)).toStrictEqual({ screenStatus: "pending" });
    expect(await queueRows()).toStrictEqual([]);
  });

  it("leaves a different picture to the classifier, with nothing queued", async () => {
    const first = await posted(await sceneJpeg(1));
    await removed("photo", first.photoId);
    const classify = vi.fn<Classify>(unscreened);

    const other = await posted(await sceneJpeg(2), undefined, classify);

    expect(await photoRow(other.photoId)).toStrictEqual({
      screenStatus: "pending",
    });
    expect(await queueRows()).toStrictEqual([]);
    expect(classify).toHaveBeenCalledOnce();
  });

  it("shows on Review what it matched, beside the search for other copies", async () => {
    const bytes = await sceneJpeg(4);
    const first = await posted(bytes);
    await removed("photo", first.photoId);
    const again = await posted(bytes);

    const rows = await pendingReviewQueue();

    const row = rows.find((r) => r.subjectId === again.photoId);
    expect(row?.source).toBe("fingerprint");
    const [handle] = await core()
      .select({ username: userProfiles.username })
      .from(userProfiles)
      .where(eq(userProfiles.userId, first.userId));
    expect(row?.removedMatches).toMatchObject([
      {
        id: first.photoId,
        kind: "kit",
        handle: handle?.username,
        distance: 0,
      },
    ]);
    expect(row?.removedMatches?.[0]?.removedAt).toBeGreaterThan(0);
    expect(row?.photoMatches?.fingerprinted).toBe(true);
    expect(row?.otherPhotos).toBeDefined();
  });

  it("says nothing of a removed image on a row anything else started", async () => {
    const bytes = await sceneJpeg(4);
    const first = await posted(bytes);
    await removed("photo", first.photoId);
    const again = await posted(bytes);
    // The same photo, now on Review for the classifier instead.
    await core()
      .update(reviewQueue)
      .set({ source: "classifier" })
      .where(eq(reviewQueue.subjectId, again.photoId));

    const rows = await pendingReviewQueue();

    const row = rows.find((r) => r.subjectId === again.photoId);
    expect(row?.source).toBe("classifier");
    expect(row?.removedMatches).toBeUndefined();
  });
});

describe("removedMatchesOf", () => {
  it("answers each fingerprinted photo, and skips one without a fingerprint or gone", async () => {
    const kit = await aKit();
    const near = await posted(await sceneJpeg(1), kit);
    const far = await posted(await sceneJpeg(2), kit);
    const unprinted = newUlid();
    await core().insert(entryPhotos).values({
      id: unprinted,
      entryId: kit.entryId,
      photoKey: "entries/old",
      position: 2,
    });
    const [nearRow] = await core()
      .select({ fingerprint: entryPhotos.fingerprint })
      .from(entryPhotos)
      .where(eq(entryPhotos.id, near.photoId));
    await aKept(nearRow?.fingerprint ?? "", 100, { photoId: "ph-gone" });

    const found = await removedMatchesOf(core(), [
      near.photoId,
      far.photoId,
      unprinted,
      newUlid(),
    ]);

    expect(found.size).toBe(2);
    expect(found.get(near.photoId)).toMatchObject([
      { id: "ph-gone", distance: 0, removedAt: 100 },
    ]);
    expect(found.get(far.photoId)).toStrictEqual([]);
  });

  it("lists every removal in range, nearest first and the earliest of equals, and none past 8 bits", async () => {
    const { photoId } = await printed(BASE);
    await aKept("00000000fffffff0", 300, { photoId: "ph-4" });
    await aKept("00000000fffffffc", 200, { photoId: "ph-2b" });
    await aKept("00000000fffffffc", 100, { photoId: "ph-2a" });
    await aKept("00000000fffffe00", 50, { photoId: "ph-9" });

    const found = await removedMatchesOf(core(), [photoId]);

    expect(found.get(photoId)?.map((image) => image.id)).toStrictEqual([
      "ph-2a",
      "ph-2b",
      "ph-4",
    ]);
    expect(found.get(photoId)?.map((image) => image.distance)).toStrictEqual([
      2, 2, 4,
    ]);
  });

  it("lists nothing for a held photo too plain to match by (design 164)", async () => {
    const { photoId } = await printed("0000000000000000");
    await aKept("0000000000000000", 100);

    const found = await removedMatchesOf(core(), [photoId]);

    expect(found.get(photoId)).toStrictEqual([]);
  });

  it("names a garment as one, and whose it was", async () => {
    const { photoId } = await printed(BASE);
    const ownerId = await makeUser({ username: "j_runs" });
    await aKept(BASE, 100, {
      photoId: "g-1",
      subjectType: "garment",
      ownerId,
    });

    const found = await removedMatchesOf(core(), [photoId]);
    const [image] = found.get(photoId) ?? [];

    expect(image).toMatchObject({
      id: "g-1",
      kind: "garment",
      handle: "j_runs",
    });
  });

  it("falls back to the Remove's subject for a row kept before the photo's id, with no handle for an owner without one", async () => {
    const { photoId } = await printed(BASE);
    await aKept(BASE, 100, {
      isLegacy: true,
      subjectId: "ph-old",
      ownerId: newUlid(),
    });

    const found = await removedMatchesOf(core(), [photoId]);
    const [image] = found.get(photoId) ?? [];

    expect(image).toMatchObject({ id: "ph-old", kind: "kit" });
    expect(image?.handle).toBeUndefined();
    expect(image?.keptId).toEqual(expect.any(String));
  });
});

/**
A kit photo with a fingerprint written straight in, for the distances.
*/
async function printed(fingerprint: string) {
  const kit = await aKit();
  const photoId = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id: photoId,
      entryId: kit.entryId,
      photoKey: `entries/${photoId}`,
      position: 0,
      fingerprint,
    });
  return { photoId };
}

/**
 * A kept fingerprint and the Remove that kept it, as one batch writes
 * them: Review reads the Remove for whose it was.
 */
async function aKept(
  fingerprint: string,
  createdAt: number,
  of: Partial<{
    photoId: string;
    /**
    Kept before the photo's id was: the column holds NULL.
    */
    isLegacy: boolean;
    subjectType: "photo" | "garment";
    subjectId: string;
    ownerId: string;
  }> = {},
) {
  const actionId = newUlid();
  await core()
    .insert(moderationActions)
    .values({
      id: actionId,
      actorId: "rev",
      action: "remove",
      subjectType: of.subjectType ?? "photo",
      subjectId: of.subjectId ?? newUlid(),
      subjectOwnerId: of.ownerId,
      reason: "intimate",
      createdAt,
    });
  await core()
    .insert(removedFingerprints)
    .values({
      id: newUlid(),
      fingerprint,
      photoId: of.isLegacy === true ? undefined : (of.photoId ?? newUlid()),
      moderationActionId: actionId,
      createdAt,
    });
}

describe("removedMatchOf", () => {
  it("matches at 8 bits and not at 9", async () => {
    await aKept(BASE, 100);

    expect(await removedMatchOf(core(), "00000000ffffff00")).toStrictEqual({
      distance: 8,
      removedAt: 100,
    });
    expect(await removedMatchOf(core(), "00000000fffffe00")).toBeUndefined();
  });

  it("answers with the nearest, and the earliest of equals", async () => {
    await aKept("00000000fffffff0", 300);
    await aKept("00000000fffffffc", 200);
    await aKept("00000000fffffffc", 100);

    expect(await removedMatchOf(core(), BASE)).toStrictEqual({
      distance: 2,
      removedAt: 100,
    });
  });

  it("matches nothing by a fingerprint too plain to tell from others (design 164)", async () => {
    await aKept("0000000000000000", 100);

    expect(await removedMatchOf(core(), "0000000000000000")).toBeUndefined();
  });

  it("refuses a value that is not a fingerprint, rather than spell it into SQL", async () => {
    await expect(removedMatchOf(core(), "'; drop table x")).rejects.toThrow();
  });
});
