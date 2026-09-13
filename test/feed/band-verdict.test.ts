import { describe, expect, it } from "vitest";

import { bandVerdict } from "../../src/modules/feed/coverage";
import type { CoverageBand } from "../../src/modules/feed/coverage";

/**
 * How a band reads in one word (design §AB3), and the tie-break that
 * decides it.
 *
 * **Ties go to the colder end** — the same rule and the same reason
 * `ladderFrom` picks its thinnest band that way: underdressing is the
 * failure that ends a run early, so a band a runner gets wrong equally in
 * both directions is worth naming as the direction that costs more.
 */
function band(counts: Partial<CoverageBand>): CoverageBand {
  return { bandFloorC: 0, label: "0–5°", cold: 0, dialed: 0, warm: 0, ...counts };
}

describe("bandVerdict", () => {
  it("names whichever kind leads", () => {
    expect(bandVerdict(band({ cold: 3, dialed: 1, warm: 1 }))).toBe("cold");
    expect(bandVerdict(band({ cold: 1, dialed: 3, warm: 1 }))).toBe("dialed");
    expect(bandVerdict(band({ cold: 1, dialed: 1, warm: 3 }))).toBe("warm");
  });

  it("gives a cold-and-dialed tie to cold", () => {
    expect(bandVerdict(band({ cold: 4, dialed: 4, warm: 0 }))).toBe("cold");
  });

  it("gives a cold-and-warm tie to cold", () => {
    // The case a `>` instead of `>=` gets wrong: with 2/0/2 a strict
    // comparison falls past cold *and* past dialed, and calls it warm —
    // the opposite answer, from the same data.
    expect(bandVerdict(band({ cold: 2, dialed: 0, warm: 2 }))).toBe("cold");
  });

  it("gives a dialed-and-warm tie to dialed", () => {
    // The centre beats over-dressing for the same reason cold beats the
    // centre: a runner who was right as often as they were over-dressed
    // was, on balance, right.
    expect(bandVerdict(band({ cold: 0, dialed: 2, warm: 2 }))).toBe("dialed");
  });

  it("answers for an all-zero band, which nothing asks it about", () => {
    // The tie-break cascade lands on cold, and "Under-dressed" would be an
    // accusation drawn from no runs at all. It is never rendered: the
    // profile's coverage comes from `bandsAscending`, which omits gaps —
    // only the Call ladder shows empty bands, and it uses the *coverage*
    // channel to say "unknown" rather than this one.
    //
    // Pinned rather than left implicit, so a future caller that does hand
    // it a gap has to notice this answer and decide about it.
    expect(bandVerdict(band({}))).toBe("cold");
  });
});
