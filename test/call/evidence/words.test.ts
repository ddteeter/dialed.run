import { describe, expect, it } from "vitest";

import type { EvidenceFact } from "../../../src/modules/call/contract";
import { factLine } from "../../../src/modules/call/evidence/lines";
import { fill } from "../../../src/modules/call/evidence/words";
import { words } from "../../../src/modules/call/evidence/words-data";

const keysBy = (origin: string): string[] =>
  Object.entries(words)
    .filter(([, word]) => word.origin === origin)
    .map(([key]) => key);

describe("words", () => {
  it("lists the guesses, so adding one is a visible change", () => {
    expect(keysBy("guess")).toEqual([
      "once",
      "times",
      "runOne",
      "flagTooMuch",
      "flagNotEnough",
      "bandRuns",
      "cohortClimate",
      "cohortEveryone",
      "worksAt",
      "skipPiece",
      "probable",
      "borrowedInBand",
      "borrowedNoBand",
      "sourceOthers",
      "bestGuessBody",
      "moreVerdictOne",
      "answerFlagged",
      "answerLeftOut",
      "answerRanked",
      "answerDialedOnly",
      "answerDialedBoth",
    ]);
  });

  it("lists the board's copy", () => {
    expect(keysBy("board")).toEqual([
      "twice",
      "runMany",
      "pieceDialed",
      "noVerdicts",
      "coldRuns",
      "confident",
      "borrowed",
      "sourceClimate",
      "bestGuess",
      "untilFirstCall",
      "moreVerdictMany",
      "wearThis",
      "probablyWear",
      "whyNotQuestion",
    ]);
  });

  it("gives every drawn line a spoken form with no brackets", () => {
    const said = keysBy("said");
    expect(said).toEqual([
      "pieceDialedSaid",
      "flagTooMuchSaid",
      "flagNotEnoughSaid",
      "bandRunsSaid",
      "cohortClimateSaid",
      "cohortEveryoneSaid",
      "worksAtSaid",
      "noVerdictsSaid",
      "confidentSaid",
      "probableSaid",
    ]);
    for (const key of said) {
      const text = words[key as keyof typeof words].text;
      expect(text).not.toMatch(/[[\]]/);
    }
  });

  it("brackets every measured shown form and no said one", () => {
    const facts: readonly EvidenceFact[] = [
      { kind: "personal-band", bandFloorC: 5, cold: 1, dialed: 2, warm: 3 },
      { kind: "personal-piece", pieceId: "a", bandFloorC: 5, dialed: 1, of: 2 },
      {
        kind: "personal-flag",
        pieceId: "a",
        bandFloorC: 5,
        flag: "too_much",
        times: 2,
      },
      {
        kind: "personal-flag",
        pieceId: "a",
        bandFloorC: 5,
        flag: "not_enough",
        times: 1,
      },
      {
        kind: "cohort-share",
        group: "tops",
        rung: "zone",
        bandFloorC: 5,
        groupRunners: 5,
        bandRunners: 6,
      },
      {
        kind: "cohort-share",
        group: "tops",
        rung: "everyone",
        bandFloorC: 5,
        groupRunners: 5,
        bandRunners: 6,
      },
      { kind: "estimate", pieceId: "a", range: { highC: 9 } },
    ];
    for (const unit of ["f", "c"] as const) {
      for (const fact of facts) {
        const line = factLine(fact, unit);
        expect(line?.shown).toContain("[");
        expect(line?.shown).toContain("]");
        expect(line?.said).not.toMatch(/[[\]]/);
      }
    }
  });

  it("fills every slot, however often it appears", () => {
    expect(fill("pieceDialed", { dialed: "8", of: "9", band: "41–50°" })).toBe(
      "DIALED [8 OF 9] · [41–50°]",
    );
    expect(fill("noVerdicts", {})).toBe("NO VERDICTS YET");
  });
});
