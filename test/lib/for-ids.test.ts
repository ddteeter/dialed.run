import { describe, expect, it, vi } from "vitest";

import { forIds } from "../../src/lib/for-ids";

/**
 * The empty-id-list guard, which four reads in the feed lane and three on
 * the profile had each grown for themselves. An `inArray` over nothing
 * matches nothing, so the guard changes no answer — what it saves is the
 * query, on exactly the pages that have nothing to look anything up for.
 */

describe("forIds", () => {
  it("asks nothing for an empty list", async () => {
    const read = vi.fn<() => Promise<string[]>>();

    expect(await forIds([], read)).toStrictEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("runs the read for a non-empty list, and hands back its rows", async () => {
    const read = vi.fn<() => Promise<string[]>>(() =>
      Promise.resolve(["a", "b"]),
    );

    expect(await forIds(["one"], read)).toStrictEqual(["a", "b"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("hands back an empty result from a read that found nothing", async () => {
    // Distinct from the guard: the ids existed, the rows did not.
    const read = vi.fn<() => Promise<string[]>>(() => Promise.resolve([]));

    expect(await forIds(["missing"], read)).toStrictEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
