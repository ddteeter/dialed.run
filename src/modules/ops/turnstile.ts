/**
 * Turnstile's server half (OPS-5, audit §3.6): is this token a real,
 * unspent challenge answer for our site? One `siteverify` call.
 *
 * **Fails closed, on every path.** A missing token, a missing secret, a
 * slow or unreachable upstream and a body that does not parse all refuse,
 * because the check exists to stop a script and a script is exactly what
 * benefits from a check that opens when it breaks. The cost is that a
 * Turnstile outage blocks sign-up; the shell below reports those so a
 * person finds out (law 6).
 *
 * The widget is `ui/Turnstile.tsx`. Placing both on sign-up and request
 * access is task 126's.
 */
import { z } from "zod";

import { env } from "../../env";
import { captureException } from "./sentry";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
Law 4: every outbound fetch is bounded.
*/
const TIMEOUT_MS = 10_000;

/**
 * Cloudflare's documented cap on a token's length. Anything longer is not
 * a token, and is refused without spending a call on it.
 */
const MAX_TOKEN_LENGTH = 2048;

/**
 * The part of the answer the decision reads. `success` is the verdict;
 * `error-codes` says why not (`timeout-or-duplicate` is an expired or
 * already-spent token, `invalid-input-response` a forged one).
 */
const siteverifySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).default([]),
});

/**
Why a token was refused. The first four are ours, not the visitor's.
*/
export type TurnstileRefusal =
  | "missing-secret"
  | "unreachable"
  | "upstream-status"
  | "malformed-answer"
  | "missing-token"
  | "rejected";

export type TurnstileVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: TurnstileRefusal;
      /**
      Cloudflare's own codes, when it gave any.
      */
      readonly codes: readonly string[];
    };

function refuse(
  reason: TurnstileRefusal,
  codes: readonly string[] = [],
): TurnstileVerdict {
  return { ok: false, reason, codes };
}

/**
 * The decision, with the secret and the fetch handed in, so a test can
 * reach every branch without a binding or the network.
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  remoteIp: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileVerdict> {
  if (secret === undefined || secret === "") return refuse("missing-secret");
  if (token === undefined || token === "" || token.length > MAX_TOKEN_LENGTH) {
    return refuse("missing-token");
  }
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== undefined) body.set("remoteip", remoteIp);
  let response: Response;
  let payload: unknown;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Read inside the same `try`: a body that is not JSON at all is as
    // much "no answer" as a timeout. An error status is read by nobody.
    payload = response.ok ? await response.json() : undefined;
  } catch {
    return refuse("unreachable");
  }
  if (!response.ok) return refuse("upstream-status");
  const parsed = siteverifySchema.safeParse(payload);
  if (!parsed.success) return refuse("malformed-answer");
  return parsed.data.success
    ? { ok: true }
    : refuse("rejected", parsed.data["error-codes"]);
}

/**
 * Refusals that are about us rather than the visitor: a person has to fix
 * the deployment or wait out Cloudflare, and nobody is told otherwise.
 */
const OUR_FAULT: ReadonlySet<TurnstileRefusal> = new Set([
  "missing-secret",
  "unreachable",
  "upstream-status",
  "malformed-answer",
]);

/**
 * The call a server function makes: the verdict against the deployed
 * secret, with our own failures sent to Sentry. Never the token or the
 * secret in the report (law 7) — the reason is enough to act on.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string | undefined,
): Promise<TurnstileVerdict> {
  const verdict = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    token,
    remoteIp,
  );
  reportIfOurs(verdict);
  return verdict;
}

/**
Sends a refusal that is ours to Sentry; a visitor's is not an error.
*/
export function reportIfOurs(
  verdict: TurnstileVerdict,
  report: typeof captureException = captureException,
): void {
  if (verdict.ok || !OUR_FAULT.has(verdict.reason)) return;
  report(new Error(`turnstile verification failed: ${verdict.reason}`), {
    surface: "turnstile",
    reason: verdict.reason,
  });
}

/**
 * The widget's public site key, or `undefined` when none is configured —
 * in which case the widget renders nothing and verification refuses.
 */
export function turnstileSiteKey(): string | undefined {
  const key = env.TURNSTILE_SITE_KEY;
  return key === "" ? undefined : key;
}
