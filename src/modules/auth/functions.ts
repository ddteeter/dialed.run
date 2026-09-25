import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "./instance";
import { sessionOrRedirect } from "./require-session";

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
 * Whether anyone is signed in, for the shell's own decisions — the system
 * states' frame (round 22, X1/X2) — read once at the root.
 */
export const signedInQuery = createServerFn({ method: "GET" }).handler(
  async () => ({
    signedIn: (await auth.api.getSession({ headers: getRequestHeaders() })) !== null,
  }),
);

/**
 * Loader-side gate: the session, or a redirect to sign-in that comes back
 * to `returnTo` — pass the loader's `location.href`.
 */
export async function requireSession(
  returnTo?: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getSession>>>> {
  return sessionOrRedirect(await getSession(), returnTo);
}
