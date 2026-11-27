import { describe, expect, it } from "vitest";

import { whyNot } from "../../../src/modules/call/evidence/why-not";
import { names, piece, result } from "./fixtures";

function record(pieceId: string, dialed: number, of: number, bandFloorC = 5) {
  return {
    kind: "personal-piece",
    pieceId,
    bandFloorC,
    dialed,
    of,
  } as const;
}

function tooMuch(pieceId: string, times: number, bandFloorC = 5) {
  return {
    kind: "personal-flag",
    pieceId,
    bandFloorC,
    flag: "too_much",
    times,
  } as const;
}

const runner = names({
  zip: "half-zip",
  tee: "tee",
  vest: "vest",
  shorts: "split shorts",
});

const zip = piece("zip", "tops", [record("zip", 8, 9)], 3);
const shorts = piece("shorts", "bottoms", [], 2);

function call(...others: ReturnType<typeof piece>[]) {
  return result({ kit: [zip, shorts], ranking: [zip, shorts, ...others] });
}

describe("whyNot", () => {
  it("has no answer for a chosen piece", () => {
    expect(whyNot(call(), "zip", runner)).toBeUndefined();
    expect(whyNot(call(), "shorts", runner)).toBeUndefined();
  });

  it("has no answer for a piece the ranking never had", () => {
    expect(whyNot(call(), "vest", runner)).toBeUndefined();
    expect(whyNot(call(), "nope", runner)).toBeUndefined();
  });

  it("has no answer for a piece with no name", () => {
    const anon = piece("anon", "outer");
    expect(whyNot(call(anon), "anon", runner)).toBeUndefined();
  });

  it("weighs a runner-up against the chosen piece's record", () => {
    const tee = piece("tee", "tops", [record("tee", 2, 5)], 1);
    expect(whyNot(call(tee), "tee", runner)).toEqual({
      question: "Why not the tee?",
      answer: "The half-zip is dialed 8 of 9 in this band. The tee, 2 of 5.",
    });
  });

  it("says the runner-up has no verdicts here", () => {
    const tee = piece("tee", "tops", [record("tee", 2, 5, 10)], 1);
    expect(whyNot(call(tee), "tee", runner)).toEqual({
      question: "Why not the tee?",
      answer:
        "The half-zip is dialed 8 of 9 in this band. The tee has no verdicts here yet.",
    });
  });

  it("reads only the asked piece's own record", () => {
    const tee = piece("tee", "tops", [record("zip", 1, 1)], 1);
    expect(whyNot(call(tee), "tee", runner)?.answer).toBe(
      "The half-zip is dialed 8 of 9 in this band. The tee has no verdicts here yet.",
    );
  });

  it("says the chosen piece ranked higher when it has no record here", () => {
    const top = piece("zip", "tops", [record("zip", 8, 9, 10)], 3);
    const tee = piece("tee", "tops", [record("tee", 2, 5)], 1);
    const answer = whyNot(
      result({ kit: [top], ranking: [top, tee] }),
      "tee",
      runner,
    );
    expect(answer).toEqual({
      question: "Why not the tee?",
      answer: "The half-zip ranked higher for this hour.",
    });
  });

  it("reads the chosen piece's record, not its flags", () => {
    const flagged = {
      kind: "personal-flag",
      pieceId: "zip",
      bandFloorC: 5,
      flag: "not_enough",
      times: 2,
    } as const;
    const top = piece("zip", "tops", [flagged], 3);
    const tee = piece("tee", "tops", [], 1);
    expect(
      whyNot(result({ kit: [top], ranking: [top, tee] }), "tee", runner)
        ?.answer,
    ).toBe("The half-zip ranked higher for this hour.");
  });

  it("answers a left-out group's piece (the vest)", () => {
    const vest = piece("vest", "outer", [record("vest", 3, 3)], 1);
    expect(whyNot(call(vest), "vest", runner)).toEqual({
      question: "Why not the vest?",
      answer: "Nothing in your verdicts says you need the vest at this hour.",
    });
  });

  it("answers first with the runner's own too-much", () => {
    const vest = piece(
      "vest",
      "outer",
      [tooMuch("vest", 1), tooMuch("vest", 2), tooMuch("vest", 9, 10)],
      1,
    );
    expect(whyNot(call(vest), "vest", runner)).toEqual({
      question: "Why not the vest?",
      answer: "You told us the vest was too much twice in this band.",
    });
    const tee = piece("tee", "tops", [record("tee", 2, 5), tooMuch("tee", 3)]);
    expect(whyNot(call(tee), "tee", runner)?.answer).toBe(
      "You told us the tee was too much 3 times in this band.",
    );
  });

  it("ignores a too-much on another piece", () => {
    const vest = piece("vest", "outer", [tooMuch("zip", 2)], 1);
    expect(whyNot(call(vest), "vest", runner)?.answer).toBe(
      "Nothing in your verdicts says you need the vest at this hour.",
    );
  });

  it("has no answer when the chosen piece has no name", () => {
    const tee = piece("tee", "tops", [], 1);
    expect(whyNot(call(tee), "tee", names({ tee: "tee" }))).toBeUndefined();
  });
});
