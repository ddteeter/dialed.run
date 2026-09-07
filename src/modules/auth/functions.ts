import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "./instance";

/**
Session for the current request; null when signed out.
*/
export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const headers = getRequestHeaders();
    return auth.api.getSession({ headers });
  },
);

/**
 * The route-loader half of the auth gate.
 *
 * Loaders want a redirect, not a thrown error — `requireUserId` (from the
 * barrel) is the server-function half. Both exist so no route hand-rolls
 * `getSession()` + `redirect()`, which is how lane 101 and lane 104 ended
 * up with two different idioms and one route that bypassed the module
 * entirely.
 *
 * Returns a non-null session, so a loader can use the result directly
 * instead of re-narrowing after the guard.
 */
export async function requireSession(): Promise<
  NonNullable<Awaited<ReturnType<typeof getSession>>>
> {
  const session = await getSession();
  if (session === null) {
    // `throw: true` is TanStack's own throwing form. A bare
    // `throw redirect(...)` trips @typescript-eslint/only-throw-error,
    // because what it returns is a Redirect, not an Error.
    redirect({ to: "/auth/login", throw: true });
    // Unreachable: the call above throws. It exists so the compiler can
    // narrow `session`, since `redirect` is typed as returning a Redirect
    // rather than `never`.
    throw new Error("unreachable: redirect({ throw: true }) returned");
  }
  return session;
}
