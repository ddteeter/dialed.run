import { describe, expect, it } from "vitest";

import {
  bandCount,
  countedRuns,
  groupRecord,
  pieceCounts,
  pieceRecord,
  scopedRuns,
} from "../../../src/modules/call/scorer/personal";
import { aRun, wore } from "./builders";

const BAND_5_DRY = { bandFloorC: 5, precip: "dry" } as const;

describe("which runs are counted", () => {
  it("leaves out a run whose weather a human typed (reading 3)", () => {
    const measured = aRun();
    const typed = aRun({ source: "manual" });

    expect(countedRuns([typed, measured])).toStrictEqual([measured]);
  });

  it("takes the band's runs from its floor up to the next floor", () => {
    const atFloor = aRun({ judgedFeelsLikeC: 5 });
    const nearTop = aRun({ judgedFeelsLikeC: 9.9 });
    const justBelow = aRun({ judgedFeelsLikeC: 4.9 });
    const nextBand = aRun({ judgedFeelsLikeC: 10 });

    expect(
      scopedRuns([justBelow, atFloor, nearTop, nextBand], BAND_5_DRY),
    ).toStrictEqual([atFloor, nearTop]);
  });

  it("takes only the runs of the Call's condition class (reading 1)", () => {
    const dry = aRun({ precip: "dry" });
    const damp = aRun({ precip: "damp" });
    const wet = aRun({ precip: "wet" });

    expect(
      scopedRuns([dry, damp, wet], { bandFloorC: 5, precip: "damp" }),
    ).toStrictEqual([damp]);
  });

  it("needs the band and the class both", () => {
    const rightClassWrongBand = aRun({ judgedFeelsLikeC: 12 });
    const rightBandWrongClass = aRun({ precip: "wet" });

    expect(
      scopedRuns([rightClassWrongBand, rightBandWrongClass], BAND_5_DRY),
    ).toStrictEqual([]);
  });

  it("leaves a typed-weather run out of its band too", () => {
    expect(scopedRuns([aRun({ source: "manual" })], BAND_5_DRY)).toStrictEqual(
      [],
    );
  });

  it("takes every counted run when there is no band", () => {
    const cold = aRun({ judgedFeelsLikeC: -12, precip: "wet" });
    const warm = aRun({ judgedFeelsLikeC: 24 });
    const typed = aRun({ source: "manual" });

    expect(scopedRuns([cold, typed, warm], undefined)).toStrictEqual([
      cold,
      warm,
    ]);
  });
});

describe("how a band felt", () => {
  it("counts both cold verdicts as cold and both warm ones as warm", () => {
    const felt = [-2, -1, -1, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2] as const;

    expect(bandCount(felt.map((verdict) => aRun({ verdict })))).toStrictEqual({
      cold: 3,
      dialed: 4,
      warm: 6,
    });
  });

  it("counts nothing of no runs", () => {
    expect(bandCount([])).toStrictEqual({ cold: 0, dialed: 0, warm: 0 });
  });
});

describe("a piece's record", () => {
  it("counts its runs, the dialed ones and its flags, band by band", () => {
    const history = [
      aRun({ verdict: 0, worn: [wore("zip", "tops")] }),
      aRun({ verdict: 0, worn: [wore("zip", "tops", "too_much")] }),
      aRun({ verdict: -1, worn: [wore("zip", "tops", "not_enough")] }),
      aRun({ verdict: 1, worn: [wore("zip", "tops", "too_much")] }),
      aRun({ verdict: 2, worn: [wore("zip", "tops")] }),
    ];

    expect(pieceCounts(history)).toStrictEqual(
      new Map([
        [
          "zip",
          [
            {
              bandFloorC: 5,
              worn: 5,
              dialed: 2,
              flags: { too_much: 2, not_enough: 1 },
            },
          ],
        ],
      ]),
    );
  });

  it("keeps each piece of a run apart", () => {
    const history = [
      aRun({
        verdict: 0,
        worn: [wore("zip", "tops"), wore("shorts", "bottoms", "not_enough")],
      }),
      aRun({ verdict: -2, worn: [wore("shorts", "bottoms")] }),
    ];

    expect(pieceCounts(history)).toStrictEqual(
      new Map([
        [
          "zip",
          [
            {
              bandFloorC: 5,
              worn: 1,
              dialed: 1,
              flags: { too_much: 0, not_enough: 0 },
            },
          ],
        ],
        [
          "shorts",
          [
            {
              bandFloorC: 5,
              worn: 2,
              dialed: 1,
              flags: { too_much: 0, not_enough: 1 },
            },
          ],
        ],
      ]),
    );
  });

  it("lists a piece's bands coldest first, whatever order the runs came in", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 22, verdict: 1, worn: [wore("zip", "tops")] }),
      aRun({ judgedFeelsLikeC: 12, verdict: 0, worn: [wore("zip", "tops")] }),
      aRun({ judgedFeelsLikeC: 16, verdict: 0, worn: [wore("zip", "tops")] }),
      aRun({ judgedFeelsLikeC: 13, verdict: -1, worn: [wore("zip", "tops")] }),
    ];
    const none = { too_much: 0, not_enough: 0 };

    expect(pieceCounts(history).get("zip")).toStrictEqual([
      { bandFloorC: 10, worn: 2, dialed: 1, flags: none },
      { bandFloorC: 15, worn: 1, dialed: 1, flags: none },
      { bandFloorC: 20, worn: 1, dialed: 0, flags: none },
    ]);
  });

  it("has no entry for a piece never worn", () => {
    expect(pieceCounts([aRun()])).toStrictEqual(new Map());
  });

  it("adds up over its bands, a flag of either kind counting once", () => {
    expect(
      pieceRecord([
        {
          bandFloorC: 5,
          worn: 4,
          dialed: 3,
          flags: { too_much: 1, not_enough: 0 },
        },
        {
          bandFloorC: 10,
          worn: 7,
          dialed: 2,
          flags: { too_much: 2, not_enough: 4 },
        },
      ]),
    ).toStrictEqual({ worn: 11, dialed: 5, flagged: 7 });
  });

  it("is empty for a piece with no bands", () => {
    expect(pieceRecord([])).toStrictEqual({ worn: 0, dialed: 0, flagged: 0 });
  });
});

describe("a group's record", () => {
  it("splits the runs by whether a piece of the group was worn", () => {
    const history = [
      aRun({ verdict: 0, worn: [wore("shell", "outer")] }),
      aRun({ verdict: 0, worn: [wore("shell", "outer")] }),
      aRun({ verdict: -1, worn: [wore("shell", "outer")] }),
      aRun({ verdict: 0, worn: [wore("zip", "tops")] }),
      aRun({ verdict: 1, worn: [wore("zip", "tops")] }),
      aRun({ verdict: 2 }),
      aRun({ verdict: -2 }),
    ];

    expect(groupRecord(history, "outer")).toStrictEqual({
      withRuns: 3,
      withDialed: 2,
      withoutRuns: 4,
      withoutDialed: 1,
    });
  });

  it("does not call a dialed run dialed for a piece flagged too much", () => {
    const history = [
      aRun({ verdict: 0, worn: [wore("gloves", "hands_head", "too_much")] }),
      aRun({ verdict: 0, worn: [wore("gloves", "hands_head")] }),
    ];

    expect(groupRecord(history, "hands_head")).toStrictEqual({
      withRuns: 2,
      withDialed: 1,
      withoutRuns: 0,
      withoutDialed: 0,
    });
  });

  it("takes one too-much flag among the group's pieces as enough", () => {
    const history = [
      aRun({
        verdict: 0,
        worn: [
          wore("cap", "hands_head"),
          wore("gloves", "hands_head", "too_much"),
        ],
      }),
    ];

    expect(groupRecord(history, "hands_head").withDialed).toBe(0);
  });

  it("still calls a dialed run dialed for a piece flagged not enough", () => {
    const history = [
      aRun({ verdict: 0, worn: [wore("gloves", "hands_head", "not_enough")] }),
    ];

    expect(groupRecord(history, "hands_head").withDialed).toBe(1);
  });

  it("ignores a too-much flag on another group's piece", () => {
    const history = [
      aRun({
        verdict: 0,
        worn: [
          wore("gloves", "hands_head"),
          wore("shell", "outer", "too_much"),
        ],
      }),
    ];

    expect(groupRecord(history, "hands_head").withDialed).toBe(1);
  });

  it("never calls a run that was not dialed dialed", () => {
    const history = [
      aRun({ verdict: 1, worn: [wore("gloves", "hands_head")] }),
      aRun({ verdict: -1 }),
    ];

    expect(groupRecord(history, "hands_head")).toStrictEqual({
      withRuns: 1,
      withDialed: 0,
      withoutRuns: 1,
      withoutDialed: 0,
    });
  });
});
