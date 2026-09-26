import { vi } from "vitest";

/**
 * Shaped from Visual Crossing's documented Timeline API response (metric,
 * a single datetime with `include=current`) — recorded from their
 * published docs, not a live call: no API key exists yet
 * (docs/designs/103-weather.md). Re-record against a live response once
 * the secret lands.
 *
 * Three hours of one Minneapolis morning, 2026-01-15. A single-datetime
 * request answers with the nearest of them as `currentConditions`.
 */
export const visualCrossingHours = [
  {
    datetime: "06:00:00",
    datetimeEpoch: 1_768_482_000,
    temp: -5.6,
    feelslike: -11.2,
    humidity: 81.4,
    windspeed: 12.6,
    precip: 0,
    conditions: "Clear",
  },
  {
    datetime: "07:00:00",
    datetimeEpoch: 1_768_485_600,
    temp: -4.8,
    feelslike: -9.7,
    humidity: 80.1,
    windspeed: 14.2,
    precip: 0.2,
    conditions: "Overcast",
  },
  {
    // No `precip` key at all — Visual Crossing omits it as often as it
    // sends an explicit null; the adapter must default either way.
    datetime: "08:00:00",
    datetimeEpoch: 1_768_489_200,
    temp: -3.9,
    feelslike: -8.5,
    humidity: 78.6,
    windspeed: 15.8,
    conditions: "Snow, Overcast",
  },
] as const;

/**
One hour's elements, as Visual Crossing names them.
*/
interface VisualCrossingHour {
  readonly datetime: string;
  readonly datetimeEpoch: number;
  readonly temp: number;
  readonly feelslike: number;
  readonly humidity: number;
  readonly windspeed: number;
  readonly precip?: number;
  readonly conditions: string;
}

/**
The response body for one hour: one record, `queryCost: 1`.
*/
export function visualCrossingCurrentBody(
  hour: VisualCrossingHour,
): Record<string, unknown> {
  return {
    queryCost: 1,
    latitude: 44.98,
    longitude: -93.27,
    resolvedAddress: "Minneapolis, MN, United States",
    address: "44.98,-93.27",
    timezone: "America/Chicago",
    tzoffset: -6,
    currentConditions: hour,
  };
}

/**
The 07:00 answer, for tests that need one well-formed body.
*/
export const visualCrossingObservationFixture = visualCrossingCurrentBody(
  visualCrossingHours[1],
);

/**
 * The hour Visual Crossing would answer for a moment: the nearest one, the
 * earlier on a tie.
 */
function nearestHour(epochSeconds: number): VisualCrossingHour {
  let best: VisualCrossingHour = visualCrossingHours[0];
  for (const hour of visualCrossingHours) {
    if (
      Math.abs(hour.datetimeEpoch - epochSeconds) <
      Math.abs(best.datetimeEpoch - epochSeconds)
    ) {
      best = hour;
    }
  }
  return best;
}

/**
 * The URL a fetch was called with, whatever shape the caller passed it in.
 */
export function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

/**
 * The answer for one request: the hour at the epoch seconds the adapter
 * put at the end of the path.
 */
function answerFor(input: RequestInfo | URL): Response {
  const epoch = Number(requestUrl(input).pathname.split("/").at(-1));
  return Response.json(visualCrossingCurrentBody(nearestHour(epoch)));
}

/**
 * A stand-in for the Timeline endpoint: answers each request with that
 * moment's hour, a fresh Response per call (a body can only be read once).
 * Hands back the spy so a test can count calls and read the URLs.
 */
export function mockVisualCrossing() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input) => Promise.resolve(answerFor(input)));
}
