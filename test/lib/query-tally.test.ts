import { describe, expect, it } from "vitest";

import {
  addStatement,
  NO_QUERIES,
  rowsReadOf,
} from "../../src/lib/sql/query-tally";

describe("rowsReadOf", () => {
  it("reads meta.rows_read", () => {
    expect(rowsReadOf({ meta: { rows_read: 7 } })).toBe(7);
  });

  it("reads a result without it as zero", () => {
    expect(rowsReadOf({ meta: {} })).toBe(0);
  });
});

describe("addStatement", () => {
  it("adds one statement and its rows", () => {
    const once = addStatement(NO_QUERIES, 3);
    expect(addStatement(once, 4)).toEqual({ statements: 2, rowsRead: 7 });
  });

  it("starts from nothing", () => {
    expect(NO_QUERIES).toEqual({ statements: 0, rowsRead: 0 });
  });
});
