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
 * The router's `ssr` option: the nonce from the framework's request
 * context, or no nonce at all.
 *
 * `readContext` is TanStack Start's `getGlobalStartContext`, passed in so
 * this stays importable by a test. It answers `undefined` in the browser,
 * where no nonce is needed (the scripts it guards were written by the
 * server), and it **throws** on the server when no request context is
 * active — which `createStartHandler` can reach when it resolves a
 * redirect after its middleware has returned. Either way the router is
 * built without a nonce rather than the request failing: a missing nonce
 * costs a CSP report, a throw here costs the page.
 */
export function routerSsr(readContext: () => unknown): { nonce?: string } {
  let context: unknown;
  try {
    context = readContext();
  } catch {
    return {};
  }
  const parsed = nonceContext.safeParse(context);
  return parsed.success ? { nonce: parsed.data.nonce } : {};
}
