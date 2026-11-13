import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  closetNearby,
  NEARBY_LIMIT,
  nearbyStatement,
  type NearbyList,
} from "../../src/modules/closet/nearby";
import { makeEntry, makeItem, makeRun, makeUser, NOW } from "../feed/helpers";

/**
 * F's "Already in your closet" (round 26 #10): each category's five and
 * each type's (R-112) in Round 55 · 193's order — in use first, most worn
 * first, then retired — with how many more there are, and the record each
 * row prints.
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

function ids(list: NearbyList | undefined): string[] {
  return (list?.pieces ?? []).map((view) => view.item.id);
}

async function wear(userId: string, itemId: string, times: number) {
  for (let index = 0; index < times; index += 1) {
    await makeEntry({
      userId,
      runId: await makeRun({ userId }),
      verdict: 0,
      itemIds: [itemId],
    });
  }
}

describe("closetNearby", () => {
  it("lists each category's never-worn pieces newest first, five, and counts the rest", async () => {
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
    // "+ 2 more tops".
    expect(nearby.byCategory.top?.more).toBe(2);
    expect(ids(nearby.byCategory.bottom)).toStrictEqual([shorts]);
    expect(nearby.byCategory.bottom?.more).toBe(0);
    expect(nearby.byCategory.shoes).toBeUndefined();
    // None of them has a type, so no type has a list.
    expect(nearby.byType).toStrictEqual({});
  });

  it("puts the most worn first, then the newest, and retired pieces last (193)", async () => {
    const userId = await makeUser();
    const oldFavourite = await pieceAt(userId, NOW, { name: "Favourite" });
    const newUnworn = await pieceAt(userId, NOW + 5, { name: "New" });
    const onceWorn = await pieceAt(userId, NOW + 1, { name: "Once" });
    const retiredFavourite = await pieceAt(userId, NOW + 9, {
      name: "Retired",
      retired: true,
      retiredAt: NOW,
    });
    await wear(userId, oldFavourite, 3);
    await wear(userId, onceWorn, 1);
    await wear(userId, retiredFavourite, 5);

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byCategory.top)).toStrictEqual([
      oldFavourite,
      onceWorn,
      newUnworn,
      retiredFavourite,
    ]);
  });

  it("keeps a retired piece last even past the five, where it is counted", async () => {
    const userId = await makeUser();
    const retired = await pieceAt(userId, NOW + 99, {
      retired: true,
      retiredAt: NOW,
    });
    for (let index = 0; index < NEARBY_LIMIT; index += 1) {
      await pieceAt(userId, NOW + index);
    }

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byCategory.top)).not.toContain(retired);
    expect(nearby.byCategory.top?.more).toBe(1);
  });

  it("breaks a tie on the same moment and record by id, the same every read", async () => {
    const userId = await makeUser();
    const first = await pieceAt(userId, NOW);
    const second = await pieceAt(userId, NOW);
    const [high, low] = [first, second].toSorted((a, b) => b.localeCompare(a));

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byCategory.top)).toStrictEqual([high, low]);
  });

  it("lists each type its own five, past a category full of other types", async () => {
    const userId = await makeUser();
    const halfZip = await pieceAt(userId, NOW, { type: "halfZip" });
    const tees: string[] = [];
    for (let index = 1; index <= NEARBY_LIMIT + 2; index += 1) {
      tees.push(await pieceAt(userId, NOW + index, { type: "tee" }));
    }

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byCategory.top)).toStrictEqual(
      tees.toReversed().slice(0, NEARBY_LIMIT),
    );
    expect(nearby.byCategory.top?.more).toBe(3);
    expect(ids(nearby.byType.halfZip)).toStrictEqual([halfZip]);
    expect(nearby.byType.halfZip?.more).toBe(0);
    expect(ids(nearby.byType.tee)).toStrictEqual(
      tees.toReversed().slice(0, NEARBY_LIMIT),
    );
    expect(nearby.byType.tee?.more).toBe(2);
    expect(
      Object.keys(nearby.byType).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["halfZip", "tee"]);
  });

  it("lists a two-type category's types, and not a one-type category's", async () => {
    const userId = await makeUser();
    const armSleeves = await pieceAt(userId, NOW, {
      category: "accessory",
      type: "armSleeves",
    });
    const gloves = await pieceAt(userId, NOW, {
      category: "gloves",
      type: "gloves",
    });

    const nearby = await closetNearby(db(), userId);

    // ACCESSORY has a picker (two types), so arm sleeves get a list.
    expect(ids(nearby.byType.armSleeves)).toStrictEqual([armSleeves]);
    // GLOVES has one type and no picker: the category is the type.
    expect(ids(nearby.byCategory.gloves)).toStrictEqual([gloves]);
    expect(nearby.byType.gloves).toBeUndefined();
  });

  it("lists a type only with its own category's pieces", async () => {
    const userId = await makeUser();
    // A stored type outside its category's vocabulary is not the type's
    // piece: only the category lists it.
    const stray = await pieceAt(userId, NOW, {
      category: "bottom",
      type: "tee",
    });

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byCategory.bottom)).toStrictEqual([stray]);
    expect(nearby.byType.tee).toBeUndefined();
  });

  it("reads the closet once, by the runner's index", async () => {
    const { sql, params } = nearbyStatement(db(), "01RUNNER").toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");

    expect(sql).toMatch(/where "wardrobe_items"."user_id" = \?$/u);
    // One search by a runner's index, and no sort: nearbyOrder orders.
    const except = nearbyStatement(db(), "01RUNNER", "01PIECE").toSQL();
    expect(except.sql).toMatch(
      /where \("wardrobe_items"."user_id" = \? and "wardrobe_items"."id" <> \?\)$/u,
    );
    expect(except.params).toStrictEqual(["01RUNNER", "01PIECE"]);
    expect(details).toMatch(
      /^SEARCH wardrobe_items USING INDEX \w+ \(user_id=\?\)$/u,
    );
  });

  it("leaves out the piece being edited, which is not beside itself (168.2)", async () => {
    const userId = await makeUser();
    const editing = await pieceAt(userId, NOW + 1, { type: "tee" });
    const other = await pieceAt(userId, NOW, { type: "tee" });

    const nearby = await closetNearby(db(), userId, editing);

    expect(ids(nearby.byCategory.top)).toStrictEqual([other]);
    expect(ids(nearby.byType.tee)).toStrictEqual([other]);
    const whole = await closetNearby(db(), userId);
    expect(ids(whole.byCategory.top)).toStrictEqual([editing, other]);
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
    const [view] = nearby.byCategory.top?.pieces ?? [];

    expect(view?.performance?.summary).toMatchObject({
      runCount: 3,
      verdictCount: 3,
      dialedCount: 2,
    });
  });
});
