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
 * This file imports `@tanstack/react-start/server`, so nothing in it can
 * be imported by a test or reached by mutation testing. It therefore holds
 * no decisions: both reads below fetch the session and hand it to
 * ./session-user, where the decision is, and the error type lives in
 * ./auth-error. Both of those import nothing from TanStack and so stay
 * loadable in the workers pool.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "./instance";
import { optionalUserIdFrom, userIdOrThrow } from "./session-user";

/**
 * The signed-in user's id, or `AuthRequiredError`. Server-function side
 * only — route loaders want `requireSession` from ./functions, which
 * redirects instead of throwing.
 */
export async function requireUserId(): Promise<string> {
  return userIdOrThrow(
    await auth.api.getSession({ headers: getRequestHeaders() }),
  );
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
  return optionalUserIdFrom(
    await auth.api.getSession({ headers: getRequestHeaders() }),
  );
}
