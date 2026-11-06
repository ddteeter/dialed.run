import { describe, expect, it } from "vitest";

import {
  SHARE_WORDS,
  summarySentence,
  withShares,
} from "../../src/modules/feed/bar-share";

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

describe("summarySentence (round 47 #114)", () => {
  it("leads with the most-held word, and adds the rest after it", () => {
    // The Feed board's own: "Most got it right in … Some added …".
    expect(
      summarySentence({
        runners: 6,
        groups: [
          { group: "tops", runners: 5 },
          { group: "bottoms", runners: 4 },
          { group: "hands_head", runners: 2 },
        ],
      }),
    ).toBe("Most got it right in tops and bottoms. Some added hands / head.");
  });

  it("says All for a group every dialed runner wore, then Most, then Some", () => {
    expect(
      summarySentence({
        runners: 4,
        groups: [
          { group: "bottoms", runners: 4 },
          { group: "tops", runners: 3 },
          { group: "shoes", runners: 2 },
        ],
      }),
    ).toBe("All got it right in bottoms. Most added tops. Some added shoes.");
  });

  it("leads with Some when no group reaches more than half", () => {
    expect(
      summarySentence({
        runners: 6,
        groups: [
          { group: "outer", runners: 3 },
          { group: "shoes", runners: 2 },
        ],
      }),
    ).toBe("Some got it right in outer and shoes.");
  });

  it("lists three or more in a series", () => {
    expect(
      summarySentence({
        runners: 2,
        groups: [
          { group: "tops", runners: 2 },
          { group: "bottoms", runners: 2 },
          { group: "socks_extras", runners: 2 },
        ],
      }),
    ).toBe("All got it right in tops, bottoms, and socks / extras.");
  });

  it("says nothing when nobody dialed, or no group holds two of them", () => {
    expect(summarySentence({ runners: 0, groups: [] })).toBeUndefined();
    expect(summarySentence({ runners: 3, groups: [] })).toBeUndefined();
  });
});

describe("SHARE_WORDS", () => {
  it("is a word for every share", () => {
    expect(SHARE_WORDS).toStrictEqual({
      all: "All",
      most: "Most",
      some: "Some",
    });
  });
});
