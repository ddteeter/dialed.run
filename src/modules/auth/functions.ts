import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { changePasswordSchema } from "../../lib/contracts";
import { auth } from "./instance";
import { sessionOrRedirect } from "./require-session";
import { signedInOf } from "./signed-in";
import { changeCurrentPassword, requireUserId } from "./require-user";

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
 * Who is signed in, for the shell's own decisions, read once at the root
 * (`signedInOf` says what it carries and why).
 */
export const signedInQuery = createServerFn({ method: "GET" }).handler(
  async () =>
    signedInOf(await auth.api.getSession({ headers: getRequestHeaders() })),
);

/**
 * ACC-7's Change password (R-124): the per-runner count on tries at the
 * current password, then Better Auth's change. Called from the server, so
 * the count sees every try.
 */
export const changeCredentialFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => changePasswordSchema.parse(data))
  .handler(async ({ data }) =>
    changeCurrentPassword(await requireUserId(), data),
  );

/**
 * Loader-side gate: the session, or a redirect to sign-in that comes back
 * to the guarded page — pass the loader's `location`.
 */
export async function requireSession(
  location: Readonly<{ pathname: string; searchStr: string }>,
): Promise<NonNullable<Awaited<ReturnType<typeof getSession>>>> {
  return sessionOrRedirect(await getSession(), location);
}
