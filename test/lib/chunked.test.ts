import { describe, expect, it } from "vitest";

import { chunked } from "../../src/lib/chunked";

describe("chunked", () => {
  it("splits into runs of the given size, in order", () => {
    expect(chunked([1, 2, 3, 4, 5, 6], 2)).toStrictEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("gives the remainder its own short chunk", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toStrictEqual([[1, 2], [3, 4], [5]]);
  });

  it("adds no trailing empty chunk when the split is exact", () => {
    // An off-by-one on the loop bound shows up here and nowhere else: an
    // empty chunk still produces the right answer downstream, it just
    // costs a query that matches nothing.
    expect(chunked([1, 2], 2)).toStrictEqual([[1, 2]]);
  });

  it("answers with nothing for an empty list", () => {
    expect(chunked([], 3)).toStrictEqual([]);
  });

  it("gives one chunk when the list is shorter than the size", () => {
    expect(chunked([1], 20)).toStrictEqual([[1]]);
  });
});
