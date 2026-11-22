import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { entryPhotos, reviewQueue } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { PHOTOS_HELD_AT_ONCE } from "../../src/lib/photo-constraints";
import { hasPhotosHeldAtLimit } from "../../src/modules/safety";
import { heldGarmentPhotos } from "../held-photo-rows";
import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
`n` kit photos of the runner's, each held by the classifier in Review.
*/
async function heldKitPhotos(userId: string, n: number): Promise<void> {
  const entryId = await makeEntry({
    userId,
    runId: await makeRun({ userId }),
  });
  for (let index = 0; index < n; index += 1) {
    const photoId = newUlid();
    await core()
      .insert(entryPhotos)
      .values({
        id: photoId,
        entryId,
        photoKey: `entries/${userId}/${entryId}/${photoId}`,
        position: index,
      });
    await queueAbout("photo", photoId);
  }
  // The kit itself held too: a row about the kit is not one of its photos.
  await queueAbout("entry", entryId);
}

async function queueAbout(
  subjectType: (typeof reviewQueue.$inferInsert)["subjectType"],
  subjectId: string,
): Promise<void> {
  await core().insert(reviewQueue).values({
    id: newUlid(),
    subjectType,
    subjectId,
    source: "classifier",
    status: "pending",
    createdAt: 1,
    openedAt: 1,
  });
}

describe("hasPhotosHeldAtLimit", () => {
  beforeEach(resetSafetyTables);

  it("is ten", () => {
    expect(PHOTOS_HELD_AT_ONCE).toBe(10);
  });

  it("lets a runner with one fewer than the limit held through", async () => {
    const userId = await makeUser();
    await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE - 1);

    expect(await hasPhotosHeldAtLimit(userId)).toBe(false);
  });

  it("is reached at the limit", async () => {
    const userId = await makeUser();
    await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE);

    expect(await hasPhotosHeldAtLimit(userId)).toBe(true);
  });

  it("counts kit photos and garment photos together", async () => {
    const userId = await makeUser();
    await heldKitPhotos(userId, 5);
    await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE - 5);

    expect(await hasPhotosHeldAtLimit(userId)).toBe(true);
  });

  it("does not count a row about the runner's kit or profile", async () => {
    const userId = await makeUser();
    await heldKitPhotos(userId, 1);
    await queueAbout("profile", userId);
    await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE - 2);

    expect(await hasPhotosHeldAtLimit(userId)).toBe(false);
  });

  it("counts a row a reviewer has open", async () => {
    const userId = await makeUser();
    await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE - 1);
    await heldGarmentPhotos(userId, 1, { status: "reviewing" });

    expect(await hasPhotosHeldAtLimit(userId)).toBe(true);
  });

  it.each(["approved", "removed"] as const)(
    "does not count a row already %s",
    async (status) => {
      const userId = await makeUser();
      await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE - 1);
      await heldGarmentPhotos(userId, 1, { status });

      expect(await hasPhotosHeldAtLimit(userId)).toBe(false);
    },
  );

  it.each(["reports", "fingerprint", "unscreened"] as const)(
    "counts only the classifier's holds, not a row %s opened",
    async (source) => {
      const userId = await makeUser();
      await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE - 1);
      await heldGarmentPhotos(userId, 1, { source });

      expect(await hasPhotosHeldAtLimit(userId)).toBe(false);
    },
  );

  it("does not count another runner's held photos", async () => {
    const userId = await makeUser();
    await heldGarmentPhotos(userId, PHOTOS_HELD_AT_ONCE - 1);
    await heldGarmentPhotos(await makeUser(), 1);

    expect(await hasPhotosHeldAtLimit(userId)).toBe(false);
  });
});
