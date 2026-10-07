import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { allGarmentTypes } from "../../src/lib/contracts/garment-fields";
import { newUlid } from "../../src/lib/ids";
import { createItem } from "../../src/modules/closet/service";
import {
  garmentTypeLabels,
  garmentTypePlurals,
  kindLabel,
  typeOf,
} from "../../src/modules/closet/type-labels";

/**
 * F's names for the contract's garment types (D-75, R-112). The words are
 * copy, so they are pinned whole: four are round 26's ("Singlet", "Tee",
 * "L/S crew", "Half-zip") and the rest are the build's reading, recorded in
 * docs/design-deltas.md for design to confirm. A change here is a change
 * a runner reads.
 */
describe("garment type labels", () => {
  it("names every contract type, in the contract's order, and nothing else", () => {
    expect(Object.keys(garmentTypeLabels)).toStrictEqual([...allGarmentTypes]);
    expect(Object.keys(garmentTypePlurals)).toStrictEqual([...allGarmentTypes]);
  });

  it("names each type as F's chips say it", () => {
    expect(garmentTypeLabels).toStrictEqual({
      singlet: "Singlet",
      tee: "Tee",
      longSleeve: "L/S crew",
      halfZip: "Half-zip",
      jacket: "Jacket",
      vest: "Vest",
      sportsBra: "Sports bra",
      shorts: "Shorts",
      halfTights: "Half tights",
      tights: "Tights",
      cap: "Cap",
      beanie: "Beanie",
      headband: "Headband",
      neckGaiter: "Neck gaiter",
      gloves: "Gloves",
      socks: "Socks",
      shoes: "Shoes",
      sunglasses: "Sunglasses",
      armSleeves: "Arm sleeves",
    });
  });

  it("names each type in the plural the rail's empty line reads in", () => {
    expect(garmentTypePlurals).toStrictEqual({
      singlet: "singlets",
      tee: "tees",
      longSleeve: "L/S crews",
      halfZip: "half-zips",
      jacket: "jackets",
      vest: "vests",
      sportsBra: "sports bras",
      shorts: "shorts",
      halfTights: "half tights",
      tights: "tights",
      cap: "caps",
      beanie: "beanies",
      headband: "headbands",
      neckGaiter: "neck gaiters",
      gloves: "gloves",
      socks: "socks",
      shoes: "shoes",
      sunglasses: "sunglasses",
      armSleeves: "arm sleeves",
    });
  });
});

describe("kindLabel", () => {
  it("is the category alone before a type is picked", () => {
    expect(kindLabel("top", undefined)).toBe("Top");
  });

  it("adds the type after the category, as round 26's TOP · HALF-ZIP", () => {
    expect(kindLabel("top", "halfZip")).toBe("Top · Half-zip");
    expect(kindLabel("bottom", "halfTights")).toBe("Bottom · Half tights");
  });
});

describe("typeOf", () => {
  it("is the category's type when the value is one", () => {
    expect(typeOf("top", "halfZip")).toBe("halfZip");
  });

  it("is nothing for another category's type or a stray word", () => {
    expect(typeOf("shoes", "halfZip")).toBeUndefined();
    expect(typeOf("top", "")).toBeUndefined();
  });

  it("is nothing for the stored column's own null — a manual add with no type", async () => {
    // `wardrobe_items.type` is nullable (a manual add never collects one),
    // and drizzle reads an unset nullable text column back as a real `null`
    // — not `undefined`. Getting that value from an actual row rather than
    // a hand-written literal is this repo's own rule (`unicorn/no-null`;
    // see the header note on modules/closet/service.ts), and it also means
    // this exercises the exact value `typeOf` receives from a caller
    // reading a row, not a stand-in for it.
    const client = drizzle(env.DIALED_CORE);
    const item = await createItem(client, newUlid(), {
      category: "top",
      name: "No type",
    });
    expect(item.type).toBeNull();
    expect(typeOf(item.category, item.type)).toBeUndefined();
  });
});
