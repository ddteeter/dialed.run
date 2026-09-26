/**
 * The security headers (OPS-8, audit §3.9), in two places that must agree:
 * `server.ts` sets them around the framework's fetch handler, so a route
 * cannot forget them, and `public/_headers` sets them on the static assets,
 * which Cloudflare answers without running the Worker. A test pins the
 * second to this file. A request that throws gets the platform's own error
 * page, and none of them.
 *
 * Pure of bindings, so the ui project's test can import it; the shell that
 * reads the DSN is ./secure-response.
 *
 * **The CSP ships report-only.** A policy that blocks is a policy that can
 * take the app down on a script origin nobody listed, so it reports first
 * and is enforced once the reports are quiet — renaming `CSP_HEADER` to
 * `Content-Security-Policy` is that step. It reports to Sentry's security endpoint, derived from the
 * DSN, so a violation lands where every other failure does.
 *
 * **Inline scripts are allowed, and that is the known gap.** TanStack
 * Start writes its hydration state as inline `<script>`s. Refusing them
 * needs a per-request nonce threaded through `router.tsx` (the router's
 * `ssr.nonce`), which is not this lane's file; until then the policy
 * allows inline script and says so here rather than pretending otherwise.
 * Framing, object embeds, base-tag hijacking and foreign form targets are
 * refused regardless.
 */

/**
 * Report-only until the reports are quiet; then this becomes
 * `Content-Security-Policy` (OPS-8).
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/**
 * Turnstile's widget: its script, and the iframe the challenge runs in
 * (OPS-5).
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The policy, one directive per line so a diff shows what changed.
 *
 * - `'wasm-unsafe-eval'`: MediaPipe's face detector compiles WebAssembly
 *   in the browser (`safety/blur/detect.ts`), which a CSP refuses without
 *   it. It permits compiling wasm, not `eval` of JavaScript.
 * - `blob:` workers: MediaPipe runs its model in a worker it builds from a
 *   blob.
 * - `img-src blob: data:`: photo previews before upload are object URLs.
 * - `form-action`: Google and Strava sign-in leave by redirect, which a
 *   browser checks against `form-action` when a form started it.
 */
export function contentSecurityPolicy(reportUri: string | undefined): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com https://www.strava.com",
  ];
  if (reportUri !== undefined) directives.push(`report-uri ${reportUri}`);
  return directives.join("; ");
}

/**
 * Sentry's CSP report endpoint for a DSN, or `undefined` for none.
 *
 * A DSN is `https://<key>@<host>/<project>`; the endpoint is
 * `https://<host>/api/<project>/security/?sentry_key=<key>` (Sentry's
 * "Security Policy Reporting" docs).
 */
export function sentryReportUri(dsn: string | undefined): string | undefined {
  let url: URL;
  try {
    // `String(undefined)` is not a URL either, so an unset DSN takes the
    // same refusal as a malformed one: no report-uri, and never a throw —
    // this runs on every response.
    url = new URL(String(dsn));
  } catch {
    return undefined;
  }
  const project = url.pathname.slice(1);
  if (project === "" || url.username === "") return undefined;
  return `${url.protocol}//${url.host}/api/${project}/security/?sentry_key=${url.username}`;
}

/**
 * The headers, as a list, for the response wrapper and for the test.
 *
 * HSTS without `preload`: preload is a submission to browsers that is slow
 * to undo, and the domain is not chosen yet (deployment plan). No
 * `includeSubDomains` for the same reason — the zone may carry hosts this
 * app does not own.
 *
 * Permissions-Policy turns off what the app never asks for, and keeps
 * geolocation for its own origin: onboarding offers "use my location".
 */
export function securityHeaders(
  reportUri: string | undefined,
): readonly (readonly [string, string])[] {
  const csp = contentSecurityPolicy(reportUri);
  return [
    [CSP_HEADER, csp],
    ["X-Frame-Options", "DENY"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
    ],
    ["Strict-Transport-Security", "max-age=31536000"],
  ];
}

/**
 * The response with the headers set. A response's headers can be
 * immutable (one passed through from `fetch`), so this copies the
 * response rather than editing it; the body streams through untouched.
 * A header the route already set wins — a route that knows better (an
 * embeddable card, say) is not overridden.
 */
export function withSecurityHeaders(
  response: Response,
  reportUri: string | undefined,
): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of securityHeaders(reportUri)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}
