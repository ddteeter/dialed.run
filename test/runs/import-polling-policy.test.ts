import { describe, expect, it } from "vitest";

import {
  hasStalledImport,
  importPollIntervalMs,
} from "../../src/modules/runs/import-polling";

/**
 * When to keep asking, and when to stop.
 *
 * The budget is the part that matters: polling used to continue for as
 * long as the status was non-terminal, which is fine for the normal case
 * and wrong for the one it exists for — an import wedged in `processing`
 * left every open tab asking every two seconds, forever.
 */

const INTERVAL = 2000;
const BUDGET_POLLS = 60;

describe("importPollIntervalMs", () => {
  it("keeps polling while the import is still in flight", () => {
    expect(importPollIntervalMs("pending", 0)).toBe(INTERVAL);
    expect(importPollIntervalMs("processing", 1)).toBe(INTERVAL);
  });

  it("stops the moment the import reaches a conclusion", () => {
    for (const status of ["done", "failed", "duplicate", undefined]) {
      expect(importPollIntervalMs(status, 0), String(status)).toBe(0);
    }
  });

  it("stops at the budget, and not one poll before it", () => {
    // Two minutes at two seconds a poll. The last poll inside the budget
    // still happens; the one past it does not.
    expect(importPollIntervalMs("pending", BUDGET_POLLS - 1)).toBe(INTERVAL);
    expect(importPollIntervalMs("pending", BUDGET_POLLS)).toBe(0);
    expect(importPollIntervalMs("pending", BUDGET_POLLS + 1)).toBe(0);
  });
});

describe("hasStalledImport", () => {
  it("is false while the import is still within its budget", () => {
    expect(hasStalledImport("pending", 0)).toBe(false);
    expect(hasStalledImport("processing", 119_999)).toBe(false);
  });

  it("is true once the budget has elapsed with the import unfinished", () => {
    // Exactly at the budget counts: the message the user sees is "this is
    // taking a while", and it is due at two minutes.
    expect(hasStalledImport("pending", 120_000)).toBe(true);
    expect(hasStalledImport("processing", 500_000)).toBe(true);
  });

  it("is false for an import that finished, however long it took", () => {
    for (const status of ["done", "failed", "duplicate", undefined]) {
      expect(hasStalledImport(status, 500_000), String(status)).toBe(false);
    }
  });
});
