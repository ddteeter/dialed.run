import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, getEntryDetail } from "../../src/modules/feed/entries";
import {
  InvalidPhotoError,
  MAX_PHOTOS_PER_ENTRY,
  isPhotoVisible,
  photoKeyFor,
  uploadPhoto,
} from "../../src/modules/feed/photos";
import { makeEntry, makeRun, makeUser, resetTables } from "./helpers";

const JPEG_BYTES = new Uint8Array([1, 2, 3]).buffer;

describe("entry photos", () => {
  beforeEach(resetTables);

  it("uploads a photo under the entries/{userId}/{entryId}/{photoId} key convention", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await makeEntry({ userId, runId });

    const key = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
    });

    expect(key.startsWith(`entries/${userId}/${entryId}/`)).toBe(true);
    const detail = await getEntryDetail(entryId, userId);
    expect(detail?.photoKeys).toEqual([key]);
  });

  it("refuses to add a photo to another user's entry", async () => {
    const owner = await makeUser();
    const attacker = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId });

    await expect(
      uploadPhoto({ userId: attacker, entryId, contentType: "image/jpeg", bytes: JPEG_BYTES }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects an unsupported content type", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await makeEntry({ userId, runId });

    await expect(
      uploadPhoto({ userId, entryId, contentType: "image/gif", bytes: JPEG_BYTES }),
    ).rejects.toBeInstanceOf(InvalidPhotoError);
  });

  it(`caps photos at ${String(MAX_PHOTOS_PER_ENTRY)} per entry`, async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await makeEntry({ userId, runId });

    for (let index = 0; index < MAX_PHOTOS_PER_ENTRY; index += 1) {
      await uploadPhoto({ userId, entryId, contentType: "image/jpeg", bytes: JPEG_BYTES });
    }

    await expect(
      uploadPhoto({ userId, entryId, contentType: "image/jpeg", bytes: JPEG_BYTES }),
    ).rejects.toBeInstanceOf(InvalidPhotoError);
  });

  it("keeps a private entry's photo invisible to a stranger, visible to its owner", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId, isPublic: false });
    const key = await uploadPhoto({
      userId: owner,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
    });

    expect(await isPhotoVisible(key, stranger)).toBe(false);
    expect(await isPhotoVisible(key, owner)).toBe(true);
    expect(await isPhotoVisible(key, undefined)).toBe(false);
    // A made-up key under the same convention that was never actually
    // uploaded is never visible either.
    expect(await isPhotoVisible(photoKeyFor(owner, entryId, "nonexistent"), owner)).toBe(false);
  });
});
