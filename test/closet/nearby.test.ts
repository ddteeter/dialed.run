import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { closetNearby, NEARBY_LIMIT } from "../../src/modules/closet/nearby";
import type { ClosetItemView } from "../../src/modules/closet/service";
import { makeEntry, makeItem, makeRun, makeUser, NOW } from "../feed/helpers";

/**
 * F at the desk's "Already in your closet" (round 26 #10): each
 * category's newest five and each type's (R-112), retired ones included,
 * with the record each row prints.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

async function pieceAt(
  userId: string,
  createdAt: number,
  overrides: Partial<typeof wardrobeItems.$inferInsert> = {},
): Promise<string> {
  const id = await makeItem({ userId, category: overrides.category ?? "top" });
  await db()
    .update(wardrobeItems)
    .set({ createdAt, ...overrides })
    .where(eq(wardrobeItems.id, id));
  return id;
}

function ids(views: readonly ClosetItemView[] | undefined): string[] {
  return (views ?? []).map((view) => view.item.id);
}

describe("closetNearby", () => {
  it("lists each category's pieces newest first, five at most", async () => {
    const userId = await makeUser();
    const tops: string[] = [];
    for (let index = 0; index < NEARBY_LIMIT + 2; index += 1) {
      tops.push(
        await pieceAt(userId, NOW + index, { name: `Top ${String(index)}` }),
      );
    }
    const shorts = await pieceAt(userId, NOW, {
      category: "bottom",
      name: "Split shorts",
    });

    const nearby = await closetNearby(db(), userId);

    expect(NEARBY_LIMIT).toBe(5);
    expect(ids(nearby.byCategory.top)).toStrictEqual(
      tops.toReversed().slice(0, NEARBY_LIMIT),
    );
    expect(ids(nearby.byCategory.bottom)).toStrictEqual([shorts]);
    expect(nearby.byCategory.shoes).toBeUndefined();
    // None of them has a type, so no type has a list.
    expect(nearby.byType).toStrictEqual({});
  });

  it("lists a type's own newest five, past a category full of other types", async () => {
    const userId = await makeUser();
    const halfZip = await pieceAt(userId, NOW, { type: "halfZip" });
    const tees: string[] = [];
    for (let index = 1; index <= NEARBY_LIMIT + 2; index += 1) {
      tees.push(await pieceAt(userId, NOW + index, { type: "tee" }));
    }

    const nearby = await closetNearby(db(), userId);

    // The half-zip is older than five tees: the category's list has no
    // room for it, and the type's list still finds it.
    expect(ids(nearby.byCategory.top)).toStrictEqual(
      tees.toReversed().slice(0, NEARBY_LIMIT),
    );
    expect(ids(nearby.byType.halfZip)).toStrictEqual([halfZip]);
    expect(ids(nearby.byType.tee)).toStrictEqual(
      tees.toReversed().slice(0, NEARBY_LIMIT),
    );
    expect(
      Object.keys(nearby.byType).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["halfZip", "tee"]);
  });

  it("lists a piece once, though its category and its type both found it", async () => {
    const userId = await makeUser();
    const older = await pieceAt(userId, NOW, { type: "tee" });
    const newer = await pieceAt(userId, NOW + 1, { type: "tee" });

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byCategory.top)).toStrictEqual([newer, older]);
    expect(ids(nearby.byType.tee)).toStrictEqual([newer, older]);
  });

  it("keeps a type's list in its own order when the category held some of it", async () => {
    const userId = await makeUser();
    // Newest first: tee, then four half-zips, then two more tees. The
    // category's five hold one tee; the type's own five add the rest.
    const oldTees = [
      await pieceAt(userId, NOW, { type: "tee" }),
      await pieceAt(userId, NOW + 1, { type: "tee" }),
    ];
    for (let index = 2; index < 6; index += 1) {
      await pieceAt(userId, NOW + index, { type: "halfZip" });
    }
    const newTee = await pieceAt(userId, NOW + 6, { type: "tee" });

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byType.tee)).toStrictEqual([
      newTee,
      ...oldTees.toReversed(),
    ]);
  });

  it("includes retired pieces", async () => {
    const userId = await makeUser();
    const retired = await pieceAt(userId, NOW, {
      retired: true,
      retiredAt: NOW,
    });

    const nearby = await closetNearby(db(), userId);

    expect(
      nearby.byCategory.top?.map((view) => [view.item.id, view.item.retired]),
    ).toStrictEqual([[retired, true]]);
  });

  it("reads only this runner's closet", async () => {
    const userId = await makeUser();
    await pieceAt(await makeUser(), NOW, { type: "tee" });
    const nothing = { byCategory: {}, byType: {} };

    expect(await closetNearby(db(), userId)).toStrictEqual(nothing);
    expect(await closetNearby(db(), newUlid())).toStrictEqual(nothing);
  });

  it("carries each piece's record: runs, verdicts and dialed", async () => {
    const userId = await makeUser();
    const itemId = await pieceAt(userId, NOW);
    for (const verdict of [0, 0, -1]) {
      await makeEntry({
        userId,
        runId: await makeRun({ userId }),
        verdict,
        itemIds: [itemId],
      });
    }

    const nearby = await closetNearby(db(), userId);
    const [view] = nearby.byCategory.top ?? [];

    expect(view?.performance?.summary).toMatchObject({
      runCount: 3,
      verdictCount: 3,
      dialedCount: 2,
    });
  });
});
