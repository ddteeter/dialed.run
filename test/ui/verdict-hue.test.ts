import { describe, expect, it } from "vitest";

import { verdictScale } from "../../src/lib/contracts";
import { verdictHue } from "../../src/ui/verdict-hue";

/**
 * T2's verdict hues, which A3 and DS2 both read (design round 19).
 *
 * Asserted per verdict across the whole scale rather than per sign, so a
 * step added to `verdictScale` is covered the moment it exists — and so
 * both cold steps are checked to be pink, not just one of them.
 * *"Position carries the degree"* is only true if the hue does not.
 */
function hueOf(token: string): string {
  const step = verdictScale.find((entry) => entry.token === token);
  if (!step) throw new Error(`no ${token} on the scale`);
  return verdictHue(step.value);
}

describe("verdictHue", () => {
  it("fills both cold steps pink — the cold hue, which shares action's hex", () => {
    // T1: "pink as a surface is #FF2D8A on both", and T1 has no separate
    // cold-surface role, so it is spelled `bg-action`. The ink on it is
    // `accent-ink`, which stays ink inside an inverted block.
    for (const token of ["way_cold", "bit_cold"]) {
      expect(hueOf(token).split(" ")).toEqual([
        "border-action",
        "bg-action",
        "text-accent-ink",
      ]);
    }
  });

  it("fills dialed teal", () => {
    expect(hueOf("dialed").split(" ")).toEqual([
      "border-teal",
      "bg-teal",
      "text-accent-ink",
    ]);
  });

  it("fills both warm steps quiet grey, with ground-coloured text", () => {
    // `--quiet` is the warm-verdict grey per AB, and full strength —
    // "never opacity". Ink on it would not clear contrast; ground does.
    for (const token of ["bit_warm", "way_warm"]) {
      expect(hueOf(token).split(" ")).toEqual([
        "border-quiet",
        "bg-quiet",
        "text-ground",
      ]);
    }
  });

  it("never fills a verdict with ink, which is what A3 used to do", () => {
    // Round 19 exists because A3 filled its chosen cell `--ink` while the
    // backlog that mirrors it filled by hue. No verdict wears ink.
    for (const step of verdictScale) {
      expect([step.token, verdictHue(step.value)]).not.toEqual([
        step.token,
        expect.stringContaining("bg-ink"),
      ]);
    }
  });
});
