import { describe, expect, it, vi } from "vitest";

import { chunked, IN_LIST_CHUNK, readInChunks } from "../../src/lib/chunked";

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

describe("readInChunks", () => {
  it("never hands a read more ids than D1 can bind, and keeps them all", async () => {
    // D1 refuses a statement with more than 100 bound parameters.
    expect(IN_LIST_CHUNK).toBeLessThan(100);
    const ids = Array.from({ length: 2 * IN_LIST_CHUNK + 1 }, (_, index) => index);
    const read = vi.fn((chunk: number[]) => Promise.resolve(chunk.map((id) => id * 10)));

    const rows = await readInChunks(ids, read);

    expect(read.mock.calls.map(([chunk]) => chunk.length)).toStrictEqual([
      IN_LIST_CHUNK,
      IN_LIST_CHUNK,
      1,
    ]);
    // Every row, in chunk order.
    expect(rows).toStrictEqual(ids.map((id) => id * 10));
  });

  it("reads nothing for no ids", async () => {
    const read = vi.fn(() => Promise.resolve(["row"]));

    expect(await readInChunks([], read)).toStrictEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
