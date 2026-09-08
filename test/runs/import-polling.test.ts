import { describe, expect, it } from "vitest";

import {
  hasStalledImport,
  importPollIntervalMs,
} from "../../src/modules/runs/import-polling";

/**
 * Polling is cheap per request and unbounded in aggregate, so what matters
 * is that it *stops*. The review asked for this to be confirmed rather
 * than asserted, and confirming it found that it did not: the interval
 * only ended on a terminal status, so an import wedged in `processing` —
 * a consumer that claimed the row and then died — left every open tab
 * polling every two seconds indefinitely.
 *
 * The policy is a pure function precisely so this is testable without
 * timers or a rendered component.
 */
describe("import status polling", () => {
  it("polls while the import is still working", () => {
    expect(importPollIntervalMs("pending", 0)).toBeGreaterThan(0);
    expect(importPollIntervalMs("processing", 5)).toBeGreaterThan(0);
  });

  it("stops the moment the import reaches a terminal state", () => {
    expect(importPollIntervalMs("imported", 1)).toBe(0);
    expect(importPollIntervalMs("failed", 1)).toBe(0);
  });

  it("stops on an unknown status rather than polling forever", () => {
    // A status this build does not recognise is a deploy skew, not a
    // reason to keep asking.
    expect(importPollIntervalMs("something-new", 0)).toBe(0);
    expect(importPollIntervalMs(undefined, 0)).toBe(0);
  });

  it("gives up on an import that never finishes", () => {
    // The case the queue's own retries and the DLQ already own. A browser
    // asking again for the rest of the afternoon adds nothing.
    expect(importPollIntervalMs("processing", 60)).toBe(0);
    expect(importPollIntervalMs("processing", 10_000)).toBe(0);
  });

  it("tells the user only once it has actually given up", () => {
    expect(hasStalledImport("processing", 0)).toBe(false);
    expect(hasStalledImport("processing", 30_000)).toBe(false);
    expect(hasStalledImport("processing", 120_000)).toBe(true);
  });

  it("never calls a finished import stalled, however long it took", () => {
    expect(hasStalledImport("imported", 600_000)).toBe(false);
    expect(hasStalledImport("failed", 600_000)).toBe(false);
  });
});
