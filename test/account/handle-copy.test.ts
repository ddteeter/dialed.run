import { describe, expect, it } from "vitest";

import {
  busyMessage,
  capRefusal,
  capSaid,
  tooOftenMessage,
} from "../../src/modules/account/handles/handle-copy";

/**
 * The rename cap's words (R60, #820): the band's sentence names the day
 * as a sentence says it, on the runner's clock, and only the cap's answer
 * has one.
 */
const UNTIL = Date.UTC(2026, 11, 14, 12) / 1000;
const CHICAGO = { homeZone: "America/Chicago" };

describe("the rename cap's sentence", () => {
  it("names the day on the runner's clock", () => {
    expect(tooOftenMessage(UNTIL, CHICAGO)).toBe(
      "You've changed your handle 3 times in 30 days. You can change it again on Mon, Dec 14.",
    );
    // Late on Dec 14 UTC is already Dec 15 in Tokyo.
    expect(
      tooOftenMessage(Date.UTC(2026, 11, 14, 20) / 1000, {
        homeZone: "Asia/Tokyo",
      }),
    ).toMatch(/on Tue, Dec 15\.$/u);
  });

  it("is the cap's answer's alone", () => {
    const cap = { kind: "too_often", until: UNTIL, viewer: CHICAGO } as const;

    expect(capRefusal(cap)).toBe(tooOftenMessage(UNTIL, CHICAGO));
    expect(capSaid(cap)).toBe(
      `Not changed. ${tooOftenMessage(UNTIL, CHICAGO)}`,
    );
    expect(capRefusal({ kind: "claimed", username: "maya" })).toBeUndefined();
    expect(capSaid({ kind: "claimed", username: "maya" })).toBeUndefined();
  });
});

describe("the hour's claims' sentence", () => {
  it("names the time on the runner's clock", () => {
    expect(busyMessage(UNTIL, CHICAGO)).toBe(
      "You've tried 20 handles this hour. You can try again at 6:00 AM.",
    );
    expect(busyMessage(UNTIL, { homeZone: "UTC" })).toBe(
      "You've tried 20 handles this hour. You can try again at 12:00 PM UTC.",
    );
  });

  it("is the band's answer past the hour's claims too", () => {
    const busy = { kind: "busy", until: UNTIL, viewer: CHICAGO } as const;

    expect(capRefusal(busy)).toBe(busyMessage(UNTIL, CHICAGO));
    expect(capSaid(busy)).toBe(`Not changed. ${busyMessage(UNTIL, CHICAGO)}`);
    expect(
      capRefusal({ kind: "taken", username: "maya", suggestion: undefined }),
    ).toBeUndefined();
  });
});
