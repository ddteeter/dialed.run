import { describe, expect, it } from "vitest";

import { withShares } from "../../src/modules/feed/bar-share";

/**
The words alone, for rows of these runner counts out of `matched`.
*/
function words(counts: readonly number[], matched: number): string[] {
  return withShares(
    counts.map((runners) => ({ runners })),
    matched,
  ).map(({ share }) => share);
}

describe("withShares: round 35 #54's consensus words", () => {
  it("claims a share of matched runners, not a rank", () => {
    // 11 and 9 of 14 are both over half, so both are Most.
    expect(words([11, 9, 5, 3], 14)).toStrictEqual([
      "most",
      "most",
      "some",
      "some",
    ]);
  });

  it("says Some on a leader under half", () => {
    // "a leader at 5 of 14" reads Some.
    expect(words([5, 4, 3], 14)).toStrictEqual(["some", "some", "some"]);
  });

  it("says Some on exactly half, and Most from one more", () => {
    // Most is "more than half".
    expect(words([7, 8], 14)).toStrictEqual(["some", "most"]);
    expect(words([2, 3], 5)).toStrictEqual(["some", "most"]);
  });

  it("says All on a bar every matched runner wore, whatever sits beside it", () => {
    expect(words([14, 9, 3], 14)).toStrictEqual(["all", "most", "some"]);
    expect(words([14], 14)).toStrictEqual(["all"]);
  });

  it("says Some on a lone bar short of every runner", () => {
    // "a lone bar at 3 of 14" reads Some; round 27's lone-bar All is gone.
    expect(words([3], 14)).toStrictEqual(["some"]);
    expect(words([13], 14)).toStrictEqual(["most"]);
  });

  it("shows a tie as the same word on equal bars, with no Split", () => {
    expect(words([9, 9, 3], 14)).toStrictEqual(["most", "most", "some"]);
    expect(words([4, 4], 14)).toStrictEqual(["some", "some"]);
  });

  it("keeps each row with its own word, in order", () => {
    const rows = [
      { group: "tops", runners: 3 },
      { group: "bottoms", runners: 9 },
    ];
    expect(withShares(rows, 14)).toStrictEqual([
      { row: rows[0], share: "some" },
      { row: rows[1], share: "most" },
    ]);
  });
});
