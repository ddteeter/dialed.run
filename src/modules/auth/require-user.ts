/**
 * The one auth gate for server functions.
 *
 * Every module's server functions call `requireUserId()`. A module-local
 * copy is an eslint error (`no-restricted-syntax`, see eslint.config.js),
 * and that rule exists because four hand-written copies across three lanes
 * had already drifted into three different error types — `Error`,
 * `UnauthenticatedError`, `AuthRequiredError` — which left the client with
 * no reliable way to tell "sign in again" from "something broke".
 *
 * The error itself lives in ./auth-error, which imports nothing from
 * TanStack and so stays loadable (and testable) in the workers pool.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";

import { AuthRequiredError } from "./auth-error";
import { auth } from "./instance";

/**
 * The signed-in user's id, or `AuthRequiredError`. Server-function side
 * only — route loaders want `requireSession` from ./functions, which
 * redirects instead of throwing.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (session === null) throw new AuthRequiredError();
  return session.user.id;
}

/**
 * The signed-in user's id, or `undefined` when nobody is signed in.
 *
 * The optional counterpart to `requireUserId`, for surfaces that are
 * legitimately readable while signed out but show more when you are: the
 * public feed, an entry detail page, the cached photo GET. Those need the
 * viewer's identity to decide visibility, not to gate entry.
 *
 * It exists because the alternative is calling `auth.api.getSession`
 * inline, which is the fifth session idiom this module was consolidated to
 * prevent — and the eslint rule rejects it for exactly that reason. Same
 * reasoning as `sessionFromRequest`, which covers raw handlers holding a
 * `Request` rather than TanStack's server context.
 */
export async function optionalUserId(): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  return session?.user.id;
}
