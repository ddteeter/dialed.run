import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import {
  RunNotFoundError,
  backToUpload,
  beforeItsEntry,
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

/**
The redirect `work` throws, or a failure saying it threw none.
*/
function redirectFrom(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    if (isRedirect(error)) return error;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("backToUpload", () => {
  it("sends the retired import status URL to A1", () => {
    // Round 22: "`/runs/import/$id` goes … the old URL redirects to A1".
    expect(redirectFrom(backToUpload)).toMatchObject({
      options: { to: "/runs/new" },
    });
  });
});

describe("beforeItsEntry", () => {
  it("hands back a run with no entry — run detail is where it belongs", () => {
    const run = { entryId: undefined, hasVerdict: false };
    expect(beforeItsEntry(run)).toBe(run);
  });

  it("sends a run with a kit and no verdict on to its verdict", () => {
    expect(
      redirectFrom(() =>
        beforeItsEntry({ entryId: "01ENTRY", hasVerdict: false }),
      ),
    ).toMatchObject({
      options: {
        to: "/feed/verdict/$entryId",
        params: { entryId: "01ENTRY" },
      },
    });
  });

  it("sends a run with a verdict on to its post — the route shows D instead", () => {
    expect(
      redirectFrom(() =>
        beforeItsEntry({ entryId: "01ENTRY", hasVerdict: true }),
      ),
    ).toMatchObject({
      options: { to: "/feed/entry/$entryId", params: { entryId: "01ENTRY" } },
    });
  });
});
