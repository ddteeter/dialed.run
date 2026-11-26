import { describe, expect, it } from "vitest";

import {
  evidenceFor,
  type PieceFacts,
} from "../../../src/modules/call/scorer/facts";
import { aCell } from "./builders";

const NOTHING: PieceFacts = {
  pieceId: "zip",
  scope: undefined,
  band: { cold: 0, dialed: 0, warm: 0 },
  counts: [],
  cell: undefined,
  estimate: undefined,
};

describe("the counted facts behind a piece", () => {
  it("are none when nothing was counted and the Call has no band", () => {
    expect(evidenceFor(NOTHING)).toStrictEqual([]);
  });

  it("carry the band's verdicts whenever the Call has a band, zeros included", () => {
    expect(
      evidenceFor({ ...NOTHING, scope: { bandFloorC: 5, precip: "damp" } }),
    ).toStrictEqual([
      { kind: "personal-band", bandFloorC: 5, cold: 0, dialed: 0, warm: 0 },
    ]);
    expect(
      evidenceFor({
        ...NOTHING,
        scope: { bandFloorC: -5, precip: "dry" },
        band: { cold: 2, dialed: 7, warm: 1 },
      }),
    ).toStrictEqual([
      { kind: "personal-band", bandFloorC: -5, cold: 2, dialed: 7, warm: 1 },
    ]);
  });

  it("carry the piece's record once for each band it was worn in", () => {
    const none = { too_much: 0, not_enough: 0 };

    expect(
      evidenceFor({
        ...NOTHING,
        counts: [
          { bandFloorC: 0, worn: 3, dialed: 1, flags: none },
          { bandFloorC: 5, worn: 9, dialed: 8, flags: none },
        ],
      }),
    ).toStrictEqual([
      {
        kind: "personal-piece",
        pieceId: "zip",
        bandFloorC: 0,
        dialed: 1,
        of: 3,
      },
      {
        kind: "personal-piece",
        pieceId: "zip",
        bandFloorC: 5,
        dialed: 8,
        of: 9,
      },
    ]);
  });

  it("carry a flag only when it was given, too much before not enough", () => {
    expect(
      evidenceFor({
        ...NOTHING,
        counts: [
          {
            bandFloorC: 0,
            worn: 3,
            dialed: 1,
            flags: { too_much: 0, not_enough: 2 },
          },
          {
            bandFloorC: 5,
            worn: 9,
            dialed: 8,
            flags: { too_much: 1, not_enough: 3 },
          },
        ],
      }).filter((fact) => fact.kind === "personal-flag"),
    ).toStrictEqual([
      {
        kind: "personal-flag",
        pieceId: "zip",
        bandFloorC: 0,
        flag: "not_enough",
        times: 2,
      },
      {
        kind: "personal-flag",
        pieceId: "zip",
        bandFloorC: 5,
        flag: "too_much",
        times: 1,
      },
      {
        kind: "personal-flag",
        pieceId: "zip",
        bandFloorC: 5,
        flag: "not_enough",
        times: 3,
      },
    ]);
  });

  it("carry the cohort's share and name the rung and zone it came from", () => {
    const cell = aCell({
      rung: "zone",
      climateZone: "denver",
      bandFloorC: 25,
      group: "hands_head",
      bandRunners: 43,
      groupRunners: 39,
    });

    expect(evidenceFor({ ...NOTHING, cell })).toStrictEqual([
      {
        kind: "cohort-share",
        group: "hands_head",
        rung: "zone",
        climateZone: "denver",
        bandFloorC: 25,
        groupRunners: 39,
        bandRunners: 43,
      },
    ]);
  });

  it("carry the estimate the prior read", () => {
    expect(
      evidenceFor({
        ...NOTHING,
        estimate: { range: { lowC: 4, highC: 12 }, feelC: 7 },
      }),
    ).toStrictEqual([
      { kind: "estimate", pieceId: "zip", range: { lowC: 4, highC: 12 } },
    ]);
  });

  it("come in a fixed order: band, record, flags, cohort, estimate", () => {
    const facts = evidenceFor({
      pieceId: "zip",
      scope: { bandFloorC: 5, precip: "dry" },
      band: { cold: 1, dialed: 2, warm: 0 },
      counts: [
        {
          bandFloorC: 5,
          worn: 3,
          dialed: 2,
          flags: { too_much: 1, not_enough: 0 },
        },
      ],
      cell: aCell(),
      estimate: { range: { lowC: 4 }, feelC: 7 },
    });

    expect(facts.map((fact) => fact.kind)).toStrictEqual([
      "personal-band",
      "personal-piece",
      "personal-flag",
      "cohort-share",
      "estimate",
    ]);
  });
});
