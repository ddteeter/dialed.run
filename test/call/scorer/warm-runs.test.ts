import { describe, expect, it } from "vitest";

import { warmRunsWorn } from "../../../src/modules/call/scorer/warm-runs";
import { aPiece, aRun, wore } from "./builders";

const closet = [
  aPiece("zip", "tops", { lowC: 3, highC: 12 }),
  aPiece("tee", "tops", { lowC: 13 }),
  aPiece("vest", "outer", { lowC: -4, highC: 6 }),
  aPiece("cap", "hands_head"),
];

describe("what was worn on the too-warm runs", () => {
  it("is nothing, in the band it was asked for, when no run was too warm", () => {
    const runs = [
      aRun({ verdict: 0, worn: [wore("zip", "tops")] }),
      aRun({ verdict: -1, worn: [wore("tee", "tops")] }),
      aRun({ verdict: -2, worn: [wore("vest", "outer")] }),
    ];

    expect(warmRunsWorn(runs, closet, 5)).toStrictEqual({
      bandFloorC: 5,
      worn: [],
    });
    expect(warmRunsWorn([], closet, 10)).toStrictEqual({
      bandFloorC: 10,
      worn: [],
    });
  });

  it("counts a run a little too warm and one much too warm alike", () => {
    const runs = [
      aRun({ verdict: 1, worn: [wore("zip", "tops")] }),
      aRun({ verdict: 2, worn: [wore("vest", "outer")] }),
    ];

    expect(warmRunsWorn(runs, closet, 5).worn).toStrictEqual([
      { pieceId: "vest", group: "outer", estimate: { lowC: -4, highC: 6 } },
      { pieceId: "zip", group: "tops", estimate: { lowC: 3, highC: 12 } },
    ]);
  });

  it("names each piece once, however many warm runs it was worn on", () => {
    const worn = [wore("zip", "tops"), wore("vest", "outer")];
    const runs = [
      aRun({ verdict: 1, worn }),
      aRun({ verdict: 1, worn }),
      aRun({ verdict: 2, worn: [wore("zip", "tops")] }),
    ];

    expect(
      warmRunsWorn(runs, closet, 5).worn.map((piece) => piece.pieceId),
    ).toStrictEqual(["vest", "zip"]);
  });

  it("lists the pieces by id, whatever order they were worn in", () => {
    const first = aRun({
      verdict: 1,
      worn: [wore("zip", "tops"), wore("cap", "hands_head")],
    });
    const second = aRun({
      verdict: 2,
      worn: [wore("vest", "outer"), wore("tee", "tops")],
    });
    const inIdOrder = ["cap", "tee", "vest", "zip"];

    expect(
      warmRunsWorn([first, second], closet, 5).worn.map((p) => p.pieceId),
    ).toStrictEqual(inIdOrder);
    expect(
      warmRunsWorn([second, first], closet, 5).worn.map((p) => p.pieceId),
    ).toStrictEqual(inIdOrder);
  });

  it("carries the closet's estimate, and none for a piece without one", () => {
    const runs = [
      aRun({
        verdict: 1,
        worn: [wore("cap", "hands_head"), wore("tee", "tops")],
      }),
    ];

    expect(warmRunsWorn(runs, closet, 5).worn).toStrictEqual([
      { pieceId: "cap", group: "hands_head", estimate: undefined },
      { pieceId: "tee", group: "tops", estimate: { lowC: 13 } },
    ]);
  });

  it("still names a piece the closet no longer holds, with no estimate", () => {
    const runs = [aRun({ verdict: 1, worn: [wore("retired", "bottoms")] })];

    expect(warmRunsWorn(runs, closet, 5).worn).toStrictEqual([
      { pieceId: "retired", group: "bottoms", estimate: undefined },
    ]);
  });

  it("leaves the flag a piece was worn with out of the fact", () => {
    const runs = [
      aRun({ verdict: 1, worn: [wore("vest", "outer", "too_much")] }),
    ];

    expect(warmRunsWorn(runs, closet, 5).worn).toStrictEqual([
      { pieceId: "vest", group: "outer", estimate: { lowC: -4, highC: 6 } },
    ]);
  });
});
