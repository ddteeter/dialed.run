import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryPhotos,
  outfitEntries,
  photoScreenings,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { uploadItemPhoto } from "../../src/modules/closet/photos";
import { getEntryDetail } from "../../src/modules/feed/entries";
import { followingFeed } from "../../src/modules/feed/feed";
import { follow } from "../../src/modules/feed/follows";
import { photoResponse, uploadPhoto } from "../../src/modules/feed/photos";
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

/**
What the photo route answers a given viewer.
*/
async function statusFor(
  key: string,
  viewerId: string | undefined,
): Promise<number> {
  const response = await photoResponse(key, viewerId);
  return response.status;
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

    // **The half this test used to leave out, and the reason the gate did
    // not exist.** It asserted the column and stopped, so it passed for
    // months while `isPhotoVisible` asked only about the ENTRY — and a
    // photo the model called explicit was served to strangers with HTTP
    // 200 on any public entry. A test named for a behaviour has to ask
    // about the behaviour.
    const stranger = await makeUser();
    expect(await statusFor(key, stranger)).toBe(404);
    expect(await statusFor(key, undefined)).toBe(404);
    // And the owner still sees their own, which is the other half of the
    // rule: fail open for the owner, closed for the public.
    expect(await statusFor(key, userId)).toBe(200);
  });

  it("hides an unscreened photo too, which is what an outage leaves behind", async () => {
    const entryId = await anEntry();
    const userId = await userOf(entryId);

    const key = await uploadPhoto(
      {
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      { classify: unavailable },
    );

    // `pending` is not a verdict, it is the absence of one — and with no
    // OPENAI_API_KEY every photo in the app is in this state. Publishing
    // it would make the classifier's outage indistinguishable from its
    // approval.
    const stranger = await makeUser();
    expect(await statusFor(key, stranger)).toBe(404);
    expect(await statusFor(key, userId)).toBe(200);
  });

  it("serves a photo the classifier passed", async () => {
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

    // The other direction, without which "hidden" is satisfied by a route
    // that hides everything.
    expect(await statusFor(key, await makeUser())).toBe(200);
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

    // Recorded as a garment, not as an entry photo. The scope is what a
    // re-tune reads these rows by, and what tells two ids apart — an
    // item id and an entry-photo id are both ULIDs.
    const [screening] = await core()
      .select({ scope: photoScreenings.photoScope })
      .from(photoScreenings)
      .where(eq(photoScreenings.photoId, itemId));
    expect(screening?.scope).toBe("garment");
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

describe("what the screening verdict keeps off a stranger's screen", () => {
  beforeEach(resetSafetyTables);

  it("drops a flagged photo from the feed list but leaves the entry", async () => {
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });
    await uploadPhoto(
      {
        userId: author,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      { classify: explicit },
    );
    const follower = await makeUser();
    await follow(follower, author);

    const seen = await followingFeed(follower);

    // The entry is the runner's own post and stays; only the photo the
    // classifier objected to goes. Dropping the entry would be moderating
    // a kit over a picture, and leaving the photo in the list gives the
    // page an `<img>` the photo route then refuses — a broken image
    // rather than a post without a picture.
    const item = seen.items.find((row) => row.entryId === entryId);
    expect(item).toBeDefined();
    expect(item?.photoKeys).toEqual([]);
  });

  it("leaves it in the author's own feed", async () => {
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });
    await uploadPhoto(
      {
        userId: author,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      { classify: explicit },
    );

    const own = await followingFeed(author);

    // Fail open for the owner. A runner whose photo is under review still
    // sees their own post as they posted it.
    const item = own.items.find((row) => row.entryId === entryId);
    expect(item?.photoKeys).toHaveLength(1);
  });

  it("drops it from entry detail for a stranger and keeps it for the author", async () => {
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });
    await uploadPhoto(
      {
        userId: author,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]).buffer,
      },
      { classify: explicit },
    );

    const asStranger = await getEntryDetail(entryId, await makeUser());
    const asAuthor = await getEntryDetail(entryId, author);

    expect(asStranger?.photoKeys).toEqual([]);
    expect(asAuthor?.photoKeys).toHaveLength(1);
  });
});
