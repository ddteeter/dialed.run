/**
 * Session lookup for raw route handlers.
 *
 * `requireUserId` reads headers from TanStack's server context, which only
 * exists inside a server function. A `server.handlers` route (the cached
 * photo GET, for one) has a real `Request` instead, so it needs a way in
 * that takes headers explicitly — without reaching for `auth.api` directly
 * and starting a fifth session idiom.
 */
import { auth } from "./instance";

export function sessionFromRequest(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}
