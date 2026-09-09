import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { createAuth, googleCredentials } from "./create-auth";

/**
The app auth instance. Server-side only — never import from client code.
*/
export const auth = createAuth({
  db: drizzle(env.DIALED_CORE),
  secret: env.BETTER_AUTH_SECRET,
  google: googleCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  plugins: [tanstackStartCookies()],
});
