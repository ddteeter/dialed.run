import { describe, expect, it } from "vitest";

import { withShares } from "../../src/modules/feed/bar-share";

/**
The words alone, for rows of these runner counts out of `total`.
*/
function words(counts: readonly number[], total: number): string[] {
  return withShares(
    counts.map((runners) => ({ runners })),
    total,
  ).map(({ share }) => share);
}

describe("withShares: round 27 #25's consensus words", () => {
  it("says Most for more than half and Some for the rest", () => {
    expect(words([11, 9, 5, 3], 14)).toStrictEqual([
      "most",
      "most",
      "some",
      "some",
    ]);
    // Exactly half is not more than half.
    expect(words([7, 4], 14)).toStrictEqual(["some", "some"]);
    expect(words([8, 4], 14)).toStrictEqual(["most", "some"]);
  });

  it("says Split on each bar tied for the lead, whatever its share", () => {
    expect(words([9, 9, 3], 14)).toStrictEqual(["split", "split", "some"]);
    expect(words([4, 4, 2], 14)).toStrictEqual(["split", "split", "some"]);
    // A tie below the lead is no split.
    expect(words([9, 3, 3], 14)).toStrictEqual(["most", "some", "some"]);
  });

  it("says All on a bar that is alone", () => {
    expect(words([3], 14)).toStrictEqual(["all"]);
    expect(words([14], 14)).toStrictEqual(["all"]);
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
