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
Loader-side gate: the session, or a redirect to sign-in.
*/
export async function requireSession(): Promise<
  NonNullable<Awaited<ReturnType<typeof getSession>>>
> {
  return sessionOrRedirect(await getSession());
}
