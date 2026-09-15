import { describe, expect, it } from "vitest";

import {
  decide,
  imageCategories,
  thresholds,
  type CategoryScores,
} from "../../src/modules/safety/classifier/moderation";

/**
 * All-zero scores, the shape a benign flat-lay produces. Tests raise one
 * category at a time from here, so each assertion is about exactly one
 * threshold.
 */
function clean(overrides: Partial<CategoryScores> = {}): CategoryScores {
  const zeroes = Object.fromEntries(
    imageCategories.map((category) => [category, 0]),
  ) as CategoryScores;
  return { ...zeroes, ...overrides };
}

describe("the threshold rule", () => {
  it("passes an ordinary photo", () => {
    expect(decide(clean())).toBe("pass");
  });

  it("flags a category that reaches its threshold exactly", () => {
    // `>=`, not `>`. The boundary is a real decision: a score sitting
    // exactly on the line should flag, because the threshold is "this much
    // is too much" rather than "more than this".
    expect(decide(clean({ sexual: thresholds.sexual }))).toBe("flag");
  });

  it("passes a category just under its threshold", () => {
    expect(decide(clean({ sexual: thresholds.sexual - 0.0001 }))).toBe("pass");
  });

  it("uses each category's own threshold, not one shared number", () => {
    // violence/graphic is looser than sexual. A score of 0.85 is over one
    // and under the other, so a single shared threshold would answer this
    // pair identically and this test would fail.
    expect(thresholds["violence/graphic"]).toBeLessThan(thresholds.sexual);
    expect(decide(clean({ "violence/graphic": 0.85 }))).toBe("flag");
    expect(decide(clean({ sexual: 0.85 }))).toBe("pass");
  });

  it("flags when any single category crosses, not only when several do", () => {
    for (const category of imageCategories) {
      expect(decide(clean({ [category]: 1 }))).toBe("flag");
    }
  });

  it("does not add categories together", () => {
    // Four categories at 0.7 is not the same as one at 0.9. A rule that
    // summed or averaged would flag this, and a photo that is mildly
    // nothing-in-particular on several axes is a normal photo.
    expect(
      decide(
        clean({
          sexual: 0.7,
          violence: 0.7,
          "self-harm": 0.7,
          "violence/graphic": 0.7,
        }),
      ),
    ).toBe("pass");
  });
});

describe("the thresholds themselves", () => {
  it("covers every image-capable category", () => {
    // A category present in the list but missing from the table would read
    // as `undefined`, and `score >= undefined` is false — so it would
    // silently never flag. Deriving the check from the list is what stops
    // the two drifting.
    for (const category of imageCategories) {
      expect(typeof thresholds[category]).toBe("number");
    }
  });

  it("is deliberately high, because the documented failure is over-flagging", () => {
    // Not a style assertion: the packet's whole worry is false positives on
    // sports imagery, and a threshold anyone drops to 0.5 in a hurry should
    // have to change this line and say why.
    for (const category of imageCategories) {
      expect(thresholds[category]).toBeGreaterThanOrEqual(0.8);
      expect(thresholds[category]).toBeLessThanOrEqual(1);
    }
  });

  it("does not include the text-only categories", () => {
    // sexual/minors is text-only, so it scores 0 on every image. Listing it
    // here would imply this classifier covers CSAM, which it does not —
    // that is Cloudflare's scanning tool, configured outside this lane.
    const names: readonly string[] = imageCategories;
    expect(names).not.toContain("sexual/minors");
    expect(names).not.toContain("harassment");
    expect(names).not.toContain("hate");
    expect(names).not.toContain("illicit");
  });
});
