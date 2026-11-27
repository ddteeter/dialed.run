/**
 * What the screen derives beside the view model: the drawn line, C0a's
 * header, the why-nots in group order, and the count's reading.
 */
import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD } from "../../../src/lib/contracts";
import { b2View } from "../../../src/modules/call/evidence";
import {
  countedLine,
  drawn,
  PART_MARK,
  screenFacts,
  verdictsCounted,
} from "../../../src/modules/call/screen/facts";
import {
  allRunsWords,
  countedWords,
  moreWords,
  SCREEN_WORDS,
} from "../../../src/modules/call/screen/words";
import { names } from "../evidence/fixtures";
import {
  belowThresholdCall,
  borrowedCall,
  drawnFrom,
  NAMES,
  noForecastCall,
  probableCall,
} from "./fixtures";

describe("a drawn line", () => {
  it("drops the engine's slot brackets and comes back in the parts between its marks", () => {
    expect(drawn("DIALED [8 OF 9] · [32–41°]")).toStrictEqual([
      "DIALED 8 OF 9",
      "32–41°",
    ]);
  });

  it("is one part when the line has no mark", () => {
    expect(drawn("NO VERDICTS YET")).toStrictEqual(["NO VERDICTS YET"]);
  });

  it("drops every bracket, not the first of each", () => {
    expect(drawn("[4 RUNS] IN [32–41°]")).toStrictEqual(["4 RUNS IN 32–41°"]);
  });

  it("splits at the mark the evidence lines are typed with", () => {
    expect(PART_MARK).toBe(" · ");
    const { view } = drawnFrom(probableCall());

    expect(view.pieces.map((piece) => drawn(piece.line.shown))).toStrictEqual([
      ["DIALED 8 OF 9", "32–41°"],
      ["TOO MUCH ONCE", "32–41°"],
      ["CLIMATE COHORT", "78% AT 32–41°"],
      ["NO VERDICTS YET"],
    ]);
  });
});

describe("the screen's facts", () => {
  it("has no all-runs header for a Call with a forecast", () => {
    expect(drawnFrom(probableCall()).facts.noForecast).toBeUndefined();
    expect(drawnFrom(borrowedCall()).facts.noForecast).toBeUndefined();
  });

  it("heads a Call with no forecast by all the runner's runs, with no IN BAND", () => {
    expect(drawnFrom(noForecastCall()).facts.noForecast).toStrictEqual({
      shown: "PROBABLE · 23 RUNS",
      said: "Probable, 23 runs",
    });
  });

  it("answers each why-not the view offers, in the closet's group order", () => {
    const { view, facts } = drawnFrom(probableCall());

    // The view lists them best first, which here is the reverse.
    expect(view.whyNot).toStrictEqual([
      "racers",
      "gloves",
      "vest",
      "shorts",
      "tee",
    ]);
    expect(facts.whyNots).toStrictEqual([
      {
        pieceId: "tee",
        question: "Why not the tee?",
        answer:
          "The Merino half-zip is dialed 8 of 9 in this band. The tee has no verdicts here yet.",
      },
      {
        pieceId: "shorts",
        question: "Why not the shorts?",
        answer: "The Winter tights ranked higher for this hour.",
      },
      {
        pieceId: "vest",
        question: "Why not the vest?",
        answer: "Nothing in your verdicts says you need the vest at this hour.",
      },
      {
        pieceId: "gloves",
        question: "Why not the gloves?",
        answer: "You told us the gloves was too much twice in this band.",
      },
      {
        pieceId: "racers",
        question: "Why not the racers?",
        answer:
          "Nothing in your verdicts says you need the racers at this hour.",
      },
    ]);
  });

  it("offers only what the view offers, not every piece the ranking left out", () => {
    const call = probableCall();
    const view = {
      ...b2View(call, { unit: "f", names: NAMES }),
      whyNot: ["vest"],
    };

    expect(
      screenFacts(call, view, NAMES).whyNots.map((row) => row.pieceId),
    ).toStrictEqual(["vest"]);
  });

  it("leaves out a why-not it has no name to ask with", () => {
    const call = probableCall();
    const view = b2View(call, { unit: "f", names: NAMES });
    const withoutTheVest = names({
      zip: "Merino half-zip",
      tights: "Winter tights",
      tee: "tee",
      shorts: "shorts",
    });

    expect(
      screenFacts(call, view, withoutTheVest).whyNots.map((row) => row.pieceId),
    ).toStrictEqual(["tee", "shorts"]);
  });

  it("has no why-not for a view that offers none", () => {
    const call = probableCall({ ranking: probableCall().kit });

    expect(drawnFrom(call).facts.whyNots).toStrictEqual([]);
  });
});

describe("the count below the threshold", () => {
  it("is the threshold less what remains", () => {
    const { view } = drawnFrom(belowThresholdCall(8));
    if (view.header.kind !== "count") throw new Error("not a count");

    expect(view.header.remaining).toBe(7);
    expect(verdictsCounted(view.header)).toBe(8);
  });

  it("reads as Round 62's 362 words it, against the contract's threshold", () => {
    expect(CALL_VERDICT_THRESHOLD).toBe(15);
    expect(countedLine(0)).toBe("0 of 15 verdicts counted");
    expect(countedLine(8)).toBe("8 of 15 verdicts counted");
  });
});

describe("the screen's words", () => {
  it("are Round 62's, typed in sentence case for the captions", () => {
    expect(SCREEN_WORDS).toStrictEqual({
      noForecast: "No forecast for this hour",
      noForecastBody:
        "This Call comes from all your runs, not this hour's weather.",
      whyNot: "Why not",
      noneCounted:
        "Verdicts count on runs with conditions. Yours so far have none.",
    });
  });

  it("fill their counts", () => {
    expect(allRunsWords(15)).toStrictEqual({
      shown: "PROBABLE · 15 RUNS",
      said: "Probable, 15 runs",
    });
    expect(moreWords(2)).toBe("2 more");
    expect(countedWords(3, 15)).toBe("3 of 15 verdicts counted");
  });
});
