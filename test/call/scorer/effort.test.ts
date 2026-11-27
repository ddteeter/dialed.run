import { describe, expect, it } from "vitest";

import {
  EFFORT_WARMTH_C,
  feelAtEffortC,
} from "../../../src/modules/call/scorer/effort";

describe("how much warmer an hour feels at an effort (owner, 2026-11-26)", () => {
  it("starts from this table, so a tuning is one visible change", () => {
    expect(EFFORT_WARMTH_C).toStrictEqual({
      easy: 0,
      steady: 2,
      workout: 5,
      race: 7,
    });
  });

  it("adds the effort's warmth to the feel", () => {
    expect(feelAtEffortC(4, "easy")).toBe(4);
    expect(feelAtEffortC(4, "steady")).toBe(6);
    expect(feelAtEffortC(4, "workout")).toBe(9);
    expect(feelAtEffortC(-3, "race")).toBe(4);
  });

  it("counts a run with no effort as easy", () => {
    expect(feelAtEffortC(4)).toBe(4);
  });
});
