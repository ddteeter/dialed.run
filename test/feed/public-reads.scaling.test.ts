import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  entryPhotos,
  entryTags,
  reactions,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { entryDetailForViewer } from "../../src/modules/feed/entries";
import { publicKitRead } from "../../src/modules/feed/public-kit";
import { publicProfileRead } from "../../src/modules/feed/public-profile";
import { core, expectFlat, locatedEntry, measured } from "./feed-scaling";
import { addAccount, makeItem, makeUser, NOW } from "./helpers";
import { observationWalk, seedObservation } from "./scaling-fixture";

/**
 * Design 182: the reads that list a kit's pieces, a public profile's kits
 * and closet, and one entry's garments, photos, tags and Usefuls — one of
 * each, then twenty-five. The statements stay the same; where the weather
 * side grows, it grows by `observationWalk`'s chunks, never per row.
 */

/**
A confirmed runner with a handle and a public profile and closet.
*/
async function publicRunner(): Promise<{ runner: string; handle: string }> {
  const handle = `pub_${newUlid().slice(-8).toLowerCase()}`;
  const runner = await makeUser({ username: handle });
  await addAccount(runner, true);
  await core()
    .update(userProfiles)
    .set({ publicProfile: true, publicCloset: true })
    .where(eq(userProfiles.userId, runner));
  return { runner, handle };
}

/**
`size` garments of the runner's, each with its own linkable product page.
*/
async function linkedGarments(
  userId: string,
  size: number,
  category: "top" | "shoes" = "top",
): Promise<string[]> {
  const itemIds: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const itemId = await makeItem({ userId, category });
    await core()
      .update(wardrobeItems)
      .set({ productUrl: `https://shop${String(index)}.example/item` })
      .where(eq(wardrobeItems.id, itemId));
    itemIds.push(itemId);
  }
  return itemIds;
}

async function seedPublicKits(size: number) {
  const { runner, handle } = await publicRunner();
  const [shoe] = await linkedGarments(runner, 1, "shoes");
  await seedObservation();
  for (let index = 0; index < size; index += 1) {
    await locatedEntry({
      userId: runner,
      index,
      audience: "world",
      itemIds: shoe === undefined ? [] : [shoe],
    });
  }
  return () => publicProfileRead(handle, true);
}

async function seedRotation(size: number) {
  const { runner, handle } = await publicRunner();
  const shoes = await linkedGarments(runner, size, "shoes");
  await seedObservation();
  await locatedEntry({
    userId: runner,
    index: 0,
    audience: "world",
    itemIds: shoes,
  });
  return () => publicProfileRead(handle, false);
}

async function seedKitPieces(size: number) {
  const { runner } = await publicRunner();
  const itemIds = await linkedGarments(runner, size);
  await seedObservation();
  const entryId = await locatedEntry({
    userId: runner,
    index: 0,
    audience: "world",
    itemIds,
  });
  return () => publicKitRead(entryId);
}

async function seedEntryDetail(size: number) {
  const author = await makeUser();
  await addAccount(author, true);
  const itemIds = await linkedGarments(author, size);
  await seedObservation();
  const entryId = await locatedEntry({ userId: author, index: 0, itemIds });
  for (let index = 0; index < size; index += 1) {
    await core()
      .insert(entryPhotos)
      .values({
        id: newUlid(),
        entryId,
        photoKey: `photos/${entryId}/${String(index)}.jpg`,
        position: index,
        screenStatus: "pass",
      });
    await core()
      .insert(entryTags)
      .values({ entryId, tag: `tag-${String(index)}` });
    await core()
      .insert(reactions)
      .values({ entryId, userId: newUlid(), createdAt: NOW });
  }
  // The author reading their own: flags, effort and every photo.
  return () => entryDetailForViewer(entryId, author);
}

describe("publicProfileRead", () => {
  it("lists every public kit for the same statements, weather by the walk's chunks", async () => {
    const one = await measured(1, seedPublicKits);
    const many = await measured(25, seedPublicKits);

    expect(one.result?.profile.kits).toHaveLength(1);
    expect(many.result?.profile.kits).toHaveLength(25);
    expect(many.result?.profile.kitCount).toBe(25);
    const kits = many.result?.profile.kits ?? [];
    for (const kit of kits) {
      expect(kit.conditions).toBeDefined();
    }
    expect(many.counts.core).toBe(one.counts.core);
    expect(many.counts.coreRowsRead).toBeGreaterThan(one.counts.coreRowsRead);
    // Every kit row is dated and labelled from its run's conditions
    // (`observationsForRuns`, public-profile.ts:149), so the cells grow
    // twenty to a statement.
    expect(one.counts.weather).toBe(observationWalk(1).weather);
    expect(many.counts.weather).toBe(observationWalk(25).weather);
  });

  it("lists every piece in the rotation for the same statements", async () => {
    const one = await measured(1, seedRotation);
    const many = await measured(25, seedRotation);

    expect(one.result?.profile.rotation?.shoes).toHaveLength(1);
    expect(many.result?.profile.rotation?.shoes).toHaveLength(25);
    expectFlat(one.counts, many.counts);
  });
});

describe("publicKitRead", () => {
  it("reads twenty-five pieces and their links for the same statements as one", async () => {
    const one = await measured(1, seedKitPieces);
    const many = await measured(25, seedKitPieces);

    expect(one.result?.kit.pieces).toHaveLength(1);
    expect(many.result?.kit.pieces).toHaveLength(25);
    const pieces = many.result?.kit.pieces ?? [];
    for (const piece of pieces) {
      expect(piece.url).toBeDefined();
    }
    expect(many.result?.kit.conditions).toBeDefined();
    expectFlat(one.counts, many.counts);
  });
});

describe("entryDetailForViewer", () => {
  it("reads twenty-five garments, photos, tags and Usefuls for the same statements as one", async () => {
    const one = await measured(1, seedEntryDetail);
    const many = await measured(25, seedEntryDetail);

    expect(one.result?.items).toHaveLength(1);
    expect(many.result?.items).toHaveLength(25);
    const items = many.result?.items ?? [];
    for (const item of items) {
      expect(item.url).toBeDefined();
    }
    expect(many.result?.photoKeys).toHaveLength(25);
    expect(many.result?.tags).toHaveLength(25);
    expect(many.result?.usefulCount).toBe(25);
    expect(many.result?.conditions).toBeDefined();
    expectFlat(one.counts, many.counts);
  });
});
