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

/**
 * The adapter's edges: the request it builds, and every way it refuses.
 *
 * Everything below was a surviving mutant. The query parameters could all
 * be emptied — `unitGroup=metric` in particular, which is the difference
 * between storing Celsius and storing Fahrenheit with a Celsius label —
 * and every error message could be blanked, because the tests only ever
 * asserted the error's *class*. A `WeatherUnavailableError` saying nothing
 * is what an operator gets at 3am.
 */
const FIXTURE_HOURS = visualCrossingObservationFixture.days[0]?.hours ?? [];

/**
A response body shaped like Visual Crossing's, with the given hours.
*/
function bodyWithHours(hours: unknown[]): unknown {
  return { days: [{ datetime: "2026-01-15", hours }] };
}

/**
Awaits a call that must fail, and hands back the adapter's own error.
*/
async function rejectionFrom(
  call: Promise<unknown>,
): Promise<WeatherUnavailableError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof WeatherUnavailableError) return error;
    throw error;
  }
  throw new Error("expected the provider to reject");
}

async function failureFrom(
  body: unknown,
  options: { status?: number; apiKey?: string | undefined } = {},
): Promise<WeatherUnavailableError> {
  // `in` rather than a default: an explicit `apiKey: undefined` is the
  // case under test, and a destructuring default would quietly replace it.
  const apiKey = "apiKey" in options ? options.apiKey : "test-key";
  const provider = createVisualCrossingProvider(
    apiKey,
    jsonFetch(body, options.status ?? 200),
  );
  return rejectionFrom(
    provider.observation(44.98, -93.27, new Date(1_768_485_600 * 1000)),
  );
}

/**
The URL a fetch was called with, whatever shape the caller passed it in.
*/
function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

describe("the request the adapter builds", () => {
  it("asks for metric hourly JSON at the run's date, with the key", async () => {
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider("secret-key", fetchImpl);

    await provider.observation(44.98, -93.27, new Date(1_768_485_600 * 1000));

    const [input, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const asUrl = urlOf(input ?? "https://example.invalid");
    // The date, not the timestamp: Timeline takes a day and we pick the
    // hour ourselves.
    expect(asUrl.pathname).toMatch(/\/44\.98,-93\.27\/2026-01-15$/);
    // `metric` is the whole reason the numbers mean what the schema says.
    expect(asUrl.searchParams.get("unitGroup")).toBe("metric");
    expect(asUrl.searchParams.get("include")).toBe("hours");
    expect(asUrl.searchParams.get("contentType")).toBe("json");
    expect(asUrl.searchParams.get("key")).toBe("secret-key");
    // Law 4: every outbound fetch is bounded.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the adapter says why it is unavailable", () => {
  it("names itself", async () => {
    const error = await failureFrom({ not: "the expected shape" });
    expect(error.name).toBe("WeatherUnavailableError");
  });

  it("says the key is missing rather than blaming the upstream", async () => {
    const unset = await failureFrom({}, { apiKey: undefined });
    expect(unset.message).toMatch(/VISUAL_CROSSING_API_KEY/);
    // An unset secret reads as an empty string as often as undefined, and
    // an empty key produces a 401 that looks like an outage.
    const empty = await failureFrom({}, { apiKey: "" });
    expect(empty.message).toMatch(/VISUAL_CROSSING_API_KEY/);
  });

  it("reports the status code it got back", async () => {
    const error = await failureFrom({ message: "rate limited" }, { status: 429 });
    expect(error.message).toMatch(/429/);
  });

  it("distinguishes a malformed body from a bad status, and keeps the cause", async () => {
    const error = await failureFrom({ not: "the expected shape" });
    expect(error.message).toMatch(/failed validation/);
    expect(error.cause).toBeDefined();
  });

  it("reports a day with no hours in it", async () => {
    const error = await failureFrom(bodyWithHours([]));
    expect(error.message).toMatch(/no hourly data/);
  });

  it("reports an hour that maps to an impossible observation", async () => {
    // Visual Crossing's own shape is satisfied — `humidity` is a number —
    // but 150% is outside the contract, and the mapped-observation parse
    // is the second gate that catches it.
    const error = await failureFrom(
      bodyWithHours([{ ...FIXTURE_HOURS[1], humidity: 150 }]),
    );
    expect(error.message).toMatch(/invalid observation/);
    expect(error.cause).toBeDefined();
  });

  it("wraps a transport failure and keeps the original as the cause", async () => {
    const boom = new Error("connect ECONNREFUSED");
    const provider = createVisualCrossingProvider("test-key", () =>
      Promise.reject(boom),
    );

    const error = await rejectionFrom(
      provider.observation(44.98, -93.27, new Date()),
    );
    expect(error.message).toMatch(/request failed/);
    expect(error.cause).toBe(boom);
  });
});

describe("picking the hour", () => {
  it("takes the earlier hour when a run starts exactly between two", async () => {
    // 06:30 is 1800s from both 06:00 and 07:00. `<` keeps the first seen,
    // `<=` would silently take the later one — a whole hour of difference
    // in what a run is remembered as, decided by a comparison nobody
    // tested.
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider("test-key", fetchImpl);

    const observation = await provider.observation(
      44.98,
      -93.27,
      new Date((1_768_482_000 + 1800) * 1000),
    );

    expect(observation.tempC).toBeCloseTo(-5.6, 5);
  });

  it("searches every day the response carries, not just the first", async () => {
    // Timeline answers with a day range when the requested hour is near a
    // boundary. Capping the array at one day would drop the half of the
    // window that holds the answer.
    const fetchImpl = jsonFetch({
      days: [
        { datetime: "2026-01-14", hours: [FIXTURE_HOURS[0]] },
        { datetime: "2026-01-15", hours: [FIXTURE_HOURS[2]] },
      ],
    });
    const provider = createVisualCrossingProvider("test-key", fetchImpl);

    const observation = await provider.observation(
      44.98,
      -93.27,
      new Date(1_768_489_200 * 1000),
    );

    expect(observation.tempC).toBeCloseTo(-3.9, 5);
  });
});
