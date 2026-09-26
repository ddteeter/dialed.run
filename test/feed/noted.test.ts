import { describe, expect, it } from "vitest";

import { NOTHING_MOVED, notedPlan } from "../../src/modules/feed/noted";

/**
 * What A3's receipt is about: the one record a verdict moved, or which
 * input was missing so that none did (round 21, ask 3).
 */

const HOUDINI = { itemId: "01HOUDINI", name: "Houdini" };
const TIGHTS = { itemId: "01TIGHTS", name: "Tights" };

describe("notedPlan", () => {
  it("counts the kit's first piece in the run's band", () => {
    expect(notedPlan(5, [HOUDINI, TIGHTS])).toStrictEqual({
      kind: "record",
      itemId: "01HOUDINI",
      name: "Houdini",
      bandFloorC: 5,
    });
  });

  it("counts a band that starts at zero", () => {
    expect(notedPlan(0, [HOUDINI])).toMatchObject({ bandFloorC: 0 });
  });

  it("names the missing kit when there is a band but nothing was worn", () => {
    expect(notedPlan(5, [])).toStrictEqual({
      kind: "nothing-moved",
      sentence: "Logged. No kit on this run, so no garment record moved.",
    });
  });

  it("names the missing weather first — the wider gap — kit or not", () => {
    const noBand = {
      kind: "nothing-moved",
      sentence:
        "Logged. No weather came with this run, so no band record moved.",
    };
    expect(notedPlan(undefined, [HOUDINI])).toStrictEqual(noBand);
    expect(notedPlan(undefined, [])).toStrictEqual(noBand);
    expect(NOTHING_MOVED.noBand).toBe(noBand.sentence);
  });
});
