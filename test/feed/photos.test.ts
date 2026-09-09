import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, getEntryDetail } from "../../src/modules/feed/entries";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  InvalidPhotoError,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ENTRY,
  getPhotoObject,
  isPhotoVisible,
  photoKeyFor,
  photoUploadFrom,
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

  it("refuses to add a photo to another user's entry, and says so", async () => {
    const owner = await makeUser();
    const attacker = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId });

    const attempt = uploadPhoto({
      userId: attacker,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
    });
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attempt).rejects.toThrow(/another user's entry/);
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

async function ownEntry(): Promise<{ userId: string; entryId: string }> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId });
  return { userId, entryId };
}

describe("entry photos: the rules, and what they say", () => {
  beforeEach(resetTables);

  it("names the rule that was broken", async () => {
    // Each of these reaches the runner as the reason their upload failed.
    const { userId, entryId } = await ownEntry();

    await expect(
      uploadPhoto({
        userId,
        entryId,
        contentType: "image/gif",
        bytes: JPEG_BYTES,
      }),
    ).rejects.toThrow(/unsupported photo type/);

    await expect(
      uploadPhoto({
        userId,
        entryId: newUlid(),
        contentType: "image/jpeg",
        bytes: JPEG_BYTES,
      }),
    ).rejects.toThrow(/entry not found/);
  });

  it("refuses a file over ten megabytes, and takes one of exactly ten", async () => {
    // `>`, not `>=`: ten megabytes is the cap, not one byte under it.
    const { userId, entryId } = await ownEntry();

    await expect(
      uploadPhoto({
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: new ArrayBuffer(MAX_PHOTO_BYTES + 1),
      }),
    ).rejects.toThrow(/too large/);

    await expect(
      uploadPhoto({
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: new ArrayBuffer(MAX_PHOTO_BYTES),
      }),
    ).resolves.toBeTruthy();
  });

  it("says how many photos an entry may hold", async () => {
    const { userId, entryId } = await ownEntry();
    for (let index = 0; index < MAX_PHOTOS_PER_ENTRY; index += 1) {
      await uploadPhoto({
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: JPEG_BYTES,
      });
    }

    await expect(
      uploadPhoto({
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: JPEG_BYTES,
      }),
    ).rejects.toThrow(
      new RegExp(`at most ${String(MAX_PHOTOS_PER_ENTRY)} photos`),
    );
  });

  it("stores the photo with the type it was uploaded as", async () => {
    // Served straight back on the GET route; without the metadata the
    // browser is handed `application/octet-stream` and offers a download.
    const { userId, entryId } = await ownEntry();

    const key = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/webp",
      bytes: JPEG_BYTES,
    });

    const object = await env.MEDIA.get(key);
    expect(object?.httpMetadata?.contentType).toBe("image/webp");
  });

  it("returns the same key for a resubmitted upload, without storing it twice", async () => {
    // Law 8b: a retried submission carries the key it was minted with, and
    // a repeat must not burn one of the four slots on the same image.
    const { userId, entryId } = await ownEntry();
    const idempotencyKey = newUlid();

    const first = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
      idempotencyKey,
    });
    const second = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
      idempotencyKey,
    });

    expect(second).toBe(first);
    const detail = await getEntryDetail(entryId, userId);
    expect(detail?.photoKeys).toStrictEqual([first]);
  });

  it("treats an upload with no key as a new photo every time", async () => {
    const { userId, entryId } = await ownEntry();

    const first = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
    });
    const second = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
    });

    expect(second).not.toBe(first);
  });

  it("says a photo on an entry that does not exist is not visible", async () => {
    const viewer = await makeUser();
    expect(await isPhotoVisible(newUlid(), viewer)).toBe(false);
  });

  it("says a photo whose entry has since gone is not visible", async () => {
    // The photo row outlives the entry only if a delete went half-done,
    // and "visible by default" is the wrong way to be wrong about it.
    const { userId, entryId } = await ownEntry();
    const key = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
    });
    await drizzle(env.DIALED_CORE)
      .delete(outfitEntries)
      .where(eq(outfitEntries.id, entryId));

    expect(await isPhotoVisible(key, userId)).toBe(false);
  });

  it("hands back the stored object for a key it wrote", async () => {
    const { userId, entryId } = await ownEntry();
    const key = await uploadPhoto({
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: JPEG_BYTES,
    });

    const object = await getPhotoObject(key);

    expect(object).not.toBeNull();
    expect(await object?.arrayBuffer()).toStrictEqual(JPEG_BYTES);
  });

  it("hands back nothing for a key it never wrote", async () => {
    expect(await getPhotoObject("entries/nobody/nothing/none")).toBeNull();
  });

  it("caps a photo at ten mebibytes", () => {
    // The number a runner is shown ("10 MB") and the number enforced are
    // the same number, and nothing tied them together.
    expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
  });
});

function formWith(fields: {
  entryId?: string;
  photo?: File;
  idempotencyKey?: string;
}): FormData {
  const form = new FormData();
  if (fields.entryId !== undefined) form.set("entryId", fields.entryId);
  if (fields.photo !== undefined) form.set("photo", fields.photo);
  if (fields.idempotencyKey !== undefined) {
    form.set("idempotencyKey", fields.idempotencyKey);
  }
  return form;
}

function jpeg(bytes = 10): File {
  return new File([new Uint8Array(bytes)], "photo.jpg", {
    type: "image/jpeg",
  });
}

describe("photoUploadFrom", () => {

  it("pulls the entry, the type and the file out of a multipart body", () => {
    const entryId = newUlid();
    const idempotencyKey = newUlid();

    const upload = photoUploadFrom(
      formWith({ entryId, photo: jpeg(), idempotencyKey }),
    );

    expect(upload.entryId).toBe(entryId);
    expect(upload.contentType).toBe("image/jpeg");
    expect(upload.idempotencyKey).toBe(idempotencyKey);
    expect(upload.file.size).toBe(10);
  });

  it("takes an upload with no idempotency key", () => {
    const upload = photoUploadFrom(
      formWith({ entryId: newUlid(), photo: jpeg() }),
    );
    expect(upload.idempotencyKey).toBeUndefined();
  });

  it("refuses a body that is not multipart", () => {
    expect(() => photoUploadFrom({ entryId: newUlid() })).toThrow(
      /multipart form data/,
    );
  });

  it("refuses a submission with no file in it", () => {
    expect(() => photoUploadFrom(formWith({ entryId: newUlid() }))).toThrow(
      /no photo in upload/,
    );
  });

  it("refuses an oversized file before its bytes are read", () => {
    // The declared size, not the buffered one: an oversized upload is
    // refused without being allocated in the isolate. And `>`, not `>=` —
    // ten megabytes is the cap, not one byte under it.
    expect(() =>
      photoUploadFrom(
        formWith({ entryId: newUlid(), photo: jpeg(MAX_PHOTO_BYTES + 1) }),
      ),
    ).toThrow(/too large/);
    expect(() =>
      photoUploadFrom(
        formWith({ entryId: newUlid(), photo: jpeg(MAX_PHOTO_BYTES) }),
      ),
    ).not.toThrow();
  });

  it("refuses a type the pipeline cannot store", () => {
    const gif = new File([new Uint8Array(10)], "photo.gif", {
      type: "image/gif",
    });
    expect(() =>
      photoUploadFrom(formWith({ entryId: newUlid(), photo: gif })),
    ).toThrow();
  });

  it("refuses an entry id that is not a ULID", () => {
    expect(() =>
      photoUploadFrom(formWith({ entryId: "nope", photo: jpeg() })),
    ).toThrow();
  });
});
