import { describe, expect, it } from "vitest";

import {
  kitBackLink,
  kitOriginSchema,
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
