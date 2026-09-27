import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { authMail } from "../account";
import { emailDepsFromEnv } from "../email";
import { captureException } from "../ops";
import { breachVerdict } from "./breached-password";
import { createAuth, googleCredentials } from "./create-auth";

/**
The app auth instance. Server-side only — never import from client code.
*/
export const auth = createAuth({
  db: drizzle(env.DIALED_CORE),
  secret: env.BETTER_AUTH_SECRET,
  // The deployment's own origin (OPS-4): callbacks are built from it, and
  // its scheme decides secure cookies and rate limiting (createAuth).
  baseUrl: env.BETTER_AUTH_URL,
  google: googleCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  plugins: [tanstackStartCookies()],
  passwordScreen: {
    verdict: (password) => breachVerdict(password),
    report: captureException,
  },
  // Task 126 (ACC-3, ACC-4): the confirm, existing-account and reset
  // emails, through modules/email.
  mail: authMail(drizzle(env.DIALED_CORE), emailDepsFromEnv, captureException),
});
