/**
 * All Strava HTTP behind one seam (design doc 102). Credentials don't
 * exist yet — `createStravaApi` is the only thing that touches the
 * network, so the OAuth logic in ./oauth.ts is fully unit-testable
 * against a hand-rolled `StravaApi` fake. Every outbound fetch gets a
 * timeout and a zod parse (resilience law 4) — a slow or malformed
 * upstream must never wedge a request.
 */
import { z } from "zod";

export interface StravaConfig {
  clientId: string;
  clientSecret: string;
}

export interface ExchangedTokens {
  athleteId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface StravaApi {
  exchangeCode(code: string): Promise<ExchangedTokens>;
  refreshToken(refreshToken: string): Promise<RefreshedTokens>;
  /**
  Best-effort revoke on disconnect; caller degrades on failure.
  */
  deauthorize(accessToken: string): Promise<void>;
}

const TOKEN_URL = "https://www.strava.com/oauth/token";
const DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
const FETCH_TIMEOUT_MS = 10_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int().positive(),
});

const exchangeResponseSchema = tokenResponseSchema.extend({
  athlete: z.object({ id: z.number().int() }),
});

class StravaApiError extends Error {}

async function postForm(
  url: string,
  body: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new StravaApiError(`Strava responded ${String(response.status)}`);
  }
  return response.json();
}

export function createStravaApi(config: StravaConfig): StravaApi {
  return {
    async exchangeCode(code) {
      const json = await postForm(TOKEN_URL, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
      });
      const parsed = exchangeResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new StravaApiError("Malformed token-exchange response.");
      }
      return {
        athleteId: String(parsed.data.athlete.id),
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token,
        expiresAt: parsed.data.expires_at,
      };
    },
    async refreshToken(refreshToken) {
      const json = await postForm(TOKEN_URL, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const parsed = tokenResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new StravaApiError("Malformed token-refresh response.");
      }
      return {
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token,
        expiresAt: parsed.data.expires_at,
      };
    },
    async deauthorize(accessToken) {
      const response = await fetch(
        `${DEAUTHORIZE_URL}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!response.ok) {
        throw new StravaApiError(`Strava responded ${String(response.status)}`);
      }
    },
  };
}
