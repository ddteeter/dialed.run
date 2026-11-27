import { describe, expect, it } from "vitest";

import type { Confidence } from "../../../src/modules/call/contract";
import {
  measure,
  rate,
  type ReplayOutcome,
} from "../../../src/modules/call/replay";
import { byRank } from "../../../src/modules/call/replay/metrics";
import { outcome, replayCase, result, scored, worn } from "./fixtures";

function agreement(outcomes: ReplayOutcome[]) {
  return measure(outcomes).dialedAgreement;
}

function direction(outcomes: ReplayOutcome[]) {
  return measure(outcomes).direction;
}

describe("rate", () => {
  it("is undefined when nothing was judged, else hits over of", () => {
    expect(rate({ hits: 0, of: 0 })).toBeUndefined();
    expect(rate({ hits: 1, of: 4 })).toBe(0.25);
    expect(rate({ hits: 0, of: 3 })).toBe(0);
  });
});

describe("dialed agreement", () => {
  it("counts the groups worn whose kit piece was the piece worn", () => {
    expect(
      agreement([outcome(["a-tee", "shorts"], 0, ["a-tee", "tights"])]),
    ).toEqual({ hits: 1, of: 2 });
  });

  it("counts a group once, whichever of its worn pieces the kit chose", () => {
    expect(agreement([outcome(["z-base", "m-long"], 0, ["m-long"])])).toEqual({
      hits: 1,
      of: 1,
    });
  });

  it("does not credit a worn piece the kit places in another group", () => {
    const misfiled = {
      replayCase: replayCase(["a-tee", "shorts"], 0),
      result: result([
        { pieceId: "a-tee", group: "outer", score: 1, evidence: [] },
      ]),
    };
    expect(agreement([misfiled])).toEqual({ hits: 0, of: 2 });
    expect(agreement([outcome(["a-tee", "shorts"], 0, ["a-tee"])])).toEqual({
      hits: 1,
      of: 2,
    });
  });

  it("judges only dialed runs, and only Calls that offer a kit", () => {
    expect(
      agreement([
        outcome(["a-tee"], 1, ["a-tee"]),
        outcome(["a-tee"], -1, ["a-tee"]),
        outcome(["a-tee"], 0, ["a-tee"], "below-threshold"),
      ]),
    ).toEqual({ hits: 0, of: 0 });
    expect(agreement([outcome(["a-tee"], 0, ["a-tee"], "best-guess")])).toEqual(
      { hits: 1, of: 1 },
    );
  });

  it("sums over cases", () => {
    expect(
      agreement([
        outcome(["a-tee", "shorts"], 0, ["a-tee", "shorts"]),
        outcome(["m-long"], 0, ["a-tee"]),
      ]),
    ).toEqual({ hits: 2, of: 3 });
  });
});

describe("direction on misses", () => {
  const hit = { hits: 1, of: 1, noCall: 0 };
  const miss = { hits: 0, of: 1, noCall: 0 };
  const noCall = { hits: 0, of: 0, noCall: 1 };

  it("wants a warmer kit after a cold verdict", () => {
    expect(direction([outcome(["a-tee"], -1, ["m-long"])])).toEqual(hit);
    expect(direction([outcome(["a-tee"], -2, ["m-long"])])).toEqual(hit);
    expect(direction([outcome(["m-long"], -1, ["a-tee"])])).toEqual(miss);
  });

  it("wants a cooler kit after a warm verdict", () => {
    expect(direction([outcome(["m-long"], 1, ["a-tee"])])).toEqual(hit);
    expect(direction([outcome(["m-long"], 2, ["a-tee"])])).toEqual(hit);
    expect(direction([outcome(["a-tee"], 1, ["m-long"])])).toEqual(miss);
  });

  it("does not judge a dialed run", () => {
    expect(direction([outcome(["a-tee"], 0, ["m-long"])])).toEqual({
      hits: 0,
      of: 0,
      noCall: 0,
    });
  });

  it("on equal floors, calls the lower ceiling warmer", () => {
    expect(direction([outcome(["jacket"], -1, ["vest"])])).toEqual(hit);
    expect(direction([outcome(["vest"], -1, ["jacket"])])).toEqual(miss);
    expect(direction([outcome(["vest"], 1, ["jacket"])])).toEqual(hit);
  });

  it("reads the floor first, the ceiling only when floors are equal", () => {
    expect(direction([outcome(["shell"], -1, ["softshell"])])).toEqual(hit);
    expect(direction([outcome(["softshell"], 1, ["shell"])])).toEqual(hit);
  });

  it("compares a kit piece only with what was worn in its own group", () => {
    expect(
      direction([outcome(["a-tee", "tights"], -1, ["m-long", "tights"])]),
    ).toEqual(hit);
  });

  it("counts a kept worn piece as no change, even with no estimate", () => {
    expect(direction([outcome(["shoes"], -1, ["shoes"])])).toEqual(miss);
    expect(direction([outcome(["z-base", "m-long"], 1, ["m-long"])])).toEqual(
      miss,
    );
  });

  it("puts an open floor below every floor, and an open ceiling above every ceiling", () => {
    expect(direction([outcome(["jacket"], -1, ["parka"])])).toEqual(hit);
    expect(direction([outcome(["parka"], 1, ["jacket"])])).toEqual(hit);
    expect(direction([outcome(["bivvy"], -1, ["parka"])])).toEqual(hit);
    expect(direction([outcome(["parka"], -1, ["bivvy"])])).toEqual(miss);
    expect(direction([outcome(["a-tee"], -1, ["tank"])])).toEqual(hit);
    expect(direction([outcome(["tank"], 1, ["a-tee"])])).toEqual(hit);
  });

  it("counts two pieces with the same range, or the piece worn, as no change", () => {
    expect(direction([outcome(["shell"], -1, ["anorak"])])).toEqual(miss);
    expect(direction([outcome(["shell"], 1, ["anorak"])])).toEqual(miss);
    expect(direction([outcome(["parka"], -1, ["cape"])])).toEqual(miss);
    expect(direction([outcome(["parka"], 1, ["cape"])])).toEqual(miss);
    expect(direction([outcome(["a-tee"], 1, ["singlet"])])).toEqual(miss);
    expect(direction([outcome(["a-tee"], -1, ["singlet"])])).toEqual(miss);
    expect(direction([outcome(["a-tee"], -1, ["a-tee"])])).toEqual(miss);
  });

  it("calls an added layer warmer and a dropped one cooler", () => {
    expect(direction([outcome(["a-tee"], -1, ["a-tee", "shell"])])).toEqual(
      hit,
    );
    expect(direction([outcome(["a-tee"], 1, ["a-tee", "shell"])])).toEqual(
      miss,
    );
    expect(direction([outcome(["a-tee", "shell"], 1, ["a-tee"])])).toEqual(hit);
    expect(direction([outcome(["a-tee", "shell"], -1, ["a-tee"])])).toEqual(
      miss,
    );
    expect(direction([outcome([], -1, ["shell"])])).toEqual(hit);
  });

  it("calls a kit warmer in one group and cooler in another a miss", () => {
    expect(direction([outcome(["m-long", "shell"], -1, ["z-base"])])).toEqual(
      miss,
    );
    expect(direction([outcome(["m-long", "shell"], 1, ["z-base"])])).toEqual(
      miss,
    );
  });

  it("is warmer when every other group is unchanged", () => {
    expect(
      direction([outcome(["a-tee", "shorts"], -1, ["m-long", "shorts"])]),
    ).toEqual(hit);
    expect(
      direction([outcome(["m-long", "shorts"], 1, ["a-tee", "shorts"])]),
    ).toEqual(hit);
  });

  it("makes no call when no piece on either side has an estimate", () => {
    expect(direction([outcome(["shoes"], -1, ["spikes"])])).toEqual(noCall);
    expect(direction([outcome(["shoes"], -1, [])])).toEqual(noCall);
    expect(direction([outcome([], 1, ["spikes"])])).toEqual(noCall);
    expect(direction([outcome([], 1, [])])).toEqual(noCall);
  });

  it("makes no call against a worn piece the closet no longer holds", () => {
    const retired = {
      replayCase: replayCase([], -1, {
        worn: [{ pieceId: "retired", group: "tops" }],
      }),
      result: result(scored("z-base")),
    };
    expect(direction([retired])).toEqual(noCall);
    const dropped = {
      replayCase: replayCase([], 1, {
        worn: [...worn("shell"), { pieceId: "retired", group: "tops" }],
      }),
      result: result([]),
    };
    expect(direction([dropped])).toEqual(hit);
  });

  it("makes no call when the Call offered no kit", () => {
    expect(
      direction([outcome(["a-tee"], -1, ["m-long"], "below-threshold")]),
    ).toEqual(noCall);
  });

  it("sums hits, misses and no calls apart", () => {
    expect(
      direction([
        outcome(["a-tee"], -1, ["m-long"]),
        outcome(["m-long"], -1, ["a-tee"]),
        outcome(["a-tee"], -2, ["m-long"]),
        outcome(["shoes"], 2, ["spikes"]),
        outcome(["a-tee"], 0, ["a-tee"]),
      ]),
    ).toEqual({ hits: 2, of: 3, noCall: 1 });
  });
});

describe("measure", () => {
  it("counts cases and the share that offered a kit", () => {
    const metrics = measure([
      outcome(["a-tee"], 0, ["a-tee"], "below-threshold"),
      outcome(["a-tee"], 0, ["a-tee"], "best-guess"),
      outcome(["a-tee"], 0, ["a-tee"], "confident"),
    ]);
    expect(metrics.cases).toBe(3);
    expect(metrics.coverage).toEqual({ hits: 2, of: 3 });
  });

  it("is empty over no cases", () => {
    expect(measure([])).toEqual({
      cases: 0,
      dialedAgreement: { hits: 0, of: 0 },
      direction: { hits: 0, of: 0, noCall: 0 },
      coverage: { hits: 0, of: 0 },
      byConfidence: [],
    });
  });

  it("splits both kit measures by confidence, narrowest first", () => {
    const metrics = measure([
      outcome(["a-tee"], 0, ["a-tee"], "confident"),
      outcome(["a-tee"], -1, ["m-long"], "confident"),
      outcome(["a-tee"], 0, ["m-long"], "probable"),
      outcome(["a-tee"], 1, ["m-long"], "probable"),
      outcome(["a-tee"], 0, ["a-tee"], "below-threshold"),
    ]);
    expect(metrics.byConfidence).toEqual([
      {
        confidence: "below-threshold",
        dialedAgreement: { hits: 0, of: 0 },
        direction: { hits: 0, of: 0, noCall: 0 },
      },
      {
        confidence: "probable",
        dialedAgreement: { hits: 0, of: 1 },
        direction: { hits: 0, of: 1, noCall: 0 },
      },
      {
        confidence: "confident",
        dialedAgreement: { hits: 1, of: 1 },
        direction: { hits: 1, of: 1, noCall: 0 },
      },
    ]);
  });
});

describe("byRank", () => {
  it("orders confidence from none of its own to confident", () => {
    const shuffled: Confidence[] = [
      "probable",
      "below-threshold",
      "confident",
      "borrowed",
      "best-guess",
    ];
    expect(shuffled.toSorted(byRank)).toEqual([
      "below-threshold",
      "best-guess",
      "borrowed",
      "probable",
      "confident",
    ]);
  });
});
