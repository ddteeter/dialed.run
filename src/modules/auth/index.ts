import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { createAuth } from "./create-auth";

/**
The app auth instance. Server-side only — never import from client code.
*/
export const auth = createAuth({
  db: drizzle(env.DIALED_CORE),
  secret: env.BETTER_AUTH_SECRET,
  google:
    env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined,
  plugins: [tanstackStartCookies()],
});

// Session type export returns when a lane consumes it (knip keeps us honest).

// Server-fn glue lives in ./functions (imported directly by routes) so this
// barrel stays loadable in the vitest workers pool (no TanStack virtual entries).
