import { describe, expect, it } from "vitest";

import {
  SHARE_WORDS,
  summarySentence,
  withShares,
} from "../../src/modules/feed/bar-share";
import type { DialedType } from "../../src/modules/feed/bar-share";

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

/**
 * One type the dialed runners wore. `at` is when it was last dialed; the
 * group is the rail group it sits in.
 */
function worn(
  type: DialedType["type"],
  runners: number,
  group: DialedType["group"],
  at = 0,
): DialedType {
  return { type, runners, group, lastDialedAt: at };
}

describe("summarySentence (round 47 #114, round 49 #137)", () => {
  it("names types in their own words, leading with the highest tier (137c′)", () => {
    // The board's own example: "Most got it right in long sleeve and
    // shorts. Some added gloves."
    expect(
      summarySentence({
        runners: 6,
        types: [
          worn("gloves", 2, "hands_head"),
          worn("shorts", 4, "bottoms"),
          worn("longSleeve", 5, "tops"),
        ],
      }),
    ).toBe("Most got it right in long sleeve and shorts. Some added gloves.");
  });

  it("goes All, then Most, then Some, and never merges a tier (137c′)", () => {
    expect(
      summarySentence({
        runners: 4,
        types: [
          worn("shoes", 2, "shoes"),
          worn("tee", 3, "tops"),
          worn("tights", 4, "bottoms"),
        ],
      }),
    ).toBe("All got it right in tights. Most added tee. Some added shoes.");
  });

  it("names each type at its own strength, with no fallback to category (137b′)", () => {
    // 4 tee, 3 long sleeve and 2 singlet out of 9: all three are Some,
    // and the singlet is named too, since two wore it.
    expect(
      summarySentence({
        runners: 9,
        types: [
          worn("singlet", 2, "tops"),
          worn("tee", 4, "tops"),
          worn("longSleeve", 3, "tops"),
        ],
      }),
    ).toBe("Some got it right in tee, long sleeve, and singlet.");
  });

  it("names at most three to a clause, dropping the lowest counts (137b′)", () => {
    expect(
      summarySentence({
        runners: 10,
        types: [
          worn("beanie", 2, "hands_head"),
          worn("tee", 4, "tops"),
          worn("shorts", 3, "bottoms"),
          worn("gloves", 3, "hands_head"),
        ],
      }),
    ).toBe("Some got it right in tee, shorts, and gloves.");
  });

  it("breaks a tie at the cut toward the one dialed most recently (137b′)", () => {
    const types = [
      worn("tee", 4, "tops"),
      worn("shorts", 3, "bottoms"),
      worn("beanie", 2, "hands_head", 100),
      worn("gloves", 2, "hands_head", 200),
    ];
    expect(summarySentence({ runners: 10, types })).toBe(
      "Some got it right in tee, shorts, and gloves.",
    );
    expect(
      summarySentence({
        runners: 10,
        types: types.map((row) =>
          row.type === "beanie" ? { ...row, lastDialedAt: 300 } : row,
        ),
      }),
    ).toBe("Some got it right in tee, shorts, and beanie.");
  });

  it("puts a clause's types in C's rail group order, then by count (137c′)", () => {
    expect(
      summarySentence({
        runners: 10,
        types: [
          worn("gloves", 4, "hands_head"),
          worn("shorts", 2, "bottoms"),
          worn("singlet", 2, "tops"),
          worn("tee", 3, "tops"),
        ],
      }),
    ).toBe("Some got it right in tee, shorts, and gloves.");
    expect(
      summarySentence({
        runners: 10,
        types: [
          worn("singlet", 2, "tops"),
          worn("tee", 3, "tops"),
          worn("shorts", 4, "bottoms"),
        ],
      }),
    ).toBe("Some got it right in tee, singlet, and shorts.");
  });

  it("says nothing when nobody dialed, or no type holds two of them", () => {
    expect(summarySentence({ runners: 0, types: [] })).toBeUndefined();
    expect(summarySentence({ runners: 3, types: [] })).toBeUndefined();
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
