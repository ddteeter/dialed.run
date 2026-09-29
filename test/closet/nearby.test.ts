import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { closetNearby, NEARBY_LIMIT } from "../../src/modules/closet/nearby";
import { makeEntry, makeItem, makeRun, makeUser, NOW } from "../feed/helpers";

/**
 * F at the desk's "Already in your closet" (round 26 #10): each category's
 * newest five, retired ones included, with the record each row prints.
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
    expect(nearby.top?.map((view) => view.item.id)).toStrictEqual(
      tops.toReversed().slice(0, NEARBY_LIMIT),
    );
    expect(nearby.bottom?.map((view) => view.item.id)).toStrictEqual([shorts]);
    expect(nearby.shoes).toBeUndefined();
  });

  it("includes retired pieces", async () => {
    const userId = await makeUser();
    const retired = await pieceAt(userId, NOW, {
      retired: true,
      retiredAt: NOW,
    });

    const nearby = await closetNearby(db(), userId);

    expect(
      nearby.top?.map((view) => [view.item.id, view.item.retired]),
    ).toStrictEqual([[retired, true]]);
  });

  it("reads only this runner's closet", async () => {
    const userId = await makeUser();
    await pieceAt(await makeUser(), NOW);

    expect(await closetNearby(db(), userId)).toStrictEqual({});
    expect(await closetNearby(db(), newUlid())).toStrictEqual({});
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
    const [view] = nearby.top ?? [];

    expect(view?.performance?.summary).toMatchObject({
      runCount: 3,
      verdictCount: 3,
      dialedCount: 2,
    });
  });
});
