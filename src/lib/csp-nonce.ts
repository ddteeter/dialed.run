/**
 * The per-request script nonce the Content-Security-Policy names (OPS-8).
 *
 * TanStack Start writes its hydration state as inline `<script>`s, so a
 * policy that refuses inline script refuses the app — unless each of them
 * carries a nonce the policy also carries. `server.ts` mints one per
 * request, hands it to the framework as request context and to the
 * security headers; `router.tsx` reads it back as the router's
 * `ssr.nonce`, which is what stamps it on every script the framework and
 * React's stream renderer write.
 *
 * In `lib` rather than `modules/ops` because `router.tsx` is in the client
 * bundle and must reach it without `env`.
 */
import { z } from "zod";

/**
 * 128 bits, the floor CSP3 recommends for a nonce, from the platform's
 * CSPRNG.
 */
const NONCE_BYTES = 16;

/**
 * A fresh nonce, base64 — the alphabet CSP's `nonce-source` grammar
 * accepts.
 */
export function mintNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCodePoint(...bytes));
}

const nonceContext = z.object({ nonce: z.string().min(1) });

/**
 * Which side of the build the router is being made on, from Vite's
 * `import.meta.env` — passed in, like the context, so a test can say.
 */
interface BuildSide {
  DEV: boolean;
  SSR: boolean;
}

/**
 * The router's `ssr` option: the nonce from the framework's request
 * context, or no nonce at all.
 *
 * `readContext` is TanStack Start's `getGlobalStartContext`, passed in so
 * this stays importable by a test. It gives three answers, and they mean
 * different things:
 *
 * - **`undefined`, in the browser.** No nonce is needed there: the scripts
 *   it guards were written by the server.
 * - **It throws, on the server outside a request context.** One path
 *   reaches that on purpose: `createStartHandler`'s `handleRedirectResponse`
 *   builds the router after its middleware has returned, to turn a server
 *   function's `redirect()` into a `Location`. That router renders no
 *   document, so there is no script to stamp, and failing there would take
 *   every server-side redirect down with it. So it gets no nonce, quietly.
 * - **A context without a nonce, on the server inside a request.** That is
 *   a bug and nothing else: `server.ts` passes one on every request, and a
 *   page rendered without it has every inline script refused once the
 *   policy is enforced — no hydration, on every page. In dev it throws,
 *   so it is found on the first page load. In production it degrades to
 *   no nonce rather than failing the request: the page's own scripts then
 *   raise `script-src` reports, and the policy's `report-uri` sends them to
 *   Sentry, which is how that failure reaches a human.
 */
export function routerSsr(
  readContext: () => unknown,
  side: BuildSide,
): { nonce?: string } {
  let context: unknown;
  try {
    context = readContext();
  } catch {
    // Outside a request: the redirect path above.
    return {};
  }
  const parsed = nonceContext.safeParse(context);
  if (parsed.success) return parsed.data;
  if (side.DEV && side.SSR) {
    throw new Error(
      "The request context has no CSP nonce: server.ts must pass { context: { nonce } } to the Start handler.",
    );
  }
  return {};
}
