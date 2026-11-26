import { describe, expect, it } from "vitest";

import { workedRange } from "../../../src/modules/call/scorer";
import { aRun, wore } from "./builders";

const kit = [wore("zip", "tops"), wore("shorts", "bottoms")];

describe("the range a piece has worked at (#386)", () => {
  it("spans the coldest and warmest dialed runs it was worn on", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 6.5, worn: kit }),
      aRun({ judgedFeelsLikeC: -2, worn: kit }),
      aRun({ judgedFeelsLikeC: 11, worn: kit }),
      aRun({ judgedFeelsLikeC: 3, worn: kit }),
    ];

    expect(workedRange("zip", history)).toStrictEqual({ lowC: -2, highC: 11 });
  });

  it("is one point wide after one dialed run", () => {
    expect(
      workedRange("zip", [aRun({ judgedFeelsLikeC: 8, worn: kit })]),
    ).toStrictEqual({ lowC: 8, highC: 8 });
  });

  it("leaves out runs that were not dialed", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 8, worn: kit }),
      aRun({ judgedFeelsLikeC: -9, verdict: -1, worn: kit }),
      aRun({ judgedFeelsLikeC: 24, verdict: 2, worn: kit }),
    ];

    expect(workedRange("zip", history)).toStrictEqual({ lowC: 8, highC: 8 });
  });

  it("leaves out a dialed run the runner flagged the piece on", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 8, worn: kit }),
      aRun({
        judgedFeelsLikeC: 19,
        worn: [wore("zip", "tops", "too_much"), wore("shorts", "bottoms")],
      }),
      aRun({
        judgedFeelsLikeC: -6,
        worn: [wore("zip", "tops", "not_enough"), wore("shorts", "bottoms")],
      }),
    ];

    expect(workedRange("zip", history)).toStrictEqual({ lowC: 8, highC: 8 });
    expect(workedRange("shorts", history)).toStrictEqual({
      lowC: -6,
      highC: 19,
    });
  });

  it("leaves out runs the piece was not worn on", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 8, worn: kit }),
      aRun({ judgedFeelsLikeC: 30, worn: [wore("tee", "tops")] }),
    ];

    expect(workedRange("zip", history)).toStrictEqual({ lowC: 8, highC: 8 });
  });

  it("leaves out runs whose weather a human typed", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 8, worn: kit }),
      aRun({ judgedFeelsLikeC: 30, source: "manual", worn: kit }),
    ];

    expect(workedRange("zip", history)).toStrictEqual({ lowC: 8, highC: 8 });
  });

  it("is nothing for a piece with no dialed, unflagged, counted run", () => {
    const history = [
      aRun({ verdict: 1, worn: kit }),
      aRun({ worn: [wore("zip", "tops", "too_much")] }),
    ];

    expect(workedRange("zip", history)).toBeUndefined();
    expect(workedRange("zip", [])).toBeUndefined();
  });
});
