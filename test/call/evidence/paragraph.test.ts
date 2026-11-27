import { describe, expect, it } from "vitest";

import { kitParagraph } from "../../../src/modules/call/evidence/paragraph";
import { names, piece, result } from "./fixtures";

const band = {
  kind: "personal-band",
  bandFloorC: 5,
  cold: 2,
  dialed: 8,
  warm: 1,
} as const;

function tooMuch(pieceId: string, times: number, bandFloorC = 5) {
  return {
    kind: "personal-flag",
    pieceId,
    bandFloorC,
    flag: "too_much",
    times,
  } as const;
}

const runner = names({ zip: "half-zip", gloves: "gloves", mitts: "mitts" });

describe("kitParagraph", () => {
  it("says both sentences, cold first", () => {
    const zip = piece("zip", "tops", [band]);
    const call = result({
      kit: [zip],
      ranking: [zip, piece("gloves", "hands_head", [tooMuch("gloves", 1)])],
    });
    expect(kitParagraph(call, runner)).toBe(
      "You've been too cold twice in this band. Skip the gloves — too much once in this band.",
    );
  });

  it("says the cold sentence alone", () => {
    const zip = piece("zip", "tops", [{ ...band, cold: 3 }]);
    expect(kitParagraph(result({ kit: [zip], ranking: [zip] }), runner)).toBe(
      "You've been too cold 3 times in this band.",
    );
    const once = piece("zip", "tops", [{ ...band, cold: 1 }]);
    expect(kitParagraph(result({ kit: [once] }), runner)).toBe(
      "You've been too cold once in this band.",
    );
  });

  it("says nothing of cold when no run was cold", () => {
    const zip = piece("zip", "tops", [{ ...band, cold: 0 }]);
    expect(kitParagraph(result({ kit: [zip] }), runner)).toBeUndefined();
  });

  it("reads only the band of this hour", () => {
    const other = piece("zip", "tops", [{ ...band, bandFloorC: 10 }, band]);
    expect(kitParagraph(result({ kit: [other] }), runner)).toBe(
      "You've been too cold twice in this band.",
    );
    const elsewhere = piece("zip", "tops", [{ ...band, bandFloorC: 10 }]);
    expect(kitParagraph(result({ kit: [elsewhere] }), runner)).toBeUndefined();
    const flagged = piece("gloves", "hands_head", [tooMuch("gloves", 2, 10)]);
    expect(
      kitParagraph(result({ ranking: [flagged] }), runner),
    ).toBeUndefined();
  });

  it("reads no band's facts when there is no forecast", () => {
    const zip = piece("zip", "tops", [band]);
    expect(
      kitParagraph(result({ bandFloorC: undefined, kit: [zip] }), runner),
    ).toBeUndefined();
  });

  it("skips the loudest too-much the kit left out", () => {
    const call = result({
      ranking: [
        piece("mitts", "hands_head", [tooMuch("mitts", 2)]),
        piece("gloves", "hands_head", [tooMuch("gloves", 3)]),
        piece("zip", "tops", [tooMuch("zip", 2)]),
      ],
    });
    expect(kitParagraph(call, runner)).toBe(
      "Skip the gloves — too much 3 times in this band.",
    );
  });

  it("keeps the first of a tie", () => {
    const call = result({
      ranking: [
        piece("mitts", "hands_head", [tooMuch("mitts", 2)]),
        piece("gloves", "hands_head", [tooMuch("gloves", 2)]),
      ],
    });
    expect(kitParagraph(call, runner)).toBe(
      "Skip the mitts — too much twice in this band.",
    );
  });

  it("never skips a piece the kit chose, nor one it was not enough", () => {
    const zip = piece("zip", "tops", [tooMuch("zip", 4)]);
    const gloves = piece("gloves", "hands_head", [
      { ...tooMuch("gloves", 5), flag: "not_enough" },
      tooMuch("gloves", 1),
    ]);
    expect(
      kitParagraph(result({ kit: [zip], ranking: [zip, gloves] }), runner),
    ).toBe("Skip the gloves — too much once in this band.");
  });

  it("says no skip for a piece with no name", () => {
    const call = result({
      ranking: [piece("anon", "hands_head", [tooMuch("anon", 2)])],
    });
    expect(kitParagraph(call, runner)).toBeUndefined();
  });

  it("says nothing with no facts", () => {
    expect(kitParagraph(result(), runner)).toBeUndefined();
  });
});
