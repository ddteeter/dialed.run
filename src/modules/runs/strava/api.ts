/**
 * All Strava HTTP behind one seam (design doc 102). `createStravaApi` is
 * the only thing that touches the network, so the OAuth logic in
 * ./oauth.ts is fully unit-testable against a hand-rolled `StravaApi`
 * fake. Every outbound fetch gets a timeout and a zod parse (resilience
 * law 4) — a slow or malformed upstream must never wedge a request.
 *
 * **Two calls, and neither needs a live access token** (task 127). We
 * never read activity data, so the only thing a stored grant is ever used
 * for is revoking it, and `/oauth/revoke` accepts the refresh token. The
 * refresh grant this file used to make had no production caller (finding
 * 0.1) and now has no reason to exist.
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

/**
 * A token to revoke, and which kind it is — Strava's `token_type_hint`.
 */
export interface StoredToken {
  token: string;
  kind: "access_token" | "refresh_token";
}

export interface StravaApi {
  exchangeCode(code: string): Promise<ExchangedTokens>;
  /**
   * Revoke a grant through `POST /oauth/revoke` (STR-5), with either of its
   * tokens. Strava: "Revoking a refresh token will also revoke any
   * associated access tokens, and vice versa", and it answers 200 "whether
   * or not the token was found" — so a grant that is already dead settles
   * exactly as a live one does.
   */
  revoke(token: StoredToken): Promise<void>;
}

const TOKEN_URL = "https://www.strava.com/oauth/token";
/**
 * The successor to `/oauth/deauthorize`, which Strava stops supporting on
 * 1 June 2027. Authenticated with HTTP Basic client credentials.
 */
const REVOKE_URL = "https://www.strava.com/oauth/revoke";
const FETCH_TIMEOUT_MS = 10_000;

const exchangeResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int().positive(),
  athlete: z.object({ id: z.number().int() }),
});

/**
 * A refusal body, as far as we read one: Strava's errors carry a
 * `message`, and nothing else in them is needed.
 */
const refusalSchema = z.object({ message: z.string() });

export class StravaApiError extends Error {
  /**
   * What Strava answered, or undefined when the failure was ours — a body
   * we could not read.
   */
  readonly status: number | undefined;

  /**
   * The refusal's own `message`, when it sent one.
   */
  readonly refusal: string | undefined;

  constructor(message: string, status?: number, refusal?: string) {
    super(message);
    this.name = "StravaApiError";
    this.status = status;
    this.refusal = refusal;
  }
}

/**
 * A refusal's body, read as JSON only when it says it is JSON. A refusal is
 * not promised to be JSON — a proxy's 502 is HTML — and one that is not is
 * still a refusal, with no message of its own.
 */
async function refusalBody(response: Response): Promise<unknown> {
  const isJson =
    response.headers.get("content-type")?.includes("json") === true;
  return isJson ? response.json() : undefined;
}

/**
 * A refused response as an error, keeping Strava's own `message` when the
 * body has one.
 */
async function refusedBy(response: Response): Promise<StravaApiError> {
  const parsed = refusalSchema.safeParse(await refusalBody(response));
  return new StravaApiError(
    `Strava responded ${String(response.status)}`,
    response.status,
    parsed.success ? parsed.data.message : undefined,
  );
}

async function post(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string>,
): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw await refusedBy(response);
  return response;
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
 * HTTP Basic credentials for the app — how `/oauth/revoke` authenticates
 * its caller, where the token endpoint takes the same pair in the form.
 */
function basicAuth(config: StravaConfig): string {
  const pair = `${config.clientId}:${config.clientSecret}`;
  return `Basic ${btoa(pair)}`;
}

export function createStravaApi(config: StravaConfig): StravaApi {
  return {
    async exchangeCode(code) {
      const response = await post(
        TOKEN_URL,
        {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: "authorization_code",
        },
        {},
      );
      const parsed = exchangeResponseSchema.safeParse(await response.json());
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
    async revoke({ token, kind }) {
      // The body is empty on success, and nothing in it is read.
      await post(
        REVOKE_URL,
        { token, token_type_hint: kind },
        { authorization: basicAuth(config) },
      );
    },
  };
}
