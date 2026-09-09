import { describe, expect, it } from "vitest";

import { topByCount } from "../../src/lib/top-by-count";

/**
 * The selection behind the closet's "pairs with" and the profile's "most
 * worn". Both were doing it by hand, in their own loop, neither tested —
 * and between them they carried twenty-odd surviving mutants in two
 * nested loops of index arithmetic.
 */

describe("topByCount", () => {
  it("takes the highest counts, highest first", () => {
    expect(
      topByCount(
        new Map([
          ["cap", 1],
          ["shorts", 5],
          ["socks", 3],
        ]),
        2,
      ),
    ).toStrictEqual([
      ["shorts", 5],
      ["socks", 3],
    ]);
  });

  it("takes exactly as many as asked for", () => {
    const counts = new Map([
      ["a", 4],
      ["b", 3],
      ["c", 2],
      ["d", 1],
    ]);
    expect(topByCount(counts, 3)).toHaveLength(3);
    expect(topByCount(counts, 1)).toStrictEqual([["a", 4]]);
  });

  it("asked for none, answers with none", () => {
    expect(topByCount(new Map([["a", 4]]), 0)).toStrictEqual([]);
  });

  it("never pads: fewer entries than asked for yields all of them", () => {
    expect(topByCount(new Map([["shorts", 5]]), 5)).toStrictEqual([
      ["shorts", 5],
    ]);
    expect(topByCount(new Map(), 5)).toStrictEqual([]);
  });

  it("never takes the same entry twice", () => {
    // The taken entry is removed as it is taken; without that the top
    // count fills every slot.
    const picked = topByCount(
      new Map([
        ["a", 4],
        ["b", 3],
      ]),
      2,
    );
    expect(picked.map(([id]) => id)).toStrictEqual(["a", "b"]);
  });

  it("keeps the first of two equal counts", () => {
    // Ties are the common case early on, when everything has been worn
    // once. Which one wins is arbitrary; that it is stable is not, because
    // the list is rendered again on every visit.
    expect(
      topByCount(
        new Map([
          ["a", 2],
          ["b", 2],
        ]),
        1,
      ),
    ).toStrictEqual([["a", 2]]);
  });

  it("looks past the first entry to find the highest", () => {
    expect(
      topByCount(
        new Map([
          ["a", 1],
          ["b", 2],
          ["c", 9],
        ]),
        1,
      ),
    ).toStrictEqual([["c", 9]]);
  });

  it("takes an entry counted once", () => {
    // A pair worn together exactly once is still that runner's pair.
    expect(topByCount(new Map([["cap", 1]]), 2)).toStrictEqual([["cap", 1]]);
  });

  it("leaves the caller's tally alone", () => {
    const counts = new Map([["a", 4]]);
    topByCount(counts, 1);
    expect(counts.get("a")).toBe(4);
  });
});
