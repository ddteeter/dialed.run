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

export class StravaApiError extends Error {
  /**
   * True only when Strava said the grant itself is no longer valid — 400
   * or 401 on a token exchange, which is what a user revoking access looks
   * like. Everything else (5xx, a timeout, DNS, a parse failure) is
   * transient and must not be treated as "reconnect your account".
   */
  readonly isTerminal: boolean;

  constructor(message: string, isTerminal: boolean) {
    super(message);
    this.name = "StravaApiError";
    this.isTerminal = isTerminal;
  }
}

/**
 * Terminal for anything that came back as a revoked grant, false for
 * everything else — including a non-StravaApiError, since a TypeError from
 * fetch is the most transient failure there is.
 */
export function isTerminalStravaError(error: unknown): boolean {
  return error instanceof StravaApiError && error.isTerminal;
}

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
    throw new StravaApiError(
      `Strava responded ${String(response.status)}`,
      response.status === 400 || response.status === 401,
    );
  }
  return response.json();
}

/**
 * The configured Strava credentials, or `undefined` when the deployment
 * has none.
 *
 * Here rather than inline in ./api-from-env because that file reads
 * bindings, and a test inside the isolate cannot change a binding: the
 * decision would only ever run with both values unset. Half a credential
 * is a misconfiguration that fails at the OAuth redirect rather than at
 * boot, so both directions are worth pinning.
 */
export function stravaConfigFrom(
  clientId: string | undefined,
  clientSecret: string | undefined,
): StravaConfig | undefined {
  if (clientId === undefined || clientSecret === undefined) return undefined;
  return { clientId, clientSecret };
}

/**
 * A token-grant round trip: post the credentials plus the grant, parse the
 * answer, or refuse it.
 *
 * `exchangeCode` and `refreshToken` are the same call with a different
 * grant and a different schema — the credentials, the `safeParse`, and the
 * refusal were written out twice.
 *
 * **The `false` is the fact worth having in one place.** `StravaApiError`'s
 * second argument says whether the grant is gone, and a response we cannot
 * parse never means that: it means a bug on our side or a change on
 * Strava's. Getting it wrong in either direction is a real failure — `true`
 * here would silently disconnect a working account on a Strava schema
 * change (resilience law 5: degrade, don't destroy), while `true` missing
 * from `postForm`'s 400/401 would retry a grant the user actually revoked.
 */
async function tokenGrant<TSchema extends z.ZodType>(
  config: StravaConfig,
  grant: Record<string, string>,
  schema: TSchema,
  malformed: string,
): Promise<z.output<TSchema>> {
  const json = await postForm(TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...grant,
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new StravaApiError(malformed, false);
  return parsed.data;
}

export function createStravaApi(config: StravaConfig): StravaApi {
  return {
    async exchangeCode(code) {
      const data = await tokenGrant(
        config,
        { code, grant_type: "authorization_code" },
        exchangeResponseSchema,
        "Malformed token-exchange response.",
      );
      return {
        athleteId: String(data.athlete.id),
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at,
      };
    },
    async refreshToken(refreshToken) {
      const data = await tokenGrant(
        config,
        { refresh_token: refreshToken, grant_type: "refresh_token" },
        tokenResponseSchema,
        "Malformed token-refresh response.",
      );
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at,
      };
    },
    async deauthorize(accessToken) {
      const response = await fetch(
        `${DEAUTHORIZE_URL}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!response.ok) {
        throw new StravaApiError(
          `Strava responded ${String(response.status)}`,
          false, // deauthorize is best-effort; the caller degrades either way
        );
      }
    },
  };
}
