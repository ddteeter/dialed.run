import { describe, expect, it } from "vitest";

import {
  kitBackLink,
  kitOriginSchema,
  rowFromHash,
} from "../../src/modules/safety/components/kit-origin";

/**
 * Round 51 · 153 (#527): the row an operator opened a kit from, as the
 * kit's URL carries it. A URL is anyone's to type, so whatever is not a
 * whole origin reads as none.
 */
describe("kitOriginSchema", () => {
  it("takes a report's or a request's row", () => {
    expect(kitOriginSchema.parse({ from: "report", row: "r1" })).toStrictEqual({
      from: "report",
      row: "r1",
    });
    expect(kitOriginSchema.parse({ from: "request", row: "q1" })).toStrictEqual(
      { from: "request", row: "q1" },
    );
  });

  it("reads anything else as no origin, rather than failing", () => {
    expect(
      kitOriginSchema.parse({ from: "runners", row: "x".repeat(65) }),
    ).toStrictEqual({ from: undefined, row: undefined });
    expect(kitOriginSchema.parse({ from: 1, row: "" })).toStrictEqual({
      from: undefined,
      row: undefined,
    });
    expect(kitOriginSchema.parse({})).toStrictEqual({});
  });
});

describe("kitBackLink", () => {
  it("goes back to Review's top with no origin, or half of one", () => {
    // No anchor at all, not an empty one.
    const review = { label: "Back to Review" };
    expect(kitBackLink({})).toStrictEqual(review);
    expect(kitBackLink({ from: "report" })).toStrictEqual(review);
    expect(kitBackLink({ row: "r1" })).toStrictEqual(review);
  });

  it("names the report or the request and returns to its row", () => {
    expect(kitBackLink({ from: "report", row: "r1" })).toStrictEqual({
      label: "Back to the report",
      hash: "report-r1",
    });
    expect(kitBackLink({ from: "request", row: "q1" })).toStrictEqual({
      label: "Back to the request",
      hash: "request-q1",
    });
  });
});

describe("rowFromHash", () => {
  it("reads the row a back link's hash names, for its own list only", () => {
    // Round 52 #155.5: back from a kit, the row it was opened from.
    expect(rowFromHash("#report-01JROW", "report")).toBe("01JROW");
    expect(rowFromHash("#request-01JREQ", "request")).toBe("01JREQ");
    expect(rowFromHash("#request-01JREQ", "report")).toBeUndefined();
    expect(rowFromHash("report-01JROW", "report")).toBeUndefined();
    expect(rowFromHash("", "report")).toBeUndefined();
    // A hash with the prefix and no row is no row.
    expect(rowFromHash("#report-", "report")).toBeUndefined();
  });
});
