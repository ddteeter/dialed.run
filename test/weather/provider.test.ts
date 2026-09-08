import { describe, expect, it, vi } from "vitest";

import {
  WeatherUnavailableError,
  createVisualCrossingProvider,
} from "../../src/modules/weather/provider/visual-crossing";
import { visualCrossingObservationFixture } from "./fixtures/visual-crossing-observation";

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(() => Promise.resolve(Response.json(body, { status })));
}

describe("visual crossing adapter (103)", () => {
  it("zod-parses a fixture response and maps the nearest hour", async () => {
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider("test-key", fetchImpl);

    // 07:03 local-equivalent epoch — closest to the 07:00 fixture hour.
    const at = new Date(1_768_485_780 * 1000);
    const observation = await provider.observation(44.98, -93.27, at);

    expect(observation).toEqual({
      tempC: -4.8,
      feelsLikeC: -9.7,
      humidity: 80.1,
      windKph: 14.2,
      precipMm: 0.2,
      condition: "Overcast",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("defaults a null precip field to 0", async () => {
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    const at = new Date(1_768_489_200 * 1000); // 08:00 hour, precip: null
    const observation = await provider.observation(44.98, -93.27, at);
    expect(observation.precipMm).toBe(0);
  });

  it("forecast() shares the same Timeline query as observation()", async () => {
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    const at = new Date(1_768_482_000 * 1000);
    const observation = await provider.forecast(44.98, -93.27, at);
    expect(observation.condition).toBe("Clear");
  });

  it("a malformed body is a retryable error, not a crash", async () => {
    const fetchImpl = jsonFetch({ not: "the expected shape" });
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    await expect(
      provider.observation(44.98, -93.27, new Date()),
    ).rejects.toBeInstanceOf(WeatherUnavailableError);
  });

  it("a non-2xx response is a retryable error", async () => {
    const fetchImpl = jsonFetch({ message: "rate limited" }, 429);
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    await expect(
      provider.observation(44.98, -93.27, new Date()),
    ).rejects.toBeInstanceOf(WeatherUnavailableError);
  });

  it("a missing API key fails without ever calling fetch", async () => {
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider(undefined, fetchImpl);
    await expect(
      provider.observation(44.98, -93.27, new Date()),
    ).rejects.toBeInstanceOf(WeatherUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
