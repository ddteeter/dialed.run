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
} from "../../src/modules/closet/nearby";
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

  it("lists a two-type category's type past its five, and a one-type category's from its five", async () => {
    const userId = await makeUser();
    const armSleeves = await pieceAt(userId, NOW, {
      category: "accessory",
      type: "armSleeves",
    });
    const oldGloves = await pieceAt(userId, NOW, {
      category: "gloves",
      type: "gloves",
    });
    const sunglasses: string[] = [];
    const gloves: string[] = [];
    for (let index = 1; index <= NEARBY_LIMIT; index += 1) {
      sunglasses.push(
        await pieceAt(userId, NOW + index, {
          category: "accessory",
          type: "sunglasses",
        }),
      );
      gloves.push(await pieceAt(userId, NOW + index, { category: "gloves" }));
    }

    const nearby = await closetNearby(db(), userId);

    // ACCESSORY has a picker (two types), so arm sleeves get their own
    // five though five sunglasses are newer.
    expect(ids(nearby.byType.armSleeves)).toStrictEqual([armSleeves]);
    expect(ids(nearby.byType.sunglasses)).toStrictEqual(
      sunglasses.toReversed(),
    );
    // GLOVES has one type and no picker: the category is the type, and
    // the typed pair older than five gloves is not read again for it.
    expect(ids(nearby.byCategory.gloves)).toStrictEqual(gloves.toReversed());
    expect(nearby.byType.gloves).toBeUndefined();
    expect(ids(nearby.byCategory.gloves)).not.toContain(oldGloves);
  });

  it("lists a type only with its own category's pieces", async () => {
    const userId = await makeUser();
    // A stored type outside its category's vocabulary is not the type's
    // piece: only the category's five can list it.
    for (let index = 1; index <= NEARBY_LIMIT; index += 1) {
      await pieceAt(userId, NOW + index, { category: "bottom" });
    }
    const stray = await pieceAt(userId, NOW, {
      category: "bottom",
      type: "tee",
    });

    const nearby = await closetNearby(db(), userId);

    expect(ids(nearby.byCategory.bottom)).not.toContain(stray);
    expect(nearby.byType.tee).toBeUndefined();
  });

  it("reads the closet once, by the runner's index", async () => {
    const { sql, params } = nearbyStatement(db(), "01RUNNER").toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");

    // One read, ranked twice by window: newest first in the category, and
    // in the category and type, each rank named for the filter over it.
    expect(sql).toContain(
      'row_number() over (partition by "category" order by "wardrobe_items"."created_at" desc, "wardrobe_items"."id" desc) as "rc"',
    );
    expect(sql).toContain(
      'row_number() over (partition by "category", "type" order by "wardrobe_items"."created_at" desc, "wardrobe_items"."id" desc) as "rt"',
    );
    expect(sql).toMatch(/where \("rc" <= \? or \("rt" <= \? and /u);
    expect(details).toMatch(/CO-ROUTINE ranked/u);
    expect(details).not.toMatch(/SCAN wardrobe_items/u);
    expect(
      details.match(
        /SEARCH wardrobe_items USING INDEX wardrobe_user_category \(user_id=\?\)/gu,
      ),
    ).toHaveLength(1);
    expect(details.match(/wardrobe_items/gu)).toHaveLength(1);
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
