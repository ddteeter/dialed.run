/**
 * Visual Crossing Timeline API adapter — the only `WeatherProvider`
 * implementation (docs/architecture.md: "Weather is an adapter"). Every
 * consumed field is zod-parsed (trust boundary); every call carries
 * `AbortSignal.timeout` (CLAUDE.md resilience law 4). `observation` and
 * `forecast` share one Timeline query — the API serves both past and
 * future dates from the same endpoint shape.
 */
import { z } from "zod";

import {
  weatherObservationSchema,
  type WeatherObservation,
  type WeatherProvider,
} from "../../../lib/contracts";

const TIMEOUT_MS = 10_000;

/**
 * Thrown for any adapter failure (network, timeout, non-2xx, malformed
 * body, missing key). Always a plain caught error for the caller — never a
 * crash — so `attachObservation` can treat it as retryable (CLAUDE.md law 5).
 */
export class WeatherUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WeatherUnavailableError";
  }
}

const visualCrossingHourSchema = z.object({
  datetimeEpoch: z.number().int(),
  temp: z.number(),
  feelslike: z.number(),
  humidity: z.number(),
  windspeed: z.number(),
  precip: z.number().nullable().optional(),
  conditions: z.string(),
});

const visualCrossingDaySchema = z.object({
  datetime: z.string(),
  hours: z.array(visualCrossingHourSchema),
});

const visualCrossingResponseSchema = z.object({
  days: z.array(visualCrossingDaySchema).min(1),
});

type VisualCrossingHour = z.infer<typeof visualCrossingHourSchema>;

function pickNearestHour(
  days: z.infer<typeof visualCrossingDaySchema>[],
  targetEpochSeconds: number,
): VisualCrossingHour {
  let best: VisualCrossingHour | undefined;
  let bestDiff = Infinity;
  for (const day of days) {
    for (const hour of day.hours) {
      const diff = Math.abs(hour.datetimeEpoch - targetEpochSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = hour;
      }
    }
  }
  if (!best) {
    throw new WeatherUnavailableError(
      "Visual Crossing response had no hourly data",
    );
  }
  return best;
}

function buildUrl(lat: number, lng: number, at: Date, apiKey: string): URL {
  const dateStr = at.toISOString().slice(0, 10);
  const url = new URL(
    `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${String(lat)},${String(lng)}/${dateStr}`,
  );
  url.searchParams.set("unitGroup", "metric");
  url.searchParams.set("include", "hours");
  url.searchParams.set("contentType", "json");
  url.searchParams.set("key", apiKey);
  return url;
}

async function fetchTimeline(
  lat: number,
  lng: number,
  at: Date,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<WeatherObservation> {
  if (apiKey === undefined || apiKey === "") {
    throw new WeatherUnavailableError(
      "VISUAL_CROSSING_API_KEY is not configured",
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(buildUrl(lat, lng, at, apiKey), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new WeatherUnavailableError("Visual Crossing request failed", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new WeatherUnavailableError(
      `Visual Crossing responded ${String(response.status)}`,
    );
  }
  const body: unknown = await response.json();
  const parsed = visualCrossingResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new WeatherUnavailableError(
      "Visual Crossing response failed validation",
      { cause: parsed.error },
    );
  }
  const hour = pickNearestHour(
    parsed.data.days,
    Math.floor(at.getTime() / 1000),
  );
  const mapped = {
    tempC: hour.temp,
    feelsLikeC: hour.feelslike,
    humidity: hour.humidity,
    windKph: hour.windspeed,
    precipMm: hour.precip ?? 0,
    condition: hour.conditions,
  };
  const observation = weatherObservationSchema.safeParse(mapped);
  if (!observation.success) {
    throw new WeatherUnavailableError(
      "Visual Crossing hour mapped to an invalid observation",
      { cause: observation.error },
    );
  }
  return observation.data;
}

/**
 * Builds the live adapter. `fetchImpl` is injectable so unit tests never
 * touch the network (default is the ambient global `fetch`).
 */
export function createVisualCrossingProvider(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): WeatherProvider {
  return {
    observation(lat, lng, at) {
      return fetchTimeline(lat, lng, at, apiKey, fetchImpl);
    },
    forecast(lat, lng, at) {
      return fetchTimeline(lat, lng, at, apiKey, fetchImpl);
    },
  };
}
