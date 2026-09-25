import { describe, expect, it } from "vitest";

import {
  STALL_AFTER_MS,
  importPollIntervalMs,
  isReading,
} from "../../src/modules/runs/import-polling";

/**
 * When A1 asks again, and when it stops.
 *
 * The budget is the part that matters: polling used to continue for as
 * long as the status was non-terminal, which is fine for the normal case
 * and wrong for the one it exists for — an import wedged in `processing`
 * left every open tab asking every two seconds, forever. And since the
 * parsed card lands in place (round 22), a run whose weather is still
 * being asked for is still worth asking about.
 */

const INTERVAL = 2000;
const BUDGET_POLLS = 60;

describe("importPollIntervalMs", () => {
  it("asks again every two seconds while the file is read", () => {
    expect(importPollIntervalMs({ status: "pending" }, 0)).toBe(INTERVAL);
    expect(importPollIntervalMs({ status: "processing" }, 3)).toBe(INTERVAL);
  });

  it("asks again while a run that landed waits on its weather", () => {
    expect(
      importPollIntervalMs(
        { status: "done", run: { weatherStatus: "pending" } },
        1,
      ),
    ).toBe(INTERVAL);
  });

  it("stops once the weather has an answer, whichever it is", () => {
    for (const weatherStatus of ["attached", "manual", "failed", "none"]) {
      expect(
        importPollIntervalMs({ status: "done", run: { weatherStatus } }, 1),
        weatherStatus,
      ).toBe(0);
    }
  });

  it("stops on every other outcome, and on a done with no run to read", () => {
    expect(importPollIntervalMs({ status: "failed" }, 1)).toBe(0);
    expect(
      importPollIntervalMs(
        { status: "duplicate", run: { weatherStatus: "pending" } },
        1,
      ),
    ).toBe(0);
    expect(importPollIntervalMs({ status: "done" }, 1)).toBe(0);
  });

  it("keeps asking when no answer has come back yet, within the budget", () => {
    // What a first poll that failed leaves behind. Stopping here ended the
    // wait for good on one dropped request.
    expect(importPollIntervalMs(undefined, 0)).toBe(INTERVAL);
    expect(importPollIntervalMs(undefined, BUDGET_POLLS - 1)).toBe(INTERVAL);
    expect(importPollIntervalMs(undefined, BUDGET_POLLS)).toBe(0);
  });

  it("gives up after two minutes of asking, and not a poll before", () => {
    expect(importPollIntervalMs({ status: "pending" }, BUDGET_POLLS - 1)).toBe(
      INTERVAL,
    );
    expect(importPollIntervalMs({ status: "pending" }, BUDGET_POLLS)).toBe(0);
  });
});

describe("isReading", () => {
  it("is true while the file is pending or being processed, and only then", () => {
    expect(isReading("pending")).toBe(true);
    expect(isReading("processing")).toBe(true);
    expect(isReading("done")).toBe(false);
    expect(isReading(undefined)).toBe(false);
  });
});

describe("STALL_AFTER_MS", () => {
  it("is round 22's twenty seconds", () => {
    expect(STALL_AFTER_MS).toBe(20_000);
  });
});
