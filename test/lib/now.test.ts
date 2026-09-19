import { afterEach, describe, expect, it, vi } from "vitest";

import { nowSeconds } from "../../src/lib/now";

afterEach(() => {
  vi.useRealTimers();
});

describe("nowSeconds", () => {
  it("returns whole unix seconds, not milliseconds", () => {
    // The bug this function exists to make impossible: milliseconds in a
    // seconds column reads back as a date forty thousand years out, and
    // nothing rejects it. Pinned against a known instant rather than
    // against `Date.now()` recomputed here, which would agree with a
    // wrong implementation as readily as a right one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T12:34:56.789Z"));
    expect(nowSeconds()).toBe(1_789_821_296);
  });

  it("floors rather than rounds, so it never names a second yet to come", () => {
    // 999ms into a second is still that second. Rounding would report the
    // next one, and a row stamped in the future is a row an inclusive
    // sweep skips.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T12:34:56.999Z"));
    expect(nowSeconds()).toBe(1_789_821_296);
  });

  it("advances with the clock", () => {
    // Without this, a constant would satisfy both assertions above.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T12:34:56.000Z"));
    const before = nowSeconds();
    vi.setSystemTime(new Date("2026-09-19T12:35:57.000Z"));
    expect(nowSeconds() - before).toBe(61);
  });
});
