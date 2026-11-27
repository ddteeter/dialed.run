import { describe, expect, it } from "vitest";

import {
  factLine,
  percentOf,
  pieceEvidenceLine,
  runsWord,
  timesWord,
} from "../../../src/modules/call/evidence/lines";
import { MIN_RUNNERS } from "../../../src/modules/feed/consensus/consensus";
import { piece } from "./fixtures";

describe("counts", () => {
  it("says once, twice, then a number of times", () => {
    expect(timesWord(1)).toBe("once");
    expect(timesWord(2)).toBe("twice");
    expect(timesWord(3)).toBe("3 times");
    expect(timesWord(0)).toBe("0 times");
  });

  it("says 1 run, then runs", () => {
    expect(runsWord(0)).toBe("0 runs");
    expect(runsWord(1)).toBe("1 run");
    expect(runsWord(2)).toBe("2 runs");
    expect(runsWord(11)).toBe("11 runs");
  });

  it("rounds a share half up, to a whole percent", () => {
    expect(percentOf(5, 8)).toBe(63);
    expect(percentOf(1, 8)).toBe(13);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(91, 100)).toBe(91);
    expect(percentOf(5, 5)).toBe(100);
  });
});

describe("factLine, one per kind and unit", () => {
  it("draws a piece's own record as the board does", () => {
    const fact = {
      kind: "personal-piece",
      pieceId: "p1",
      bandFloorC: 5,
      dialed: 8,
      of: 9,
    } as const;
    expect(factLine(fact, "f")).toEqual({
      shown: "DIALED [8 OF 9] · [41–50°]",
      said: "Dialed 8 of 9, 41 to 50 degrees",
    });
    expect(factLine(fact, "c")).toEqual({
      shown: "DIALED [8 OF 9] · [5–10°]",
      said: "Dialed 8 of 9, 5 to 10 degrees",
    });
  });

  it("draws each flag with its count", () => {
    expect(
      factLine(
        {
          kind: "personal-flag",
          pieceId: "p1",
          bandFloorC: -5,
          flag: "too_much",
          times: 2,
        },
        "f",
      ),
    ).toEqual({
      shown: "TOO MUCH [TWICE] · [23–32°]",
      said: "Too much twice, 23 to 32 degrees",
    });
    expect(
      factLine(
        {
          kind: "personal-flag",
          pieceId: "p1",
          bandFloorC: -5,
          flag: "not_enough",
          times: 3,
        },
        "c",
      ),
    ).toEqual({
      shown: "NOT ENOUGH [3 TIMES] · [-5–0°]",
      said: "Not enough 3 times, minus 5 to 0 degrees",
    });
    expect(
      factLine(
        {
          kind: "personal-flag",
          pieceId: "p1",
          bandFloorC: 15,
          flag: "too_much",
          times: 1,
        },
        "c",
      )?.said,
    ).toBe("Too much once, 15 to 20 degrees");
  });

  it("counts every run in the band, whatever its verdict", () => {
    const fact = {
      kind: "personal-band",
      bandFloorC: 15,
      cold: 2,
      dialed: 7,
      warm: 3,
    } as const;
    expect(factLine(fact, "f")).toEqual({
      shown: "[12 RUNS] IN [59–68°]",
      said: "12 runs in 59 to 68 degrees",
    });
    expect(factLine(fact, "c")).toEqual({
      shown: "[12 RUNS] IN [15–20°]",
      said: "12 runs in 15 to 20 degrees",
    });
    expect(factLine({ ...fact, cold: 0, dialed: 1, warm: 0 }, "c")?.shown).toBe(
      "[1 RUN] IN [15–20°]",
    );
  });

  it("names a cohort share's rung", () => {
    const share = {
      kind: "cohort-share",
      group: "tops",
      bandFloorC: 25,
      groupRunners: 91,
      bandRunners: 100,
    } as const;
    expect(factLine({ ...share, rung: "zone-and-thermal" }, "f")).toEqual({
      shown: "CLIMATE COHORT · [91%] AT [77–86°]",
      said: "Climate cohort, 91 percent at 77 to 86 degrees",
    });
    expect(factLine({ ...share, rung: "zone" }, "c")).toEqual({
      shown: "CLIMATE COHORT · [91%] AT [25–30°]",
      said: "Climate cohort, 91 percent at 25 to 30 degrees",
    });
    expect(factLine({ ...share, rung: "everyone" }, "f")).toEqual({
      shown: "ALL RUNNERS · [91%] AT [77–86°]",
      said: "All runners, 91 percent at 77 to 86 degrees",
    });
  });

  it("shows no share below the feed's runner floor", () => {
    const share = {
      kind: "cohort-share",
      group: "tops",
      rung: "zone",
      bandFloorC: 5,
      groupRunners: 4,
    } as const;
    expect(MIN_RUNNERS).toBe(5);
    expect(factLine({ ...share, bandRunners: MIN_RUNNERS }, "c")?.shown).toBe(
      "CLIMATE COHORT · [80%] AT [5–10°]",
    );
    expect(
      factLine({ ...share, bandRunners: MIN_RUNNERS - 1 }, "c"),
    ).toBeUndefined();
    expect(
      factLine({ ...share, bandRunners: MIN_RUNNERS + 1 }, "c")?.shown,
    ).toBe("CLIMATE COHORT · [67%] AT [5–10°]");
  });

  it("draws an estimate as the closet's works-at range", () => {
    const estimate = { kind: "estimate", pieceId: "p1" } as const;
    expect(factLine({ ...estimate, range: { lowC: 3 } }, "f")).toEqual({
      shown: "WORKS AT [37°+]",
      said: "Works at 37 degrees and up",
    });
    expect(
      factLine({ ...estimate, range: { lowC: 4, highC: 14 } }, "c"),
    ).toEqual({
      shown: "WORKS AT [4–14°]",
      said: "Works at 4 to 14 degrees",
    });
    expect(factLine({ ...estimate, range: {} }, "c")).toBeUndefined();
  });
});

describe("pieceEvidenceLine", () => {
  const own = {
    kind: "personal-piece",
    pieceId: "zip",
    bandFloorC: 5,
    dialed: 8,
    of: 9,
  } as const;
  const flag = {
    kind: "personal-flag",
    pieceId: "zip",
    bandFloorC: 5,
    flag: "not_enough",
    times: 2,
  } as const;
  const band = {
    kind: "personal-band",
    bandFloorC: 5,
    cold: 1,
    dialed: 1,
    warm: 1,
  } as const;
  const share = {
    kind: "cohort-share",
    group: "tops",
    rung: "everyone",
    bandFloorC: 5,
    groupRunners: 6,
    bandRunners: 8,
  } as const;
  const estimate = {
    kind: "estimate",
    pieceId: "zip",
    range: { lowC: 3 },
  } as const;

  it("picks personal before cohort before estimate, whatever the order", () => {
    const facts = [estimate, share, band, flag, own];
    expect(pieceEvidenceLine(piece("zip", "tops", facts), "c").shown).toBe(
      "DIALED [8 OF 9] · [5–10°]",
    );
    expect(
      pieceEvidenceLine(
        piece("zip", "tops", [estimate, share, band, flag]),
        "c",
      ).shown,
    ).toBe("NOT ENOUGH [TWICE] · [5–10°]");
    expect(
      pieceEvidenceLine(piece("zip", "tops", [estimate, share, band]), "c")
        .shown,
    ).toBe("[3 RUNS] IN [5–10°]");
    expect(
      pieceEvidenceLine(piece("zip", "tops", [estimate, share]), "c").shown,
    ).toBe("ALL RUNNERS · [75%] AT [5–10°]");
    expect(pieceEvidenceLine(piece("zip", "tops", [estimate]), "c")).toEqual({
      shown: "WORKS AT [3°+]",
      said: "Works at 3 degrees and up",
    });
  });

  it("keeps the scorer's order within one kind", () => {
    const second = { ...own, dialed: 2, of: 4 };
    expect(
      pieceEvidenceLine(piece("zip", "tops", [estimate, second, own]), "c")
        .shown,
    ).toBe("DIALED [2 OF 4] · [5–10°]");
  });

  it("falls past a fact that shows nothing", () => {
    const thin = { ...share, bandRunners: 4, groupRunners: 4 };
    expect(
      pieceEvidenceLine(piece("zip", "tops", [thin, estimate]), "c").shown,
    ).toBe("WORKS AT [3°+]");
  });

  it("ignores facts about another piece or another group", () => {
    const facts = [
      { ...own, pieceId: "vest" },
      { ...flag, pieceId: "vest" },
      { ...share, group: "outer" },
      { ...estimate, pieceId: "vest" },
    ] as const;
    expect(pieceEvidenceLine(piece("zip", "tops", facts), "f")).toEqual({
      shown: "NO VERDICTS YET",
      said: "No verdicts yet",
    });
    expect(
      pieceEvidenceLine(piece("zip", "tops", [...facts, share]), "c").shown,
    ).toBe("ALL RUNNERS · [75%] AT [5–10°]");
  });

  it("says no verdicts yet for a piece with nothing counted", () => {
    expect(pieceEvidenceLine(piece("zip", "tops"), "c")).toEqual({
      shown: "NO VERDICTS YET",
      said: "No verdicts yet",
    });
  });
});
