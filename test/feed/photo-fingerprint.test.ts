import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entryPhotos } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoIdOf } from "../../src/lib/entry-photo-key";
import { FINGERPRINT_MATCH_DISTANCE } from "../../src/lib/photo-fingerprint";
import { moderateContent } from "../../src/modules/feed/moderation";
import { uploadPhoto } from "../../src/modules/feed/photos";
import {
  deleteEntryPhoto,
  deleteRuns,
  retractEntry,
} from "../../src/modules/feed/retract";
import type { Classify } from "../../src/modules/safety";
import {
  bitsApart,
  copyOf,
  fingerprintOfBytes,
  quiet,
  sceneJpeg,
} from "../fixtures/scenes";

import { makeEntry, makeRun, makeUser, resetTables } from "./helpers";

/**
 * D-142 on the kit-photo path (design 146): the upload's fingerprint is
 * stored on the photo's row, a copy of the picture comes out within the
 * match distance, and every way a photo is deleted takes the fingerprint
 * with it.
 */

const core = () => drizzle(env.DIALED_CORE);

/**
A classifier that is never reached for an answer: screening is not what is under test.
*/
const unscreened: Classify = () => Promise.reject(new Error("not screened"));

async function posted(bytes: Uint8Array) {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId });
  const key = await uploadPhoto(
    {
      userId,
      entryId,
      contentType: "image/jpeg",
      bytes: new Uint8Array(bytes).buffer,
    },
    { classify: unscreened },
  );
  return { userId, entryId, photoId: entryPhotoIdOf(key) };
}

async function fingerprintOfRow(photoId: string) {
  return core()
    .select({ fingerprint: entryPhotos.fingerprint })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
}

describe("kit photo fingerprints (D-142)", () => {
  beforeEach(resetTables);
  beforeEach(() => {
    vi.spyOn(env.EMAIL, "send").mockRejectedValue(new Error("sender down"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the fingerprint of the bytes as uploaded, before the re-encode", async () => {
    const bytes = await sceneJpeg(1);
    const { photoId } = await posted(bytes);

    expect(await fingerprintOfRow(photoId)).toStrictEqual([
      { fingerprint: await fingerprintOfBytes(bytes) },
    ]);
  });

  it("gives a re-upload of the same picture the same fingerprint", async () => {
    const bytes = await sceneJpeg(3);
    const first = await posted(bytes);
    const again = await posted(bytes);

    const [one] = await fingerprintOfRow(first.photoId);
    const [two] = await fingerprintOfRow(again.photoId);
    expect(two?.fingerprint).toBe(one?.fingerprint);
    expect(one?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("puts a smaller, re-encoded copy within the match distance", async () => {
    const bytes = await sceneJpeg(4);
    const original = await posted(bytes);
    const copy = await posted(await copyOf(bytes));

    const [one] = await fingerprintOfRow(original.photoId);
    const [two] = await fingerprintOfRow(copy.photoId);
    expect(
      bitsApart(one?.fingerprint ?? "", two?.fingerprint ?? ""),
    ).toBeLessThanOrEqual(FINGERPRINT_MATCH_DISTANCE);
  });

  it("is deleted with the photo", async () => {
    const { userId, photoId } = await posted(await sceneJpeg(1));

    await deleteEntryPhoto(core(), userId, photoId, quiet);

    expect(await fingerprintOfRow(photoId)).toStrictEqual([]);
  });

  it("is deleted with the kit", async () => {
    const { userId, entryId, photoId } = await posted(await sceneJpeg(1));

    await retractEntry(core(), userId, entryId, quiet);

    expect(await fingerprintOfRow(photoId)).toStrictEqual([]);
  });

  it("is deleted when a moderator removes the photo", async () => {
    const { photoId } = await posted(await sceneJpeg(1));
    const moderator = await makeUser();

    await moderateContent(
      core(),
      {
        actorId: moderator,
        action: "takedown",
        subjectType: "photo",
        subjectId: photoId,
        reason: "intimate",
      },
      quiet,
    );

    expect(await fingerprintOfRow(photoId)).toStrictEqual([]);
  });

  it("is deleted by the account purge's sweep of every run and kit", async () => {
    const { userId, photoId } = await posted(await sceneJpeg(1));

    await deleteRuns(core(), userId, "all", quiet);

    expect(await fingerprintOfRow(photoId)).toStrictEqual([]);
  });
});
