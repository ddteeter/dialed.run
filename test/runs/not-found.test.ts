import { describe, expect, it } from "vitest";

import {
  RunNotFoundError,
  runOrNotFound,
} from "../../src/modules/runs/not-found";

describe("runOrNotFound", () => {
  /**
   * TanStack's own `notFound()` returns a plain options object rather than
   * an Error, and the house `only-throw-error` rule rejects throwing that.
   * This is the wrapper, and it lives beside the route rather than in it
   * because a route file cannot be imported by any test.
   */
  it("hands the run back when there is one", () => {
    const run = { id: "01RUN" };
    expect(runOrNotFound(run)).toBe(run);
  });

  it("throws something the router reads as a 404", () => {
    // `isNotFound` is what the router duck-types on. Without it the miss
    // is a 500 — an error screen where a "no such run" belongs.
    let thrown: unknown;
    try {
      runOrNotFound(undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RunNotFoundError);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      isNotFound: true,
      message: "Run not found.",
    });
  });
});
