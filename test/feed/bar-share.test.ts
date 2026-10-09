import { describe, expect, it } from "vitest";

import { withShares } from "../../src/modules/feed/bar-share";

/**
The words alone, for rows of these runner counts.
*/
function words(counts: readonly number[]): string[] {
  return withShares(counts.map((runners) => ({ runners }))).map(
    ({ share }) => share,
  );
}

describe("withShares: round 27 #25's consensus words", () => {
  it("says Most on the leading bar and Some on the rest", () => {
    expect(words([11, 9, 5, 3])).toStrictEqual([
      "most",
      "some",
      "some",
      "some",
    ]);
  });

  it("says Most on a leading bar under half, because groups overlap", () => {
    // Of 14 runners, 5 is under half — but one runner counts in every
    // group they wore, so the words rank the bars, not shares of the 14.
    expect(words([5, 4, 3])).toStrictEqual(["most", "some", "some"]);
  });

  it("says Some on a bar over half that does not lead", () => {
    // 9 and 11 of 14 are both over half; only the leader is Most.
    expect(words([9, 11])).toStrictEqual(["some", "most"]);
  });

  it("says Split on each bar tied for the lead", () => {
    expect(words([9, 9, 3])).toStrictEqual(["split", "split", "some"]);
    expect(words([4, 4, 4])).toStrictEqual(["split", "split", "split"]);
    // A tie below the lead is no split.
    expect(words([9, 3, 3])).toStrictEqual(["most", "some", "some"]);
  });

  it("says All on a bar that is alone, as the ruling says, whatever its count", () => {
    // "A single bar reads All." Whether a lone bar short of every runner
    // should is open with design (design-deltas open item 54).
    expect(words([3])).toStrictEqual(["all"]);
    expect(words([14])).toStrictEqual(["all"]);
  });

  it("keeps each row with its own word, in order", () => {
    const rows = [
      { group: "tops", runners: 3 },
      { group: "bottoms", runners: 9 },
    ];
    expect(withShares(rows)).toStrictEqual([
      { row: rows[0], share: "some" },
      { row: rows[1], share: "most" },
    ]);
  });
});
