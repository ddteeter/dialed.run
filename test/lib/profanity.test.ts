import { describe, expect, it } from "vitest";

import { isProfaneHandle, readBackDigits } from "../../src/lib/profanity";
import { PROFANE_WORDS } from "../../src/lib/profanity-words";

/**
 * The vendored word list (LDNOOBW, CC BY 4.0) as a handle check (task
 * 126; owner, 2026-09-27): whole parts only, never inside a word.
 */
function asHandle(word: string): string {
  return word.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

describe("isProfaneHandle", () => {
  it("refuses every listed word, as a whole handle", () => {
    expect(PROFANE_WORDS.length).toBeGreaterThan(400);
    for (const word of PROFANE_WORDS) {
      expect(isProfaneHandle(asHandle(word)), word).toBe(true);
    }
  });

  it("refuses a listed word as one part of a handle", () => {
    expect(isProfaneHandle("big_shit")).toBe(true);
    expect(isProfaneHandle("shit_runner")).toBe(true);
    expect(isProfaneHandle("shit99")).toBe(true);
    expect(isProfaneHandle("99shit")).toBe(true);
    // A multi-word entry, run together as a handle must be.
    expect(isProfaneHandle("two_girls_one_cup")).toBe(true);
  });

  it("reads digit disguises back as letters, in the whole and in a part", () => {
    expect(isProfaneHandle("sh1t")).toBe(true);
    expect(isProfaneHandle("run_sh1t")).toBe(true);
    expect(isProfaneHandle("b1tch")).toBe(true);
    expect(isProfaneHandle("wh0re")).toBe(true);
    expect(isProfaneHandle("fu_ck")).toBe(true);
    // A listed word that has a digit of its own is matched as written.
    expect(isProfaneHandle("2g1c")).toBe(true);
    expect(isProfaneHandle("run_2g1c")).toBe(true);
  });

  it("never matches inside a word: a runner is not refused for their town", () => {
    for (const handle of [
      "basement_miles",
      "scraping_by",
      "raccoons",
      "twinkle_toes",
      "montenegro_runs",
      "therapist",
      "grass_runner",
      "classic_miles",
      "bass_player",
      "peacock",
      "scunthorpe",
      "maya_runs",
    ]) {
      expect(isProfaneHandle(handle), handle).toBe(false);
    }
  });
});

describe("readBackDigits", () => {
  it("reads 0 3 4 5 7 as letters, 1 as both i and l, and leaves the rest", () => {
    expect(readBackDigits("0345761")).toStrictEqual(["oeast6i", "oeast6l"]);
    expect(readBackDigits("run")).toStrictEqual(["run", "run"]);
  });
});
