import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { entryPhotos, outfitEntries, wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { uploadItemPhoto } from "../../src/modules/closet/photos";
import { uploadPhoto } from "../../src/modules/feed/photos";
import {
  imageCategories,
  pendingEntryPhotos,
  pendingGarmentPhotos,
  type CategoryScores,
  type Classify,
} from "../../src/modules/safety";

import { makeEntry, makeItem, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * That the upload paths screen at all is the thing worth testing here.
 * `screening.ts` is covered on its own; what these assert is the wiring,
 * which is exactly the sort of thing that silently does not happen — a
 * photo uploaded without a screening call looks completely normal until a
 * stranger sees something they should not.
 */

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
A one-pixel PNG, so the closet path's real decode/resize can run.
*/
const PNG_PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (character) => character.codePointAt(0) ?? 0,
);

async function anEntry(): Promise<string> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  return makeEntry({ userId, runId, isPublic: true });
}

/**
The entry's author, which `makeEntry` knows and does not return.
*/
async function userOf(entryId: string): Promise<string> {
  const [row] = await core()
    .select({ userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!row) throw new Error("entry vanished");
  return row.userId;
}

describe("uploading an entry photo", () => {
  beforeEach(resetSafetyTables);

  it("screens it, so a clean photo is public straight away", async () => {
    const entryId = await anEntry();
    const userId = await userOf(entryId);
    const key = await uploadPhoto(
      {
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      { classify: clean },
    );

    expect(key).toContain(entryId);
    const [row] = await core()
      .select({ status: entryPhotos.screenStatus })
      .from(entryPhotos)
      .where(eq(entryPhotos.photoKey, key));
    expect(row?.status).toBe("pass");
  });

  it("hides a flagged photo from everyone but its owner", async () => {
    const entryId = await anEntry();
    const userId = await userOf(entryId);

    const key = await uploadPhoto(
      {
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      { classify: explicit },
    );

    const [row] = await core()
      .select({ status: entryPhotos.screenStatus })
      .from(entryPhotos)
      .where(eq(entryPhotos.photoKey, key));
    expect(row?.status).toBe("hidden_pending_review");
  });

  it("still saves the photo when the classifier is down", async () => {
    const entryId = await anEntry();
    const userId = await userOf(entryId);

    // The packet's "a classifier outage must not block anyone's own
    // logging". The upload resolves; the row lands; only public visibility
    // waits.
    const key = await uploadPhoto(
      {
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      { classify: unavailable },
    );

    expect(key).toContain(entryId);
    const [row] = await core()
      .select({ status: entryPhotos.screenStatus })
      .from(entryPhotos)
      .where(eq(entryPhotos.photoKey, key));
    expect(row?.status).toBe("pending");
    const pending = await pendingEntryPhotos();
    expect(pending.map((photo) => photo.photoKey)).toContain(key);
  });
});

describe("uploading a garment photo", () => {
  beforeEach(resetSafetyTables);

  it("marks it pending and screens it", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });

    await uploadItemPhoto(
      core(),
      userId,
      itemId,
      PNG_PIXEL,
      "image/png",
      clean,
    );

    const [row] = await core()
      .select({ visibility: wardrobeItems.visibility })
      .from(wardrobeItems)
      .where(eq(wardrobeItems.id, itemId));
    expect(row?.visibility).toBe("pass");
  });

  it("leaves it pending when the classifier is down", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });

    await uploadItemPhoto(
      core(),
      userId,
      itemId,
      PNG_PIXEL,
      "image/png",
      unavailable,
    );

    const [row] = await core()
      .select({ visibility: wardrobeItems.visibility })
      .from(wardrobeItems)
      .where(eq(wardrobeItems.id, itemId));
    expect(row?.visibility).toBe("pending");
    const pending = await pendingGarmentPhotos();
    expect(pending.map((photo) => photo.photoId)).toContain(itemId);
  });

  it("leaves a garment with no photo alone", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });

    const [row] = await core()
      .select({ visibility: wardrobeItems.visibility })
      .from(wardrobeItems)
      .where(eq(wardrobeItems.id, itemId));
    // `ok` means "never screened", which is right: most of a closet has no
    // photo, and queueing those would give the sweep nothing to fetch.
    expect(row?.visibility).toBe("ok");
    expect(await pendingGarmentPhotos()).toEqual([]);
  });
});
