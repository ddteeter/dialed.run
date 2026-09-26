/**
 * Visual Crossing Timeline API adapter — the only `WeatherProvider`
 * implementation (docs/architecture.md: "Weather is an adapter"). Every
 * consumed field is zod-parsed (trust boundary); every call carries
 * `AbortSignal.timeout` (CLAUDE.md resilience law 4). `observation` and
 * `forecast` share one Timeline query — the API serves both past and
 * future dates from the same endpoint shape.
 *
 * **No retries here, by law 3.** Every call is one attempt, and the retry
 * lives where the state does: an observation that fails leaves the run's
 * `weather_status` at `pending`, and the hourly `weather-retry` cron
 * (`ops/crons.ts`) re-drives it; a normals read that fails degrades to the
 * latitude heuristic, because a starter list only orders rows and is not
 * worth a second ten-second wait on a signup.
 */
import { z } from "zod";

import { isTimeZone } from "../../../lib/dates";
import { UpstreamError } from "../../../lib/errors";
import {
  weatherObservationSchema,
  type ClimatePlace,
  type ResolvedPlace,
  type WeatherObservation,
  type WeatherProvider,
} from "../../../lib/contracts";

const TIMEOUT_MS = 10_000;

/**
 * Thrown for any adapter failure (network, timeout, non-2xx, malformed
 * body, missing key). Always a plain caught error for the caller — never a
 * crash — so `attachObservation` can treat it as retryable (CLAUDE.md law 5).
 */
export class WeatherUnavailableError extends UpstreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("WeatherUnavailableError", message, options);
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
  /**
   * The IANA zone of the location — at the response root, beside
   * `tzoffset` (D-96). It used to be stripped here, which is why every
   * date the app rendered was UTC. Any string at this layer: whether it
   * is a zone `Intl` accepts is decided when the observation is built,
   * where an invalid one is dropped rather than failing the whole
   * observation over a label.
   */
  timezone: z.string().optional(),
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

/**
 * Where the endpoint resolved a location to — at the response root, for
 * any request. A typed label is geocoded upstream (D-59), and these are
 * what it found: the coordinates, and its own name for the place.
 *
 * `resolvedAddress` is what the runner is shown and what is saved, because
 * a bare "Portland" has more than one answer and the typed text cannot say
 * which one was picked (PR #102 review). Required: a place with no name
 * cannot be shown back, so a body without one is the provider misbehaving.
 * Capped because it is saved and rendered, and a runaway upstream string
 * has no business in either.
 */
const visualCrossingPlaceSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  resolvedAddress: z.string().trim().min(1).max(200),
});

/**
 * The status Visual Crossing answers a location it cannot find with
 * ("Bad API Request: Invalid location parameter value."). It is an
 * answer, not an outage: the runner typed a place that is not one.
 */
const UNKNOWN_LOCATION = 400;

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
  location: string,
  date: string,
  include: "hours" | "stats" | "days",
  apiKey: string,
): URL {
  const url = new URL(
    `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${location}/${date}`,
  );
  url.searchParams.set("unitGroup", "metric");
  url.searchParams.set("include", include);
  url.searchParams.set("contentType", "json");
  url.searchParams.set("key", apiKey);
  return url;
}

/**
 * The path segment the Timeline endpoint resolves a place from: `lat,lng`
 * verbatim, or a typed label, which it geocodes upstream (verified
 * 2026-09-16: `Omaha,NE` answers as 41.26, −95.94 with the same `normal`
 * block as the coordinates do).
 *
 * The label is a runner's own text landing in a URL path, so it is
 * encoded rather than trusted — a `/` in it would otherwise be read as a
 * second segment and the date as a third.
 */
function locationPath(place: ClimatePlace): string {
  return place.kind === "coordinates"
    ? `${String(place.lat)},${String(place.lng)}`
    : labelPath(place.label);
}

/**
A typed place as a path segment: encoded, so `/` and `,` stay text.
*/
function labelPath(label: string): string {
  return encodeURIComponent(label);
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
  const response = await timelineFetch(url, what, fetchImpl);
  return await timelineBody(response, schema, what);
}

/**
The request itself, under the timeout, with a failure named for what it was.
*/
async function timelineFetch(
  url: URL,
  what: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new WeatherUnavailableError(
      `Visual Crossing ${what} request failed`,
      { cause: error },
    );
  }
}

/**
 * The second half of every read: refuse a non-2xx, take the body as
 * `unknown`, parse it. Separate so the place lookup, which answers one
 * status itself before this runs, cannot skip either step.
 */
async function timelineBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  what: string,
): Promise<z.output<TSchema>> {
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
    timelineUrl(
      locationPath({ kind: "coordinates", lat, lng }),
      at.toISOString().slice(0, 10),
      "hours",
      apiKey,
    ),
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
    // Degrade, don't fail (law 5): an unusable zone costs the run its
    // local date, not its weather. Spread rather than `timeZone:
    // undefined`, which `exactOptionalPropertyTypes` would reject.
    ...(isTimeZone(parsed.timezone) && { timeZone: parsed.timezone }),
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
 * Where a typed place is, or nothing when the endpoint cannot find it.
 *
 * One daily read for today, the smallest request that carries the
 * resolved coordinates at its root. A 400 is the endpoint saying "no such
 * place" and comes back as `undefined`; anything else — no key, the
 * network, a timeout, another status, a body without coordinates — is
 * the provider being unavailable, and throws like every other read here.
 * So is a body without a name for the place, since the name is what the
 * runner is shown.
 */
async function resolveLabel(
  label: string,
  today: Date,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<ResolvedPlace | undefined> {
  if (apiKey === undefined || apiKey === "") {
    throw new WeatherUnavailableError(
      "VISUAL_CROSSING_API_KEY is not configured",
    );
  }
  const url = timelineUrl(
    labelPath(label),
    today.toISOString().slice(0, 10),
    "days",
    apiKey,
  );
  const probe = await timelineFetch(url, "place", fetchImpl);
  if (probe.status === UNKNOWN_LOCATION) return undefined;
  const place = await timelineBody(probe, visualCrossingPlaceSchema, "place");
  return {
    lat: place.latitude,
    lng: place.longitude,
    address: place.resolvedAddress,
  };
}

/**
 * Mid-January and mid-July of whatever year it is.
 *
 * **The year is irrelevant to the answer, and that was measured rather
 * than assumed** (2026-09-16). `normal` is a statistic over the provider's
 * period keyed by day of year: 15 January answers Minneapolis
 * `tempmin [-26.4, -12.1, 0.4]` whether the request says 2025 (history),
 * 2027 or 2029, and a date inside the 15-day forecast window carries the
 * block too. An earlier version pinned `2027` on the belief that only a
 * date past the forecast horizon was answered from statistics — wrong,
 * and it read as a time bomb for the day 2027 arrived. The year comes from
 * the clock so nobody has to re-verify that; the day is what matters.
 *
 * The hemisphere is not switched: asking for both dates gets the cold end
 * and the warm end of the year whichever side of the equator they fall
 * on. Naming them "winter" and "summer" is northern-hemisphere shorthand
 * for the caller's benefit; the maths only cares that one is the cold one.
 */
const WINTER_PROBE_DAY = "01-15";
const SUMMER_PROBE_DAY = "07-15";

function probeDate(now: Date, monthDay: string): string {
  return `${String(now.getUTCFullYear())}-${monthDay}`;
}

async function fetchNormalDay(
  location: string,
  date: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ lowC: number; highC: number }> {
  const parsed = await timelineJson(
    timelineUrl(location, date, "stats", apiKey),
    visualCrossingStatsSchema,
    "stats",
    fetchImpl,
  );
  const [day] = parsed.days;
  return { lowC: day.normal.tempmin[MEAN], highC: day.normal.tempmax[MEAN] };
}

/**
 * Builds the live adapter. `fetchImpl` is injectable so unit tests never
 * touch the network (default is the ambient global `fetch`), and `now` so
 * a test can pin which year the normals probes ask for.
 */
export function createVisualCrossingProvider(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): WeatherProvider {
  return {
    async climateNormals(place) {
      if (apiKey === undefined || apiKey === "") {
        throw new WeatherUnavailableError(
          "VISUAL_CROSSING_API_KEY is not configured",
        );
      }
      // Two records per call, and onboarding happens once per account.
      // Sequential rather than parallel: a failure on the first makes the
      // second pointless, and the caller degrades either way.
      const location = locationPath(place);
      const today = now();
      const winter = await fetchNormalDay(
        location,
        probeDate(today, WINTER_PROBE_DAY),
        apiKey,
        fetchImpl,
      );
      const summer = await fetchNormalDay(
        location,
        probeDate(today, SUMMER_PROBE_DAY),
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
    resolvePlace(label) {
      return resolveLabel(label, now(), apiKey, fetchImpl);
    },
  };
}
