import { describe, expect, it } from "vitest";

import { runClockLabel } from "../../src/modules/runs/run-clock";

/**
 * P2a-02: a run's start on its clock, and never an unmarked UTC time.
 */
describe("runClockLabel", () => {
  // Sat Aug 29 2026, 11:04 UTC.
  const START = Date.UTC(2026, 7, 29, 11, 4) / 1000;

  it("reads the start on the run's clock", () => {
    expect(runClockLabel(START, "America/Los_Angeles")).toBe("4:04 AM");
  });

  it("says UTC when there is no clock to read it on", () => {
    expect(runClockLabel(START, undefined)).toBe("11:04 AM UTC");
  });
});
