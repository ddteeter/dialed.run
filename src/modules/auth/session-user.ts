/**
 * What the two server-function auth reads decide, with the session handed
 * in rather than fetched.
 *
 * `require-user.ts` cannot be imported by a test: `getRequestHeaders`
 * comes from `@tanstack/react-start/server`, which pulls the framework's
 * virtual entries in with it and fails to resolve inside the vitest
 * workers pool. That is the same reason `auth-error.ts` is separate from
 * it. So the fetch stays there and the decision lives here, where both
 * halves — "no session is a refusal" and "no session is simply nobody" —
 * can be asserted.
 */
import { AuthRequiredError } from "./auth-error";

/**
 * The part of a session either read touches. Deliberately structural:
 * better-auth's own session type carries a dozen fields these two do not
 * look at, and naming them here would be a second copy of it.
 */
export interface SessionWithUser {
  readonly user: { readonly id: string };
}

/**
 * The signed-in user's id, or `AuthRequiredError` — the single
 * unauthenticated signal every module's server functions raise.
 */
export function userIdOrThrow(session: SessionWithUser | null): string {
  if (session === null) throw new AuthRequiredError();
  return session.user.id;
}

/**
 * The signed-in user's id, or `undefined` when nobody is signed in.
 *
 * For surfaces that are legitimately readable while signed out and show
 * more when you are: the public feed, an entry detail page, the cached
 * photo GET. They need the viewer's identity to decide visibility, not to
 * gate entry.
 */
export function optionalUserIdFrom(
  session: SessionWithUser | null,
): string | undefined {
  return session?.user.id;
}
