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
