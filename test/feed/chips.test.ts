import { describe, expect, it } from "vitest";

import type { GarmentRecord } from "../../src/modules/feed/band-signals";
import {
  CHIP_COUNT,
  chipLabel,
  suggestChips,
  tagLabel,
} from "../../src/modules/feed/chips";
import type { Chip } from "../../src/modules/feed/chips";

/**
 * A3's generated chips (design round 20). Each of the ruling's own rules,
 * and each of the four assumptions `chips.ts` names where the ruling is
 * silent, has a test of its own — so a later ruling that overturns one
 * breaks exactly one test here and nothing in the UI.
 */

function record(dialed: number, colder: number, warmer: number): GarmentRecord {
  return { total: dialed + colder + warmer, dialed, colder, warmer };
}

const NONE = { chosenFlags: {}, chosenTags: new Set<string>() };

function flags(chips: readonly Chip[]): string[] {
  return chips.flatMap((chip) =>
    chip.kind === "flag" ? [`${chip.itemId}:${chip.flag}`] : [],
  );
}

function tags(chips: readonly Chip[]): string[] {
  return chips.flatMap((chip) => (chip.kind === "tag" ? [chip.tag] : []));
}

// Dialed shares: shell 1/4, gloves 2/4, cap 3/4 — so the weakest-first
// order is shell, gloves, cap.
/**
A kit and its records, as `suggestChips` takes them.
*/
function kitOf(
  ...garments: readonly (readonly [string, GarmentRecord])[]
): Pick<Parameters<typeof suggestChips>[0], "kit" | "records"> {
  return {
    kit: garments.map(([itemId]) => ({
      itemId,
      name: itemId.charAt(0).toUpperCase() + itemId.slice(1),
    })),
    records: Object.fromEntries(garments),
  };
}

const KIT = kitOf(
  ["cap", record(3, 0, 1)],
  ["gloves", record(2, 0, 2)],
  ["shell", record(1, 1, 2)],
);

describe("suggestChips: garment flags", () => {
  it("flags the two weakest garments too much on a warm verdict", () => {
    const chips = suggestChips({ verdict: 1, ...KIT, tagUse: {}, ...NONE });
    expect(flags(chips)).toEqual(["shell:too_much", "gloves:too_much"]);
    // The chip carries the garment's name, which is what it is labelled with.
    expect(chips[0]).toEqual({
      kind: "flag",
      itemId: "shell",
      name: "Shell",
      flag: "too_much",
    });
  });

  it("flags them not enough on a cold one, on either cold step", () => {
    for (const verdict of [-1, -2]) {
      const chips = suggestChips({ verdict, ...KIT, tagUse: {}, ...NONE });
      expect(flags(chips)).toEqual(["shell:not_enough", "gloves:not_enough"]);
    }
  });

  it("treats both warm steps alike", () => {
    const chips = suggestChips({ verdict: 2, ...KIT, tagUse: {}, ...NONE });
    expect(flags(chips)).toEqual(["shell:too_much", "gloves:too_much"]);
  });

  it("[assumption 1] breaks a tie in dialed share by runs, then by kit order", () => {
    // Equal shares (1/2 and 2/4): more runs is the stronger evidence.
    const byRuns = suggestChips({
      verdict: 1,
      ...kitOf(["few", record(1, 1, 0)], ["many", record(2, 2, 0)]),
      tagUse: {},
      ...NONE,
    });
    expect(flags(byRuns)).toEqual(["many:too_much", "few:too_much"]);

    // Equal shares and equal runs: kit order, which the sort keeps.
    const byKit = suggestChips({
      verdict: 1,
      ...kitOf(
        ["first", record(1, 1, 0)],
        ["second", record(1, 0, 1)],
        ["third", record(1, 1, 0)],
      ),
      tagUse: {},
      ...NONE,
    });
    expect(flags(byKit)).toEqual(["first:too_much", "second:too_much"]);
  });

  it("[assumption 2] never suggests a garment never worn in this band", () => {
    const chips = suggestChips({
      verdict: 1,
      ...kitOf(["unknown", record(0, 0, 0)], ["known", record(3, 0, 1)]),
      tagUse: {},
      ...NONE,
    });
    expect(flags(chips)).toEqual(["known:too_much"]);
  });

  it("[assumption 2] treats a garment with no record at all as never worn", () => {
    // The run has no band, or the read missed it: no key, not a zero.
    const chips = suggestChips({
      verdict: 1,
      kit: [
        { itemId: "missing", name: "Missing" },
        { itemId: "known", name: "Known" },
      ],
      records: { known: record(3, 0, 1) },
      tagUse: {},
      ...NONE,
    });
    expect(flags(chips)).toEqual(["known:too_much"]);
  });

  it("[assumption 3] on a dialed verdict, flags the one weakest in the way it is usually off", () => {
    expect(
      flags(suggestChips({ verdict: 0, ...KIT, tagUse: {}, ...NONE })),
    ).toEqual(["shell:too_much"]);

    const colder = suggestChips({
      verdict: 0,
      ...kitOf(["shell", record(1, 3, 1)]),
      tagUse: {},
      ...NONE,
    });
    expect(colder[0]).toEqual({
      kind: "flag",
      itemId: "shell",
      name: "Shell",
      flag: "not_enough",
    });
  });

  it("[assumption 3] flags nothing on a dialed verdict when the weakest is off neither way more", () => {
    for (const shell of [record(2, 0, 0), record(1, 1, 1)]) {
      const chips = suggestChips({
        verdict: 0,
        ...kitOf(["shell", shell]),
        tagUse: {},
        ...NONE,
      });
      expect(flags(chips)).toEqual([]);
      // And the garment block is genuinely empty — all five are tags.
      expect(tags(chips)).toHaveLength(CHIP_COUNT);
    }
  });

  it("[assumption 4] suggests no garment before a verdict is chosen", () => {
    const chips = suggestChips({
      verdict: undefined,
      ...KIT,
      tagUse: {},
      ...NONE,
    });
    expect(flags(chips)).toEqual([]);
    expect(chips).toHaveLength(CHIP_COUNT);
  });
});

describe("suggestChips: tags", () => {
  it("ranks tags by this runner's use in the band, filling to five", () => {
    const chips = suggestChips({
      verdict: undefined,
      ...kitOf(),
      tagUse: { chafed: 1, hands_cold: 4, sleeves_damp: 2 },
      ...NONE,
    });
    expect(tags(chips)).toEqual([
      "hands_cold",
      "sleeves_damp",
      "chafed",
      // Unused tags fill the rest, in the contract's own order.
      "cold_first_mile",
      "cold_throughout",
    ]);
  });

  it("fills to five after the garment flags, never past", () => {
    const chips = suggestChips({ verdict: 1, ...KIT, tagUse: {}, ...NONE });
    expect(chips).toHaveLength(CHIP_COUNT);
    expect(flags(chips)).toHaveLength(2);
    expect(tags(chips)).toHaveLength(3);
  });

  it("puts the garment block before the tag block", () => {
    const chips = suggestChips({
      verdict: 1,
      ...KIT,
      tagUse: { chafed: 9 },
      ...NONE,
    });
    expect(chips.map((chip) => chip.kind)).toEqual([
      "flag",
      "flag",
      "tag",
      "tag",
      "tag",
    ]);
  });
});

describe("suggestChips: what the runner chose stays", () => {
  it("keeps a chosen garment flag first, and suggests around it", () => {
    // "Changing the verdict recomputes unchosen chips; chosen chips stay."
    const chosen = {
      chosenFlags: { cap: "not_enough" as const },
      chosenTags: new Set<string>(),
    };
    for (const verdict of [1, -1, 0, undefined]) {
      const chips = suggestChips({ verdict, ...KIT, tagUse: {}, ...chosen });
      expect(chips[0]).toEqual({
        kind: "flag",
        itemId: "cap",
        name: "Cap",
        flag: "not_enough",
      });
    }
    // One chosen leaves room for one suggestion, never the chosen garment.
    const warm = suggestChips({ verdict: 1, ...KIT, tagUse: {}, ...chosen });
    expect(flags(warm)).toEqual(["cap:not_enough", "shell:too_much"]);
  });

  it("never suggests the garment already chosen, even when it is the weakest", () => {
    // Shell is the weakest in KIT. Chosen, the one suggestion left must
    // be the next weakest, not shell a second time.
    const chips = suggestChips({
      verdict: 1,
      ...KIT,
      tagUse: {},
      chosenFlags: { shell: "not_enough" },
      chosenTags: new Set<string>(),
    });
    expect(flags(chips)).toEqual(["shell:not_enough", "gloves:too_much"]);
  });

  it("never suggests a chosen tag again, even the most used one", () => {
    const chips = suggestChips({
      verdict: undefined,
      ...kitOf(),
      tagUse: { chafed: 9, hands_cold: 4 },
      chosenFlags: {},
      chosenTags: new Set(["chafed"]),
    });
    expect(tags(chips)).toEqual([
      "chafed",
      "hands_cold",
      "cold_first_mile",
      "cold_throughout",
      "overheated_late",
    ]);
  });

  it("keeps chosen tags ahead of the ranked ones, and never repeats them", () => {
    const chips = suggestChips({
      verdict: undefined,
      ...kitOf(),
      tagUse: { chafed: 9, hands_cold: 1 },
      chosenFlags: {},
      chosenTags: new Set(["perfect_warmup"]),
    });
    expect(tags(chips)).toEqual([
      "perfect_warmup",
      "chafed",
      "hands_cold",
      "cold_first_mile",
      "cold_throughout",
    ]);
  });

  it("shows everything chosen, and suggests nothing, once more than five are chosen", () => {
    // A3b can choose any number; the chips must not hide a choice.
    const chips = suggestChips({
      verdict: 1,
      ...KIT,
      tagUse: {},
      chosenFlags: { cap: "too_much", gloves: "too_much", shell: "too_much" },
      chosenTags: new Set(["chafed", "hands_cold", "sleeves_damp"]),
    });
    expect(chips).toHaveLength(6);
    expect(flags(chips)).toEqual([
      "cap:too_much",
      "gloves:too_much",
      "shell:too_much",
    ]);
    expect(tags(chips)).toEqual(["sleeves_damp", "chafed", "hands_cold"]);
  });
});

describe("chipLabel", () => {
  it("names the garment and the way it was off, in normal case", () => {
    expect(
      chipLabel({
        kind: "flag",
        itemId: "g",
        name: "Gloves",
        flag: "too_much",
      }),
    ).toBe("Gloves too much");
    expect(
      chipLabel({
        kind: "flag",
        itemId: "h",
        name: "Harrier",
        flag: "not_enough",
      }),
    ).toBe("Harrier not enough");
  });

  it("writes a tag in words", () => {
    expect(chipLabel({ kind: "tag", tag: "cold_first_mile" })).toBe(
      "cold first mile",
    );
    expect(tagLabel("hands_sweaty")).toBe("hands sweaty");
  });
});
