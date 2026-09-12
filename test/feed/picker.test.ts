import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { pickerGroups } from "../../src/modules/feed/picker";
import type { Conditions } from "../../src/modules/feed/conditions";
import { makeItem, makeUser, resetTables } from "./helpers";

/**
 * A2b, the kit picker shown when there is no confident prefill. Forty-five
 * mutants, none of them covered — nothing imported this file.
 *
 * The decision it makes is which of a runner's garments are plausible for
 * the conditions in front of them, and the packet is specific about the
 * failure mode to avoid: an item with no recorded range is `[UNTESTED]` and
 * is **shown**, not hidden. Hiding it is how a picker quietly stops
 * offering half the closet.
 */

const CONDITIONS: Conditions = {
  tempC: 5,
  feelsLikeC: 3,
  precipMm: 0,
  windKph: 10,
  condition: "clear",
  source: "visualcrossing",
  span: { minTempC: 5, maxTempC: 5, minFeelsLikeC: 3, maxFeelsLikeC: 3 },
};

function db() {
  return drizzle(env.DIALED_CORE);
}

async function withRange(
  itemId: string,
  estTempLowC: number,
  estTempHighC: number,
): Promise<void> {
  await db()
    .update(wardrobeItems)
    .set({ estTempLowC, estTempHighC })
    .where(eq(wardrobeItems.id, itemId));
}

beforeEach(async () => {
  await resetTables();
});

describe("pickerGroups", () => {
  it("offers nothing for a closet with nothing in it", async () => {
    expect(await pickerGroups(await makeUser(), CONDITIONS)).toStrictEqual([]);
  });

  it("matches an item whose range contains the conditions", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId, name: "In range" });
    await withRange(itemId, 0, 10);

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.matchCount).toBe(1);
    expect(group?.hiddenByFilterCount).toBe(0);
    expect(group?.items[0]).toMatchObject({
      name: "In range",
      matches: true,
      untested: false,
    });
  });

  it("takes both ends of the range as matching", async () => {
    // 5°C against a 5–10 garment and against a 0–5 one: a runner looking
    // at exactly the boundary temperature should see both.
    const userId = await makeUser();
    const atLow = await makeItem({ userId, name: "Low bound" });
    const atHigh = await makeItem({ userId, name: "High bound" });
    await withRange(atLow, 5, 10);
    await withRange(atHigh, 0, 5);

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.matchCount).toBe(2);
  });

  it("keeps an out-of-range item, counted as hidden by the filter", async () => {
    // Not dropped: the picker shows them below the matches, because the
    // runner may know better than the estimate.
    const userId = await makeUser();
    const cold = await makeItem({ userId, name: "Too warm for today" });
    await withRange(cold, -30, -10);

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.matchCount).toBe(0);
    expect(group?.hiddenByFilterCount).toBe(1);
    expect(group?.items).toHaveLength(1);
  });

  it("shows an item with no range, marked untested and matching", async () => {
    // The packet is explicit: `[UNTESTED]` is shown, not hidden. It has no
    // range to disagree with the conditions.
    const userId = await makeUser();
    await makeItem({ userId, name: "No range" });

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.items[0]).toMatchObject({
      name: "No range",
      untested: true,
      matches: true,
    });
    expect(group?.matchCount).toBe(1);
  });

  it("treats an item with only a lower bound as untested", async () => {
    const userId = await makeUser();
    const halfRanged = await makeItem({ userId, name: "Low only" });
    await db()
      .update(wardrobeItems)
      .set({ estTempLowC: 0 })
      .where(eq(wardrobeItems.id, halfRanged));

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.items[0]).toMatchObject({ untested: true, matches: true });
  });

  it("treats an item with only an upper bound as untested too", async () => {
    // Half a range is not a range, in either direction — and the upper
    // bound alone would otherwise decide the match on its own. This one
    // ends below the conditions, so a half-honoured range would hide it.
    const userId = await makeUser();
    const halfRanged = await makeItem({ userId, name: "High only" });
    await db()
      .update(wardrobeItems)
      .set({ estTempHighC: 0 })
      .where(eq(wardrobeItems.id, halfRanged));

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.items[0]).toMatchObject({ untested: true, matches: true });
    expect(group?.matchCount).toBe(1);
  });

  it("does not match an item whose range starts above the conditions", async () => {
    // Both ends have to be checked: a 10-20 garment is wrong for 5 degrees
    // even though its upper bound is comfortably above.
    const userId = await makeUser();
    const tooWarm = await makeItem({ userId, name: "Summer only" });
    await withRange(tooWarm, 10, 20);

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.matchCount).toBe(0);
    expect(group?.items[0]?.matches).toBe(false);
  });

  it("matches everything when the conditions are unknown", async () => {
    // No observation resolved yet. The picker still has to offer the
    // closet rather than an empty screen.
    const userId = await makeUser();
    const cold = await makeItem({ userId, name: "Deep winter" });
    await withRange(cold, -30, -10);

    const [group] = await pickerGroups(userId, undefined);

    expect(group?.matchCount).toBe(1);
    expect(group?.items[0]?.matches).toBe(true);
  });

  it("puts the matches first within a group", async () => {
    const userId = await makeUser();
    const missing = await makeItem({ userId, name: "Out of range" });
    const matching = await makeItem({ userId, name: "In range" });
    await withRange(missing, -30, -10);
    await withRange(matching, 0, 10);

    const [group] = await pickerGroups(userId, CONDITIONS);

    expect(group?.items.map((item) => item.name)).toStrictEqual([
      "In range",
      "Out of range",
    ]);
  });

  it("splits the closet into its UI groups", async () => {
    const userId = await makeUser();
    await makeItem({ userId, category: "top", name: "A top" });
    await makeItem({ userId, category: "shoes", name: "Some shoes" });

    const groups = await pickerGroups(userId, CONDITIONS);

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.group))).toStrictEqual(
      new Set(["tops", "shoes"]),
    );
  });

  it("offers nothing that has been retired", async () => {
    const userId = await makeUser();
    const retired = await makeItem({ userId, name: "Retired" });
    await db()
      .update(wardrobeItems)
      .set({ retired: true })
      .where(eq(wardrobeItems.id, retired));

    expect(await pickerGroups(userId, CONDITIONS)).toStrictEqual([]);
  });

  it("offers nothing belonging to anyone else", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    await makeItem({ userId: theirs, name: "Not mine" });

    expect(await pickerGroups(mine, CONDITIONS)).toStrictEqual([]);
  });
});
