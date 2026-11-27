import { describe, expect, it } from "vitest";

import { b2View } from "../../../src/modules/call/evidence";
import { names, piece, result } from "./fixtures";

const runner = names({
  zip: "Blue L/S Half-Zip",
  shorts: "Black 5in Split Shorts",
  tee: "Grey tee",
  ls: "Old long-sleeve",
  vest: "vest",
  gloves: "gloves",
});

const zip = piece("zip", "tops", [
  { kind: "personal-band", bandFloorC: 5, cold: 2, dialed: 8, warm: 1 },
  { kind: "personal-piece", pieceId: "zip", bandFloorC: 5, dialed: 8, of: 9 },
]);
const shorts = piece("shorts", "bottoms", [
  { kind: "estimate", pieceId: "shorts", range: { lowC: 3 } },
]);
const gloves = piece("gloves", "hands_head", [
  {
    kind: "personal-flag",
    pieceId: "gloves",
    bandFloorC: 5,
    flag: "too_much",
    times: 1,
  },
]);

describe("b2View", () => {
  it("builds B2 from a confident result", () => {
    const call = result({
      kit: [zip, shorts],
      ranking: [
        zip,
        piece("vest", "outer"),
        piece("tee", "tops"),
        shorts,
        piece("ls", "tops"),
        gloves,
      ],
    });
    expect(b2View(call, { unit: "f", names: runner })).toEqual({
      header: {
        kind: "call",
        title: {
          shown: "CONFIDENT · [11 RUNS] IN BAND",
          said: "Confident, 11 runs in band",
        },
        verb: "WEAR THIS",
      },
      pieces: [
        {
          pieceId: "zip",
          name: "Blue L/S Half-Zip",
          line: {
            shown: "DIALED [8 OF 9] · [41–50°]",
            said: "Dialed 8 of 9, 41 to 50 degrees",
          },
        },
        {
          pieceId: "shorts",
          name: "Black 5in Split Shorts",
          line: {
            shown: "WORKS AT [37°+]",
            said: "Works at 37 degrees and up",
          },
        },
      ],
      paragraph:
        "You've been too cold twice in this band. Skip the gloves — too much once in this band.",
      whyNot: ["vest", "tee", "gloves"],
    });
  });

  it("hands the warm runs' kit to the paragraph", () => {
    const tee = piece("tee", "tops", [
      { kind: "personal-band", bandFloorC: 5, cold: 0, dialed: 4, warm: 2 },
      { kind: "estimate", pieceId: "tee", range: { lowC: 15 } },
    ]);
    const warmRuns = {
      bandFloorC: 5,
      worn: [
        { pieceId: "ls", group: "tops" },
        { pieceId: "vest", group: "outer" },
      ],
    } as const;
    const options = { unit: "c", names: runner } as const;
    const view = b2View(
      result({ kit: [tee], ranking: [tee], warmRuns }),
      options,
    );
    expect(view.paragraph).toBe("You've been too warm twice in this band.");
    expect(
      b2View(result({ kit: [tee], ranking: [tee] }), options).paragraph,
    ).toBeUndefined();
  });

  it("offers no why-not for a piece with no answer", () => {
    const call = result({
      kit: [zip],
      ranking: [zip, piece("anon", "tops"), piece("ls", "tops")],
    });
    expect(b2View(call, { unit: "c", names: runner }).whyNot).toEqual([]);
  });

  it("leaves a piece's name out when the lookup lacks it", () => {
    const call = result({ kit: [piece("anon", "tops")] });
    expect(b2View(call, { unit: "c", names: runner }).pieces).toEqual([
      {
        pieceId: "anon",
        name: undefined,
        line: { shown: "NO VERDICTS YET", said: "No verdicts yet" },
      },
    ]);
  });

  it("counts down below the threshold, in the reader's unit", () => {
    const view = b2View(
      result({ confidence: "below-threshold", verdictsSoFar: 8 }),
      { unit: "c", names: runner },
    );
    expect(view).toEqual({
      header: {
        kind: "count",
        title: "UNTIL YOUR FIRST CALL",
        remaining: 7,
        noun: "more verdicts",
      },
      pieces: [],
      paragraph: undefined,
      whyNot: [],
    });
  });
});
