import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  entryPhotos,
  moderationActions,
  removedFingerprints,
  reviewQueue,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoIdOf } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
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
  quiet,
  sceneJpeg,
} from "../fixtures/scenes";

import { makeEntry, makeRun, makeUser, resetTables } from "../feed/helpers";

/**
 * D-147 (design 152): a photo removed as an intimate image keeps its
 * fingerprint, and a later kit photo within the match distance of it is
 * held for review instead of screened and published.
 */

const core = () => drizzle(env.DIALED_CORE);
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
        moderationActionId: action?.id,
      },
    ]);
  });

  it("keeps every photo's on a removed kit, and nothing for one without a fingerprint", async () => {
    const kit = await aKit();
    const one = await sceneJpeg(1);
    const two = await sceneJpeg(2);
    await posted(one, kit);
    await posted(two, kit);
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
    expect(row?.removedMatch?.distance).toBe(0);
    expect(row?.removedMatch?.removedAt).toBeGreaterThan(0);
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
    expect(row?.removedMatch).toBeUndefined();
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
    await aKept(nearRow?.fingerprint ?? "", 100);

    const found = await removedMatchesOf(core(), [
      near.photoId,
      far.photoId,
      unprinted,
      newUlid(),
    ]);

    expect(found.size).toBe(2);
    expect(found.get(near.photoId)).toStrictEqual({
      distance: 0,
      removedAt: 100,
    });
    expect(found.has(far.photoId)).toBe(true);
    expect(found.get(far.photoId)).toBeUndefined();
  });
});

async function aKept(fingerprint: string, createdAt: number) {
  await core().insert(removedFingerprints).values({
    id: newUlid(),
    fingerprint,
    moderationActionId: newUlid(),
    createdAt,
  });
}

describe("removedMatchOf", () => {
  it("matches at 8 bits and not at 9", async () => {
    await aKept("0000000000000000", 100);

    expect(await removedMatchOf(core(), "00000000000000ff")).toStrictEqual({
      distance: 8,
      removedAt: 100,
    });
    expect(await removedMatchOf(core(), "00000000000001ff")).toBeUndefined();
  });

  it("answers with the nearest, and the earliest of equals", async () => {
    await aKept("000000000000000f", 300);
    await aKept("0000000000000003", 200);
    await aKept("0000000000000003", 100);

    expect(await removedMatchOf(core(), "0000000000000000")).toStrictEqual({
      distance: 2,
      removedAt: 100,
    });
  });

  it("refuses a value that is not a fingerprint, rather than spell it into SQL", async () => {
    await expect(removedMatchOf(core(), "'; drop table x")).rejects.toThrow();
  });
});
