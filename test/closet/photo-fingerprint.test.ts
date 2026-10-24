import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { purgeAccount } from "../../src/modules/account/purge";
import {
  removeItemPhoto,
  uploadItemPhoto,
} from "../../src/modules/closet/photos";
import { createItem, deleteItem } from "../../src/modules/closet/service";
import type { Classify } from "../../src/modules/safety";
import { fingerprintOfBytes, quiet, sceneJpeg } from "../fixtures/scenes";

/**
 * D-142 on the garment-photo path (design 146): the fingerprint is
 * written with the photo's key, replaced with it, cleared with it, and
 * gone with the garment.
 */

const core = drizzle(env.DIALED_CORE);

const unscreened: Classify = () => Promise.reject(new Error("not screened"));

async function garmentWithPhoto(bytes: Uint8Array) {
  const userId = newUlid();
  const item = await createItem(core, userId, {
    category: "top",
    name: "Fingerprinted shirt",
  });
  await uploadItemPhoto(
    core,
    userId,
    item.id,
    bytes,
    "image/jpeg",
    unscreened,
    quiet,
  );
  return { userId, itemId: item.id };
}

async function stored(itemId: string) {
  return core
    .select({
      photoKey: wardrobeItems.photoKey,
      photoFingerprint: wardrobeItems.photoFingerprint,
    })
    .from(wardrobeItems)
    .where(eq(wardrobeItems.id, itemId));
}

describe("garment photo fingerprints (D-142)", () => {
  it("stores the fingerprint of the bytes as uploaded, beside the key", async () => {
    const bytes = await sceneJpeg(1);
    const { itemId } = await garmentWithPhoto(bytes);

    const [row] = await stored(itemId);
    expect(row?.photoKey).not.toBeNull();
    expect(row?.photoFingerprint).toBe(await fingerprintOfBytes(bytes));
  });

  it("replaces the fingerprint when the photo is replaced", async () => {
    const { userId, itemId } = await garmentWithPhoto(await sceneJpeg(1));
    const replacement = await sceneJpeg(2);

    await uploadItemPhoto(
      core,
      userId,
      itemId,
      replacement,
      "image/jpeg",
      unscreened,
      quiet,
    );

    const [row] = await stored(itemId);
    expect(row?.photoFingerprint).toBe(await fingerprintOfBytes(replacement));
  });

  it("clears the fingerprint when the photo is removed", async () => {
    const { userId, itemId } = await garmentWithPhoto(await sceneJpeg(1));

    await removeItemPhoto(core, userId, itemId, quiet);

    const [row] = await stored(itemId);
    expect(row?.photoKey).toBeNull();
    expect(row?.photoFingerprint).toBeNull();
  });

  it("is deleted with the garment", async () => {
    const { userId, itemId } = await garmentWithPhoto(await sceneJpeg(1));

    await deleteItem(core, userId, itemId);

    expect(await stored(itemId)).toStrictEqual([]);
  });

  it("is deleted by the account purge", async () => {
    const { userId, itemId } = await garmentWithPhoto(await sceneJpeg(1));

    await purgeAccount(
      {
        core,
        weather: drizzle(env.DIALED_WEATHER),
        now: 1_757_000_000,
        revokeStrava: () => Promise.resolve(),
        importsBucket: env.IMPORTS,
        report: quiet,
      },
      userId,
    );

    expect(await stored(itemId)).toStrictEqual([]);
  });
});
