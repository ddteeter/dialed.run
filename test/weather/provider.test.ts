import { describe, expect, it, vi } from "vitest";

import type { ClimatePlace } from "../../src/lib/contracts";
import {
  WeatherUnavailableError,
  createVisualCrossingProvider,
} from "../../src/modules/weather/provider/visual-crossing";
import {
  visualCrossingCurrentBody,
  visualCrossingHours,
  visualCrossingObservationFixture,
} from "./fixtures/visual-crossing-observation";
import {
  visualCrossingSummerStatsFixture,
  visualCrossingWinterStatsFixture,
} from "./fixtures/visual-crossing-stats";

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(() => Promise.resolve(Response.json(body, { status })));
}

describe("visual crossing adapter (103)", () => {
  it("zod-parses a fixture response and maps its current conditions", async () => {
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider("test-key", fetchImpl);

    // 07:03 — Visual Crossing answers with the 07:00 hour.
    const at = new Date(1_768_485_780 * 1000);
    const observation = await provider.observation(44.98, -93.27, at);

    expect(observation).toEqual({
      tempC: -4.8,
      feelsLikeC: -9.7,
      humidity: 80.1,
      windKph: 14.2,
      precipMm: 0.2,
      condition: "Overcast",
      // D-96: the zone at the response root, which used to be stripped.
      timeZone: "America/Chicago",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("carries no zone when the response names none", async () => {
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({ ...visualCrossingObservationFixture, timezone: undefined }),
    );
    const observation = await provider.observation(
      44.98,
      -93.27,
      new Date(1_768_485_780 * 1000),
    );
    expect(observation).not.toHaveProperty("timeZone");
  });

  it("drops a zone Intl would reject, and keeps the weather", async () => {
    // Degrade, don't fail (law 5): an unusable label costs the run its
    // local date, never its observation.
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({
        ...visualCrossingObservationFixture,
        timezone: "Mars/Olympus_Mons",
      }),
    );
    const observation = await provider.observation(
      44.98,
      -93.27,
      new Date(1_768_485_780 * 1000),
    );
    expect(observation).not.toHaveProperty("timeZone");
    expect(observation.condition).toBe("Overcast");
  });

  it("defaults a null precip field to 0", async () => {
    const fetchImpl = jsonFetch(
      visualCrossingCurrentBody(visualCrossingHours[2]),
    );
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    const at = new Date(1_768_489_200 * 1000); // 08:00 hour, no precip key
    const observation = await provider.observation(44.98, -93.27, at);
    expect(observation.precipMm).toBe(0);
  });

  it("forecast() shares the same Timeline query as observation()", async () => {
    const fetchImpl = jsonFetch(
      visualCrossingCurrentBody(visualCrossingHours[0]),
    );
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
  it("asks for one metric record at the run's moment, with the key", async () => {
    const fetchImpl = jsonFetch(visualCrossingObservationFixture);
    const provider = createVisualCrossingProvider("secret-key", fetchImpl);

    await provider.observation(44.98, -93.27, new Date(1_768_485_780_250));

    const [input, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const asUrl = urlOf(input ?? "https://example.invalid");
    // The moment in epoch seconds, not a date: a day is 24 records, and a
    // local date-time would be read in the place's zone, which the adapter
    // does not know yet. Whole seconds — Timeline takes no fraction.
    expect(asUrl.pathname).toMatch(/\/44\.98,-93\.27\/1768485780$/);
    // `metric` is the whole reason the numbers mean what the schema says.
    expect(asUrl.searchParams.get("unitGroup")).toBe("metric");
    // `current` is what makes it one record rather than twenty-four
    // (OPS-6): without it the answer carries the whole day's hours.
    expect(asUrl.searchParams.get("include")).toBe("current");
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
    const error = await failureFrom(
      { message: "rate limited" },
      { status: 429 },
    );
    expect(error.message).toMatch(/429/);
  });

  it("distinguishes a malformed body from a bad status, and keeps the cause", async () => {
    const error = await failureFrom({ not: "the expected shape" });
    expect(error.message).toMatch(/failed validation/);
    expect(error.cause).toBeDefined();
  });

  it("refuses a day of hours where one record was asked for", async () => {
    // The old, 24-record answer: parsing it now would mean the request
    // lost its `include=current` and is billing a day again.
    const error = await failureFrom({
      timezone: "America/Chicago",
      days: [{ datetime: "2026-01-15", hours: [...visualCrossingHours] }],
    });
    expect(error.message).toMatch(/failed validation/);
  });

  it("reports an hour that maps to an impossible observation", async () => {
    // Visual Crossing's own shape is satisfied — `humidity` is a number —
    // but 150% is outside the contract, and the mapped-observation parse
    // is the second gate that catches it.
    const error = await failureFrom(
      visualCrossingCurrentBody({ ...visualCrossingHours[1], humidity: 150 }),
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

/**
 * The adapter always passes a `URL`, so narrow to it rather than
 * stringifying a `RequestInfo` union — which is what
 * `no-base-to-string` is warning about.
 */
function requestedUrls(fetchImpl: typeof fetch): URL[] {
  return vi.mocked(fetchImpl).mock.calls.map(([input]) => {
    if (!(input instanceof URL)) throw new TypeError("expected a URL");
    return input;
  });
}

function statsFetch(): typeof fetch {
  // Winter probe first, then summer — the order the adapter asks in.
  const bodies = [
    visualCrossingWinterStatsFixture,
    visualCrossingSummerStatsFixture,
  ];
  let call = 0;
  return vi.fn(() => {
    const body = bodies[call];
    call += 1;
    return Promise.resolve(Response.json(body));
  });
}

const MINNEAPOLIS: ClimatePlace = {
  kind: "coordinates",
  lat: 44.98,
  lng: -93.27,
};
const SYDNEY: ClimatePlace = { kind: "coordinates", lat: -33.87, lng: 151.21 };

describe("visual crossing climate normals (105)", () => {
  it("asks about a typed place by name, encoded for the path", async () => {
    // D-59: the endpoint geocodes a label itself. The label is a runner's
    // own text landing in a URL path, so a `/` or a `,` in it must not be
    // read as structure — the encoded form is what leaves the adapter.
    const fetchImpl = statsFetch();
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    await provider.climateNormals({ kind: "label", label: "Omaha, NE/US" });

    const segments = requestedUrls(fetchImpl).map((url) =>
      url.pathname.split("/").at(-2),
    );
    expect(segments).toStrictEqual([
      "Omaha%2C%20NE%2FUS",
      "Omaha%2C%20NE%2FUS",
    ]);
  });

  it("asks about coordinates as lat,lng", async () => {
    const fetchImpl = statsFetch();
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    await provider.climateNormals(MINNEAPOLIS);

    const segments = requestedUrls(fetchImpl).map((url) =>
      url.pathname.split("/").at(-2),
    );
    expect(segments).toStrictEqual(["44.98,-93.27", "44.98,-93.27"]);
  });

  it("reads the mean of each triple, not the extreme", async () => {
    // `[min, mean, max]` — index 1. Taking index 0 would make every place
    // look arctic, which is the kind of wrong that still produces a
    // plausible-looking band.
    const provider = createVisualCrossingProvider("test-key", statsFetch());

    expect(await provider.climateNormals(MINNEAPOLIS)).toStrictEqual({
      winterLowC: -12.1,
      summerHighC: 28.7,
    });
  });

  it("asks for stats, and sends no elements filter", async () => {
    // Both are load-bearing and both were found by probing: `normals` is
    // accepted and returns nothing, and an `elements=` filter strips the
    // `normal` block even when `normal` is named in it.
    const fetchImpl = statsFetch();
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    await provider.climateNormals(MINNEAPOLIS);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const url of requestedUrls(fetchImpl)) {
      expect(url.searchParams.get("include")).toBe("stats");
      expect(url.searchParams.has("elements")).toBe(false);
      expect(url.searchParams.get("unitGroup")).toBe("metric");
    }
  });

  it("probes mid-January and mid-July of the current year", async () => {
    // The year is irrelevant to the `normal` block (measured: 2025, 2027
    // and 2029 answer identically), so it is read from the clock rather
    // than pinned — a pinned year reads as a time bomb even when it is not.
    const fetchImpl = statsFetch();
    const provider = createVisualCrossingProvider(
      "test-key",
      fetchImpl,
      () => new Date("2031-09-16T12:00:00Z"),
    );
    await provider.climateNormals(MINNEAPOLIS);

    const dates = requestedUrls(fetchImpl).map((url) =>
      url.pathname.split("/").at(-1),
    );
    expect(dates).toStrictEqual(["2031-01-15", "2031-07-15"]);
  });

  it("reads the year from the real clock when none is injected", async () => {
    const fetchImpl = statsFetch();
    const provider = createVisualCrossingProvider("test-key", fetchImpl);
    await provider.climateNormals(MINNEAPOLIS);

    const year = String(new Date().getUTCFullYear());
    const dates = requestedUrls(fetchImpl).map((url) =>
      url.pathname.split("/").at(-1),
    );
    expect(dates).toStrictEqual([`${year}-01-15`, `${year}-07-15`]);
  });

  it("takes the colder low and the warmer high whichever probe found them", async () => {
    // Southern hemisphere: the "winter" probe lands in summer. The naming
    // is northern shorthand; the maths only cares which is colder.
    const swapped = [
      visualCrossingSummerStatsFixture,
      visualCrossingWinterStatsFixture,
    ];
    let call = 0;
    const fetchImpl = vi.fn(() => {
      const body = swapped[call];
      call += 1;
      return Promise.resolve(Response.json(body));
    });
    const provider = createVisualCrossingProvider("test-key", fetchImpl);

    expect(await provider.climateNormals(SYDNEY)).toStrictEqual({
      winterLowC: -12.1,
      summerHighC: 28.7,
    });
  });

  it("refuses a response with no normal block rather than guessing", async () => {
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({ days: [{ datetime: "2027-01-15" }] }),
    );

    await expect(provider.climateNormals(MINNEAPOLIS)).rejects.toThrow(
      WeatherUnavailableError,
    );
  });

  it("refuses without a key, before reaching the network", async () => {
    const fetchImpl = statsFetch();
    const provider = createVisualCrossingProvider(undefined, fetchImpl);

    await expect(provider.climateNormals(MINNEAPOLIS)).rejects.toThrow(
      WeatherUnavailableError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a non-2xx answer, naming which read failed", async () => {
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({ message: "over quota" }, 429),
    );

    // The exact sentence, not just the class: the noun in it is what tells
    // a reader whether the observation read or the stats read broke, and
    // asserting only `toThrow(WeatherUnavailableError)` lets it go empty.
    await expect(provider.climateNormals(MINNEAPOLIS)).rejects.toThrow(
      "Visual Crossing stats responded 429",
    );
  });

  it("names the observation read when that one fails", async () => {
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({ message: "nope" }, 500),
    );

    await expect(
      provider.observation(44.98, -93.27, new Date()),
    ).rejects.toThrow("Visual Crossing observation responded 500");
  });

  it("refuses an empty key the same as a missing one", async () => {
    // An unset secret arrives as "" at least as often as undefined, and
    // the difference between them is invisible at the call site.
    const fetchImpl = statsFetch();
    const provider = createVisualCrossingProvider("", fetchImpl);

    await expect(provider.climateNormals(MINNEAPOLIS)).rejects.toThrow(
      "VISUAL_CROSSING_API_KEY is not configured",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a response whose days list is empty", async () => {
    // Distinct from "no normal block": an empty list parses under a looser
    // schema and then reads `undefined.normal`, which is a TypeError rather
    // than the adapter's own refusal.
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({ days: [] }),
    );

    await expect(provider.climateNormals(MINNEAPOLIS)).rejects.toThrow(
      "Visual Crossing stats response failed validation",
    );
  });
});

describe("visual crossing resolves a typed place (E2-lite's city)", () => {
  const PLACE_BODY = {
    latitude: 45.5152,
    longitude: -122.6784,
    resolvedAddress: "Portland, OR, United States",
    days: [{ datetime: "2031-09-16" }],
  };

  it("answers City, State with where the endpoint found it, and its name for the place", async () => {
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch(PLACE_BODY),
    );
    expect(await provider.resolvePlace("Portland, OR")).toStrictEqual({
      lat: 45.5152,
      lng: -122.6784,
      address: "Portland, OR, United States",
    });
  });

  it("trims the endpoint's name for the place, and takes one up to 200 characters", async () => {
    for (const [resolvedAddress, address] of [
      ["  Portland, OR, United States \n", "Portland, OR, United States"],
      ["x".repeat(200), "x".repeat(200)],
    ]) {
      const provider = createVisualCrossingProvider(
        "test-key",
        jsonFetch({ ...PLACE_BODY, resolvedAddress }),
      );
      const place = await provider.resolvePlace("Portland");
      expect(place?.address).toBe(address);
    }
  });

  it("refuses a body with no name for the place, or a runaway one", async () => {
    for (const body of [
      { latitude: 45.5152, longitude: -122.6784 },
      { ...PLACE_BODY, resolvedAddress: "" },
      { ...PLACE_BODY, resolvedAddress: " ".repeat(3) },
      { ...PLACE_BODY, resolvedAddress: 7 },
      { ...PLACE_BODY, resolvedAddress: "x".repeat(201) },
    ]) {
      const provider = createVisualCrossingProvider(
        "test-key",
        jsonFetch(body),
      );
      const error = await rejectionFrom(provider.resolvePlace("Portland"));
      expect(error.message).toBe(
        "Visual Crossing place response failed validation",
      );
    }
  });

  it("asks one daily read for today, by the label, encoded for the path", async () => {
    const fetchImpl = jsonFetch(PLACE_BODY);
    const provider = createVisualCrossingProvider(
      "test-key",
      fetchImpl,
      () => new Date("2031-09-16T12:00:00Z"),
    );
    await provider.resolvePlace("Omaha, NE/US");

    const urls = requestedUrls(fetchImpl);
    expect(urls).toHaveLength(1);
    expect(urls[0]?.pathname.split("/").slice(-2)).toStrictEqual([
      "Omaha%2C%20NE%2FUS",
      "2031-09-16",
    ]);
    expect(urls[0]?.searchParams.get("include")).toBe("days");
    expect(urls[0]?.searchParams.get("key")).toBe("test-key");
  });

  it("sends the request under a timeout", async () => {
    const fetchImpl = jsonFetch(PLACE_BODY);
    await createVisualCrossingProvider("test-key", fetchImpl).resolvePlace(
      "Portland",
    );
    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads a 400 as no such place — an answer, not an outage", async () => {
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({ message: "Invalid location parameter value." }, 400),
    );
    expect(await provider.resolvePlace("Atlantis")).toBeUndefined();
  });

  it("is unavailable, not unknown, on any other status", async () => {
    const provider = createVisualCrossingProvider(
      "test-key",
      jsonFetch({}, 401),
    );
    const error = await rejectionFrom(provider.resolvePlace("Portland"));
    expect(error.message).toBe("Visual Crossing place responded 401");
  });

  it("refuses a body without coordinates, or with impossible ones", async () => {
    for (const body of [
      { days: [] },
      { longitude: -122.6784, resolvedAddress: "Portland, OR, United States" },
      { latitude: 45.5152, resolvedAddress: "Portland, OR, United States" },
      { ...PLACE_BODY, latitude: 91 },
      { ...PLACE_BODY, latitude: -91 },
      { ...PLACE_BODY, longitude: 181 },
      { ...PLACE_BODY, longitude: -181 },
    ]) {
      const provider = createVisualCrossingProvider(
        "test-key",
        jsonFetch(body),
      );
      const error = await rejectionFrom(provider.resolvePlace("Portland"));
      expect(error.message).toBe(
        "Visual Crossing place response failed validation",
      );
    }
  });

  it("takes the edges of the world as places", async () => {
    for (const [latitude, longitude] of [
      [-90, 180],
      [90, -180],
    ]) {
      const provider = createVisualCrossingProvider(
        "test-key",
        jsonFetch({ latitude, longitude, resolvedAddress: "An edge" }),
      );
      expect(await provider.resolvePlace("An edge")).toStrictEqual({
        lat: latitude,
        lng: longitude,
        address: "An edge",
      });
    }
  });

  it("wraps a transport failure, naming the place read", async () => {
    const boom = new Error("connect ECONNREFUSED");
    const provider = createVisualCrossingProvider("test-key", () =>
      Promise.reject(boom),
    );
    const error = await rejectionFrom(provider.resolvePlace("Portland"));
    expect(error.message).toBe("Visual Crossing place request failed");
    expect(error.cause).toBe(boom);
  });

  it("says the key is missing, without asking", async () => {
    for (const apiKey of [undefined, ""]) {
      const fetchImpl = jsonFetch(PLACE_BODY);
      const provider = createVisualCrossingProvider(apiKey, fetchImpl);
      const error = await rejectionFrom(provider.resolvePlace("Portland"));
      expect(error.message).toBe("VISUAL_CROSSING_API_KEY is not configured");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});
