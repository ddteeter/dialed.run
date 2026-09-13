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

/**
 * `include=stats` adds a `normal` block whose every field is a
 * `[min, mean, max]` triple over the provider's statistical period. Only
 * the mean is read — index 1 — and only for the two fields a wardrobe
 * turns on.
 *
 * Verified against the live API on 2026-09-11 rather than inferred:
 * Minneapolis on 15 January answers `tempmin [-26.4, -12.1, 0.4]`.
 * Two traps cost a probe each. The include value is **`stats`**, not
 * `normals` — the latter is accepted and silently returns nothing. And an
 * `elements=` filter **strips the `normal` block entirely**, even when
 * `normal` is named in it, so this query deliberately sends no `elements`.
 */
const normalTripleSchema = z.tuple([z.number(), z.number(), z.number()]);
const normalDaySchema = z.object({
  normal: z.object({
    tempmin: normalTripleSchema,
    tempmax: normalTripleSchema,
  }),
});

const visualCrossingStatsSchema = z.object({
  // A tuple with a rest, not `array().min(1)`: both refuse an empty list at
  // runtime, but only this one types `days[0]` as present, so reading it
  // needs no guard. A guard there would be unreachable — and an unreachable
  // guard is a mutant no test can kill.
  days: z.tuple([normalDaySchema]).rest(normalDaySchema),
});

const MEAN = 1;

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

/**
 * A Timeline URL. One function for both reads, because the endpoint is one
 * endpoint — what differs is the date and the `include`, which is exactly
 * what "past weather" and "typical weather" differ by upstream too.
 *
 * **No `elements=` filter, on either read.** It is tempting on the stats
 * read to ask only for `normal`, and doing so silently strips the `normal`
 * block from the response — verified against the live API, and the reason
 * the first probe concluded the field did not exist.
 */
function timelineUrl(
  lat: number,
  lng: number,
  date: string,
  include: "hours" | "stats",
  apiKey: string,
): URL {
  const url = new URL(
    `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${String(lat)},${String(lng)}/${date}`,
  );
  url.searchParams.set("unitGroup", "metric");
  url.searchParams.set("include", include);
  url.searchParams.set("contentType", "json");
  url.searchParams.set("key", apiKey);
  return url;
}

/**
 * One Timeline request, parsed or refused.
 *
 * The observation read and the normals read are the same four steps — fetch
 * under a timeout, refuse a non-2xx, take the body as `unknown`, parse it —
 * differing only in the URL, the schema and which noun the failure names.
 * Written twice, the second copy is where a missing `AbortSignal.timeout`
 * or a skipped `safeParse` would hide, and both are resilience laws (4).
 */
async function timelineJson<TSchema extends z.ZodType>(
  url: URL,
  schema: TSchema,
  what: string,
  fetchImpl: typeof fetch,
): Promise<z.output<TSchema>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new WeatherUnavailableError(`Visual Crossing ${what} request failed`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new WeatherUnavailableError(
      `Visual Crossing ${what} responded ${String(response.status)}`,
    );
  }
  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new WeatherUnavailableError(
      `Visual Crossing ${what} response failed validation`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
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
  const parsed = await timelineJson(
    timelineUrl(lat, lng, at.toISOString().slice(0, 10), "hours", apiKey),
    visualCrossingResponseSchema,
    "observation",
    fetchImpl,
  );
  const hour = pickNearestHour(parsed.days, Math.floor(at.getTime() / 1000));
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
 * Mid-January and mid-July, in a year far enough ahead that the provider
 * has no forecast for it and answers from statistics alone.
 *
 * The hemisphere is not switched: `normal` is a statistical period, and
 * asking for both dates gets the cold end and the warm end of the year
 * whichever side of the equator they fall on. Naming them "winter" and
 * "summer" is northern-hemisphere shorthand for the caller's benefit; the
 * maths only cares that one is the cold one.
 */
const WINTER_PROBE = "2027-01-15";
const SUMMER_PROBE = "2027-07-15";

async function fetchNormalDay(
  lat: number,
  lng: number,
  date: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ lowC: number; highC: number }> {
  const parsed = await timelineJson(
    timelineUrl(lat, lng, date, "stats", apiKey),
    visualCrossingStatsSchema,
    "stats",
    fetchImpl,
  );
  const [day] = parsed.days;
  return { lowC: day.normal.tempmin[MEAN], highC: day.normal.tempmax[MEAN] };
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
    async climateNormals(lat, lng) {
      if (apiKey === undefined || apiKey === "") {
        throw new WeatherUnavailableError(
          "VISUAL_CROSSING_API_KEY is not configured",
        );
      }
      // Two records per call, and onboarding happens once per account.
      // Sequential rather than parallel: a failure on the first makes the
      // second pointless, and the caller degrades either way.
      const winter = await fetchNormalDay(
        lat,
        lng,
        WINTER_PROBE,
        apiKey,
        fetchImpl,
      );
      const summer = await fetchNormalDay(
        lat,
        lng,
        SUMMER_PROBE,
        apiKey,
        fetchImpl,
      );
      return {
        winterLowC: Math.min(winter.lowC, summer.lowC),
        summerHighC: Math.max(winter.highC, summer.highC),
      };
    },
    observation(lat, lng, at) {
      return fetchTimeline(lat, lng, at, apiKey, fetchImpl);
    },
    forecast(lat, lng, at) {
      return fetchTimeline(lat, lng, at, apiKey, fetchImpl);
    },
  };
}
