import { describe, expect, it } from "vitest";

import { DURATION, EASING, STAGGER, TRAVEL } from "../../src/ui";

describe("motion tokens (design motion doctrine)", () => {
  it("nothing in the product animates longer than reveal, and reveal < 400ms", () => {
    const durations = Object.values(DURATION);
    expect(Math.max(...durations)).toBe(DURATION.reveal);
    expect(DURATION.reveal).toBeLessThan(400);
  });

  it("has exactly three curves, all decelerating to a dead stop or exiting", () => {
    expect(Object.keys(EASING)).toEqual(["snap", "exit", "align"]);
    for (const curve of Object.values(EASING)) {
      expect(curve).toMatch(/^cubic-bezier\([\d ,.]+\)$/u);
    }
  });

  it("keeps travel element-scale and stagger meaningful-only", () => {
    expect(TRAVEL.element).toBeLessThanOrEqual(24);
    expect(STAGGER.maxItems).toBeLessThanOrEqual(4);
  });
});
