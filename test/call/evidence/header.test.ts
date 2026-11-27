import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD } from "../../../src/lib/contracts/profile";
import { callHeader } from "../../../src/modules/call/evidence/header";
import { piece, result } from "./fixtures";

const zoneShare = {
  kind: "cohort-share",
  group: "tops",
  rung: "zone",
  bandFloorC: 25,
  groupRunners: 9,
  bandRunners: 10,
} as const;

describe("callHeader", () => {
  it("counts the verdicts still to log below the threshold", () => {
    const below = result({ confidence: "below-threshold" });
    expect(CALL_VERDICT_THRESHOLD).toBe(15);
    expect(callHeader(below, "f", 0)).toEqual({
      kind: "count",
      title: "UNTIL YOUR FIRST CALL",
      remaining: 15,
      noun: "more verdicts",
    });
    expect(callHeader(below, "f", 8)).toMatchObject({
      remaining: 7,
      noun: "more verdicts",
    });
    expect(callHeader(below, "f", 13)).toMatchObject({
      remaining: 2,
      noun: "more verdicts",
    });
    expect(callHeader(below, "f", 14)).toMatchObject({
      remaining: 1,
      noun: "more verdict",
    });
    expect(callHeader(below, "f", 15)).toMatchObject({
      remaining: 0,
      noun: "more verdicts",
    });
    expect(callHeader(below, "f", 16)).toMatchObject({ remaining: 0 });
  });

  it("is sure when confident", () => {
    expect(callHeader(result({ personalRunsInBand: 11 }), "f", 31)).toEqual({
      kind: "call",
      title: {
        shown: "CONFIDENT · [11 RUNS] IN BAND",
        said: "Confident, 11 runs in band",
      },
      verb: "WEAR THIS",
    });
    expect(
      callHeader(result({ personalRunsInBand: 1 }), "f", 31),
    ).toMatchObject({ title: { shown: "CONFIDENT · [1 RUN] IN BAND" } });
  });

  it("hedges when probable", () => {
    expect(
      callHeader(
        result({ confidence: "probable", personalRunsInBand: 3 }),
        "c",
        20,
      ),
    ).toEqual({
      kind: "call",
      title: {
        shown: "PROBABLE · [3 RUNS] IN BAND",
        said: "Probable, 3 runs in band",
      },
      verb: "PROBABLY WEAR",
    });
  });

  it("says a best guess leans on the closet and the climate", () => {
    expect(callHeader(result({ confidence: "best-guess" }), "f", 16)).toEqual({
      kind: "call",
      title: { shown: "BEST GUESS", said: "BEST GUESS" },
      body: {
        shown:
          "I don't know you yet. This comes from your closet and your climate.",
        said: "I don't know you yet. This comes from your closet and your climate.",
      },
      verb: "PROBABLY WEAR",
    });
  });

  it("names a borrowed call's band and source", () => {
    const borrowed = result({
      confidence: "borrowed",
      bandFloorC: 25,
      personalRunsInBand: 0,
      kit: [piece("singlet", "tops", [zoneShare])],
    });
    expect(callHeader(borrowed, "f", 31)).toEqual({
      kind: "call",
      title: { shown: "BORROWED CALL", said: "BORROWED CALL" },
      body: {
        shown:
          "You've logged 0 runs in 77–86°. This comes from runners in your climate, not from you.",
        said: "You've logged 0 runs in 77 to 86 degrees. This comes from runners in your climate, not from you.",
      },
      verb: "PROBABLY WEAR",
    });
    expect(callHeader(borrowed, "c", 31)).toMatchObject({
      body: {
        shown:
          "You've logged 0 runs in 25–30°. This comes from runners in your climate, not from you.",
      },
    });
  });

  it("finds a zone share among a piece's other facts", () => {
    const estimate = {
      kind: "estimate",
      pieceId: "singlet",
      range: { lowC: 20 },
    } as const;
    const borrowed = result({
      confidence: "borrowed",
      bandFloorC: 25,
      personalRunsInBand: 0,
      kit: [piece("singlet", "tops", [estimate, zoneShare])],
    });
    expect(callHeader(borrowed, "c", 31)).toMatchObject({
      body: {
        shown:
          "You've logged 0 runs in 25–30°. This comes from runners in your climate, not from you.",
      },
    });
  });

  it("borrows from other runners when no share is from a zone", () => {
    const own = {
      kind: "personal-piece",
      pieceId: "cap",
      bandFloorC: 25,
      dialed: 1,
      of: 1,
    } as const;
    const borrowed = result({
      confidence: "borrowed",
      bandFloorC: 25,
      personalRunsInBand: 0,
      kit: [
        piece("cap", "hands_head", [own]),
        piece("singlet", "tops", [{ ...zoneShare, rung: "everyone" }]),
      ],
    });
    expect(callHeader(borrowed, "c", 31)).toMatchObject({
      body: {
        shown:
          "You've logged 0 runs in 25–30°. This comes from other runners, not from you.",
      },
    });
    expect(
      callHeader(
        { ...borrowed, kit: [piece("singlet", "tops", [zoneShare])] },
        "c",
        31,
      ),
    ).toMatchObject({
      body: {
        shown:
          "You've logged 0 runs in 25–30°. This comes from runners in your climate, not from you.",
      },
    });
  });

  it("names only the source of a borrowed call with no forecast", () => {
    const borrowed = result({
      confidence: "borrowed",
      bandFloorC: undefined,
      personalRunsInBand: 0,
    });
    expect(callHeader(borrowed, "f", 31)).toMatchObject({
      body: {
        shown: "This comes from other runners, not from you.",
        said: "This comes from other runners, not from you.",
      },
    });
  });
});
