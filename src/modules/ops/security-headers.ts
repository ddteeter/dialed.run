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
 * **Inline script runs on a nonce, never on `'unsafe-inline'`.** TanStack
 * Start writes its hydration state as inline `<script>`s. `server.ts`
 * mints a nonce per request (`lib/csp-nonce`), hands it to the framework,
 * which stamps it on every script it and React's stream renderer write
 * (the router's `ssr.nonce`, read in `router.tsx`), and names it here. An
 * inline script without it — one nobody wrote, or an injected one — is a
 * report. Only a response the Worker generates has a nonce; the static
 * assets' copy in `public/_headers` names none, and needs none, because
 * none of those files is a document that runs script.
 *
 * **A page the edge may store runs on hashes instead** (design 160): a
 * stored page would hand one nonce to every visitor for as long as it is
 * kept. Its policy names the SHA-256 of each inline script in that page
 * (`./inline-script-hashes`), and the page carries no nonce at all.
 *
 * **Nothing else may be stored** (design 160, Workers Caching): a Worker
 * response with no `Cache-Control` is cached by heuristic freshness, two
 * hours for a 200. So every response that does not say otherwise leaves
 * with `private, no-store`, set here beside the security headers.
 * Framing, object embeds, base-tag hijacking and foreign form targets are
 * refused regardless.
 */

/**
 * Report-only until the reports are quiet; then this becomes
 * `Content-Security-Policy` (OPS-8).
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/**
 * How a response's policy admits inline script: by the request's nonce,
 * or, for a page the edge may store, by the hash of each inline script
 * (base64 SHA-256 digests).
 */
export type InlineScripts =
  { readonly nonce: string } | { readonly hashes: readonly string[] };

/**
 * What a response that names no `Cache-Control` of its own leaves with:
 * no cache, the edge's included, keeps it.
 */
export const UNSTORED = "private, no-store";

/**
 * Turnstile's widget: its script, and the iframe the challenge runs in
 * (OPS-5).
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The policy, one directive per line so a diff shows what changed.
 *
 * - `'nonce-…'` or `'sha256-…'`s: the request's script nonce, or a stored
 *   page's script hashes, when the Worker generated the response (see
 *   above). Script files are admitted by `'self'` either way.
 * - `'wasm-unsafe-eval'`: MediaPipe's face detector compiles WebAssembly
 *   in the browser (`safety/blur/detect.ts`), which a CSP refuses without
 *   it. It permits compiling wasm, not `eval` of JavaScript.
 * - No `'unsafe-eval'`: zod would use it to compile its parsers, and runs
 *   jitless instead (`lib/browser/zod-jitless`, an inline head script the root
 *   route writes, so it runs before any module).
 *   The e2e check in `e2e/desk/desk-door.spec.ts` fails on any report.
 * - `blob:` workers: MediaPipe runs its model in a worker it builds from a
 *   blob.
 * - `img-src blob: data:`: photo previews before upload are object URLs.
 * - `form-action`: Google and Strava sign-in leave by redirect, which a
 *   browser checks against `form-action` when a form started it.
 */
export function contentSecurityPolicy(
  reportUri: string | undefined,
  inline?: InlineScripts,
): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self'${inlineScriptSources(inline)} 'wasm-unsafe-eval' ${TURNSTILE_ORIGIN}`,
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
 * The `script-src` sources that admit inline script, each with its
 * leading space: none, the nonce, or one per script hash.
 */
function inlineScriptSources(inline: InlineScripts | undefined): string {
  if (inline === undefined) return "";
  if ("nonce" in inline) return ` 'nonce-${inline.nonce}'`;
  return inline.hashes.map((hash) => ` 'sha256-${hash}'`).join("");
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
  inline?: InlineScripts,
): readonly (readonly [string, string])[] {
  const csp = contentSecurityPolicy(reportUri, inline);
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
 * embeddable card, say) is not overridden. That includes `Cache-Control`:
 * a public page's, or a photo's `private, max-age=…`, stands, and only a
 * response that names none gets `UNSTORED`. That one is not in
 * `securityHeaders`, because `public/_headers` copies that list onto the
 * static assets, which browsers and the edge should cache.
 */
export function withSecurityHeaders(
  response: Response,
  reportUri: string | undefined,
  inline?: InlineScripts,
): Response {
  const secured = new Response(response.body, response);
  const headers: readonly (readonly [string, string])[] = [
    ...securityHeaders(reportUri, inline),
    ["Cache-Control", UNSTORED],
  ];
  for (const [name, value] of headers) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}
