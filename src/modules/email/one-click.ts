/**
 * A mail client's one-click unsubscribe (RFC 8058), for the landing
 * route's POST handler — here, not in ./functions, because the route
 * imports it only inside `server.handlers`, whose body the Start plugin
 * strips from the client build along with this import. A plain function
 * in ./functions stays in the client copy of that file, and takes the
 * bindings with it.
 */
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { oneClickUnsubscribe } from "./landing";

export function oneClickUnsubscribeResponse(
  request: Request,
): Promise<Response> {
  return oneClickUnsubscribe(
    drizzle(env.DIALED_CORE),
    env.UNSUBSCRIBE_SECRET,
    request,
  );
}
