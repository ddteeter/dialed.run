import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { closetNearby, nearbyStatement } from "../../src/modules/closet/nearby";
import type { ClosetItemView } from "../../src/modules/closet/service";
import { makeEntry, makeItem, makeRun, makeUser, NOW } from "../feed/helpers";

/**
 * F's "Already in your closet" (round 26 #10): every piece of each of C's
 * groups, filed as C files it (Round 56 · 248), in Round 55 · 193's order
 * — in use first, most worn first, then retired — and the record each
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

function ids(list: readonly ClosetItemView[] | undefined): string[] {
  return (list ?? []).map((view) => view.item.id);
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
  it("lists each group whole, never-worn pieces newest first", async () => {
    const userId = await makeUser();
    const tops: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      tops.push(
        await pieceAt(userId, NOW + index, { name: `Top ${String(index)}` }),
      );
    }
    const shorts = await pieceAt(userId, NOW, {
      category: "bottom",
      name: "Split shorts",
    });
    const cap = await pieceAt(userId, NOW, { category: "headwear" });
    const gloves = await pieceAt(userId, NOW + 1, { category: "gloves" });

    const nearby = await closetNearby(db(), userId);

    // No cap: the card shows five and counts the rest from the whole.
    expect(ids(nearby.tops)).toStrictEqual(tops.toReversed());
    expect(ids(nearby.bottoms)).toStrictEqual([shorts]);
    // Headwear and gloves share C's Hands / head.
    expect(ids(nearby.hands_head)).toStrictEqual([gloves, cap]);
    // A group with nothing in it is absent.
    expect(
      Object.keys(nearby).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["bottoms", "hands_head", "tops"]);
  });

  it("files a top worn as an outer layer in Outer, not Tops, as C does (248)", async () => {
    const userId = await makeUser();
    const shell = await pieceAt(userId, NOW + 1, {
      layer: "outer",
      type: "halfZip",
    });
    const tee = await pieceAt(userId, NOW, { layer: "base", type: "tee" });
    const tights = await pieceAt(userId, NOW, {
      category: "bottom",
      layer: "outer",
    });

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.outer)).toStrictEqual([shell, tights]);
    expect(ids(nearby.tops)).toStrictEqual([tee]);
    expect(nearby.bottoms).toBeUndefined();
    expect(nearby.outer?.map((view) => view.uiGroup)).toStrictEqual([
      "outer",
      "outer",
    ]);
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

    expect(ids(nearby.tops)).toStrictEqual([
      oldFavourite,
      onceWorn,
      newUnworn,
      retiredFavourite,
    ]);
  });

  it("breaks a tie on the same moment and record by id, the same every read", async () => {
    const userId = await makeUser();
    const first = await pieceAt(userId, NOW);
    const second = await pieceAt(userId, NOW);
    const [high, low] = [first, second].toSorted((a, b) => b.localeCompare(a));

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.tops)).toStrictEqual([high, low]);
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

    expect(ids(nearby.tops)).toStrictEqual([other]);
    const whole = await closetNearby(db(), userId);
    expect(ids(whole.tops)).toStrictEqual([editing, other]);
  });

  it("reads only this runner's closet", async () => {
    const userId = await makeUser();
    await pieceAt(await makeUser(), NOW, { type: "tee" });

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
    const [view] = nearby.tops ?? [];

    expect(view?.performance?.summary).toMatchObject({
      runCount: 3,
      verdictCount: 3,
      dialedCount: 2,
    });
  });
});
