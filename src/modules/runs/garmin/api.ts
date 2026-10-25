/**
 * Garmin Connect's Personal API, as phase 1 of plan 152 calls it: an
 * access token from the key, the runner's recent runs, and one run's
 * original `.FIT` (shapes from Garmin's published OpenAPI spec and the
 * 2026-10-24 spike; see plan 152's open questions).
 *
 * One attempt per call, ten seconds each, and every answer parsed (laws 3
 * and 4). Every way a call can fail is one `GarminUnavailable`: the runner
 * sees one sentence ("Garmin didn't answer.") and taps again, and the
 * `reason` is for Sentry. Neither a token nor a response body ever goes in
 * it (law 7).
 *
 * The token is fetched per call, not cached: it lives 24 hours, but rate
 * limits are undocumented and nothing here polls, so two requests per tap
 * is cheaper than the state a cache would need.
 */
import { z } from "zod";

import { onlyFileIn } from "./unzip";

export const GARMIN_PERSONAL_ORIGIN = "https://personal.connectapi.garmin.com";

const TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";
const LIST_PATH = "/activitylist-service/activities/search/activities";
const DOWNLOAD_PATH = "/download-service/files/activity/";
const TIMEOUT_MS = 10_000;

export class GarminUnavailable extends Error {
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super("Garmin didn't answer.", options);
    this.name = "GarminUnavailable";
    this.reason = reason;
  }
}

/**
One run as the picker lists it.
*/
export interface GarminActivity {
  activityId: string;
  /**
  Epoch seconds.
  */
  startedAt: number;
  distanceM: number;
  /**
  Elapsed, as the run's own `duration_s` is (D-111).
  */
  durationS: number;
}

// The summary has 95 fields; these are the ones the picker reads. Heart
// rate, power and training effect are among the rest and are never read.
const activitySchema = z.object({
  activityId: z.number().int().positive(),
  // "yyyy-MM-dd HH:mm:ss", in UTC, with no offset written.
  startTimeGMT: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u),
  distance: z.number().nonnegative(),
  duration: z.number().positive(),
});
const activityListSchema = z.array(activitySchema);

// A JWT: three base64url segments.
const tokenSchema = z
  .string()
  .trim()
  .regex(/^[\w-]+\.[\w-]+\.[\w-]+$/u);

function activityFrom(summary: z.infer<typeof activitySchema>): GarminActivity {
  return {
    activityId: String(summary.activityId),
    startedAt: Date.parse(`${summary.startTimeGMT.replace(" ", "T")}Z`) / 1000,
    distanceM: summary.distance,
    durationS: Math.round(summary.duration),
  };
}

export interface GarminApi {
  /**
  The runner's most recent runs, newest first.
  */
  recentRuns(limit: number): Promise<GarminActivity[]>;
  /**
  One run's original `.FIT`, out of the zip it comes in.
  */
  fitFile(activityId: string): Promise<ArrayBuffer>;
}

export function createGarminApi(
  apiKey: string,
  origin: string = GARMIN_PERSONAL_ORIGIN,
  fetchImpl: typeof fetch = fetch,
): GarminApi {
  async function call(
    step: string,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new GarminUnavailable(`${step}: unreachable`, { cause: error });
    }
    if (!response.ok) {
      throw new GarminUnavailable(`${step}: HTTP ${String(response.status)}`);
    }
    return response;
  }

  async function bearer(): Promise<string> {
    const response = await call("token", TOKEN_PATH, {
      method: "POST",
      headers: { Authorization: `ApiKey ${apiKey}` },
    });
    // Plain text, not JSON (the spike).
    const token = tokenSchema.safeParse(await response.text());
    if (!token.success) throw new GarminUnavailable("token: not a token");
    return `Bearer ${token.data}`;
  }

  return {
    async recentRuns(limit) {
      const query = new URLSearchParams({
        start: "0",
        limit: String(limit),
        // Includes trail and treadmill running (the spike).
        activityType: "running",
      });
      const response = await call("list", `${LIST_PATH}?${query}`, {
        headers: { Authorization: await bearer() },
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new GarminUnavailable("list: not JSON", { cause: error });
      }
      const parsed = activityListSchema.safeParse(body);
      if (!parsed.success) {
        throw new GarminUnavailable("list: unexpected shape", {
          cause: parsed.error,
        });
      }
      return parsed.data.map((summary) => activityFrom(summary));
    },

    async fitFile(activityId) {
      const response = await call(
        "download",
        `${DOWNLOAD_PATH}${encodeURIComponent(activityId)}`,
        { headers: { Authorization: await bearer() } },
      );
      try {
        return await onlyFileIn(await response.arrayBuffer());
      } catch (error) {
        throw new GarminUnavailable("download: not one file", {
          cause: error,
        });
      }
    },
  };
}
