import { describe, expect, it } from "vitest";

import { garmentSchema } from "../../src/lib/contracts";
import {
  climateBands,
  TAP_LIST,
  TAP_LIST_FOLD,
  tapListFor,
  tapListSelectionSchema,
} from "../../src/modules/closet/tap-list";

/**
 * One list, ordered per band (design round 6, `Remaining Screens.dc.html`
 * §AA). The rule the tests exist to hold is the one sentence the artboard
 * leads with: **the band never removes a row.**
 */
function garmentFor(key: string) {
  return TAP_LIST.find((row) => row.key === key)?.garment;
}

describe("the tap-list table", () => {
  it("holds only garments the contract accepts", () => {
    for (const { garment } of TAP_LIST) {
      expect(garmentSchema.safeParse(garment).success).toBe(true);
    }
  });

  it("keys every row uniquely, and names every row distinctly", () => {
    expect(new Set(TAP_LIST.map((row) => row.key)).size).toBe(TAP_LIST.length);
    expect(new Set(TAP_LIST.map((row) => row.garment.name)).size).toBe(
      TAP_LIST.length,
    );
  });

  it("marks the rows whose whole point is keeping weather out", () => {
    // Not decoration: `estimateTempRange` reads `windResistant`, so a wind
    // shell that is not marked wind resistant estimates as a mid layer and
    // the closet's temperature guess moves with it.
    expect(garmentFor("wind-shell")).toMatchObject({ windResistant: true });
    expect(garmentFor("vest")).toMatchObject({ windResistant: true });
    expect(garmentFor("rain-jacket")).toMatchObject({ waterResistant: true });
  });

  it("gives no row a type", () => {
    // Type is a property of the *product*, written on match or by
    // enrichment — never inferred from a tap-list label.
    for (const { garment } of TAP_LIST) {
      expect(garment).not.toHaveProperty("type");
    }
  });

  it("ranks every row in every band", () => {
    // A missing rank sorts as `undefined` and puts the row somewhere
    // arbitrary, which looks like a deliberate order and is not.
    for (const row of TAP_LIST) {
      for (const band of climateBands) {
        expect(typeof row.rank[band]).toBe("number");
      }
    }
  });

  it("gives each band a total order, with no ties", () => {
    for (const band of climateBands) {
      const ranks = TAP_LIST.map((row) => row.rank[band]);
      expect(new Set(ranks).size).toBe(TAP_LIST.length);
    }
  });
});

describe("tapListFor", () => {
  it("shows every band every row", () => {
    // The rule from the artboard: a Minneapolis runner owns tights and a
    // singlet. Mittens fall behind the fold in Phoenix, not out of it.
    for (const band of climateBands) {
      expect(tapListFor(band)).toHaveLength(TAP_LIST.length);
      expect(new Set(tapListFor(band).map((row) => row.key))).toStrictEqual(
        new Set(TAP_LIST.map((row) => row.key)),
      );
    }
  });

  it("orders a cold band exactly as the artboard draws it", () => {
    // Keys *and* names, pinned against §AA rather than against itself: a
    // table that only has to be internally consistent drifts from the
    // design one row at a time and never fails. The first fourteen are
    // the artboard's own order for Minneapolis; the last four are what the
    // old per-band lists contributed, and D-49 records that design
    // specified 24 rows and named 14, so six are still unwritten.
    expect(
      tapListFor("cold").map((row) => [row.key, row.garment.name]),
    ).toStrictEqual([
      ["tights", "Running tights"],
      ["merino-base", "Merino base layer"],
      ["beanie", "Beanie"],
      ["gloves", "Running gloves"],
      ["mittens", "Mittens"],
      ["wind-shell", "Wind shell"],
      ["vest", "Running vest"],
      ["buff", "Buff"],
      ["shorts-7", '7" shorts'],
      ["tee", "Short sleeve tee"],
      ["arm-warmers", "Arm warmers"],
      ["rain-jacket", "Rain jacket"],
      ["shorts-5", '5" shorts'],
      ["singlet", "Singlet"],
      ["quarter-zip", "Long sleeve quarter-zip"],
      ["socks", "Running socks"],
      ["cap", "Running cap"],
      ["sunglasses", "Sunglasses"],
    ]);
  });

  it("puts cold rows first for a cold band and hot rows first for a hot one", () => {
    const coldFirst = tapListFor("cold").map((row) => row.key);
    const hotFirst = tapListFor("hot").map((row) => row.key);

    expect(coldFirst[0]).toBe("tights");
    expect(hotFirst[0]).toBe("shorts-5");
    // And the other band's opener is still present, just further down.
    expect(hotFirst).toContain("tights");
    expect(coldFirst).toContain("shorts-5");
  });

  it("keeps mittens available to a hot band, below the fold", () => {
    const hot = tapListFor("hot").map((row) => row.key);

    expect(hot).toContain("mittens");
    expect(hot.indexOf("mittens")).toBeGreaterThanOrEqual(TAP_LIST_FOLD);
  });

  it("does not reorder the table itself", () => {
    // `sort` mutates, so a version without the copy would leave whichever
    // band asked last as everyone's order.
    const before = TAP_LIST.map((row) => row.key);
    tapListFor("hot");

    expect(TAP_LIST.map((row) => row.key)).toStrictEqual(before);
  });

  it("folds with rows left over, so the disclosure has something to say", () => {
    expect(TAP_LIST.length).toBeGreaterThan(TAP_LIST_FOLD);
  });
});

describe("tapListSelectionSchema", () => {
  it("needs at least one key", () => {
    expect(tapListSelectionSchema.safeParse({ keys: [] }).success).toBe(false);
    expect(tapListSelectionSchema.safeParse({ keys: ["tee"] }).success).toBe(
      true,
    );
  });

  it("takes no band, because a key means the same thing in every band", () => {
    const parsed = tapListSelectionSchema.parse({ keys: ["tee"] });

    expect(parsed).not.toHaveProperty("band");
  });

  it("caps the selection at the whole table", () => {
    const everything = TAP_LIST.map((row) => row.key);

    expect(tapListSelectionSchema.safeParse({ keys: everything }).success).toBe(
      true,
    );
    expect(
      tapListSelectionSchema.safeParse({ keys: [...everything, "extra"] })
        .success,
    ).toBe(false);
  });
});
