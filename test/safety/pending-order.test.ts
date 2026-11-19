import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { entryPhotos, wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  pendingEntryPhotos,
  pendingGarmentPhotos,
} from "../../src/modules/safety/screening/screening";

import {
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  resetSafetyTables,
} from "./helpers";

/**
 * Design 232: the screening sweep reads pending photos in random order, so
 * photos that never get an answer cannot fill every firing's read. Two
 * pending photos and a read of one: forty reads all landing on the same
 * photo is a one-in-half-a-trillion chance, and with no order SQLite
 * returns the same one every time.
 */
const READS = 40;

function core() {
  return drizzle(env.DIALED_CORE);
}

async function pendingKitPhoto(): Promise<string> {
  const userId = await makeUser();
  const entryId = await makeEntry({ userId, runId: await makeRun({ userId }) });
  const id = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id,
      entryId,
      photoKey: `entries/x/${entryId}/${id}.jpg`,
      position: 0,
      screenStatus: "pending",
    });
  return id;
}

async function pendingGarmentPhoto(): Promise<string> {
  const userId = await makeUser();
  const itemId = await makeItem({ userId });
  await core()
    .update(wardrobeItems)
    .set({ visibility: "pending", photoKey: `items/${userId}/${itemId}.jpg` })
    .where(eq(wardrobeItems.id, itemId));
  return itemId;
}

beforeEach(resetSafetyTables);

describe("the screening sweep's read (design 232)", () => {
  it("does not read the same kit photo first every time", async () => {
    const both = new Set([await pendingKitPhoto(), await pendingKitPhoto()]);

    const seen = new Set<string>();
    for (let n = 0; n < READS; n += 1) {
      const read = await pendingEntryPhotos(1);
      for (const photo of read) seen.add(photo.photoId);
    }

    expect(seen).toStrictEqual(both);
  });

  it("does not read the same garment photo first every time", async () => {
    const both = new Set([
      await pendingGarmentPhoto(),
      await pendingGarmentPhoto(),
    ]);

    const seen = new Set<string>();
    for (let n = 0; n < READS; n += 1) {
      const read = await pendingGarmentPhotos(1);
      for (const photo of read) {
        seen.add(photo.photoId);
      }
    }

    expect(seen).toStrictEqual(both);
  });
});
