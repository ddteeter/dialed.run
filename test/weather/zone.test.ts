import { afterEach, describe, expect, it, vi } from "vitest";

import { timeZoneAt } from "../../src/modules/weather";
import {
  mockVisualCrossing,
  visualCrossingCurrentBody,
  visualCrossingHours,
} from "./fixtures/visual-crossing-observation";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The profile's zone lookup (design 142): the configured provider's
 * reading for now, kept for its zone.
 */
describe("timeZoneAt", () => {
  it("answers the zone the provider names for the place, from one request", async () => {
    const fetchSpy = mockVisualCrossing();

    expect(await timeZoneAt(10.11, 20.22)).toBe("America/Chicago");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("answers nothing when the provider names no zone", async () => {
    const body = Object.fromEntries(
      Object.entries(visualCrossingCurrentBody(visualCrossingHours[0])).filter(
        ([key]) => key !== "timezone",
      ),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json(body)),
    );

    expect(await timeZoneAt(10.33, 20.44)).toBeUndefined();
  });

  it("throws when the provider is unavailable, for the caller to degrade from", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("down", { status: 503 })),
    );

    await expect(timeZoneAt(10.55, 20.66)).rejects.toThrow(/responded 503/u);
  });
});
