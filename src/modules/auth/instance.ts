import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import { env, waitUntil } from "../../env";
import { accessGate, authMail } from "../account";
import { emailDepsFromEnv } from "../email";
import { captureException, verifyTurnstileToken } from "../ops";
import { banGate } from "../safety";
import { breachVerdict } from "./breached-password";
import { createAuth, googleCredentials } from "./create-auth";
import { deletionGate } from "./leaving-gate";

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
  // The ban gate (task 128 · SAF-4): a banned runner's session is refused
  // wherever one is made — email, Google, any provider added later.
  // The deletion gate (task 126, ACC-9): once an account's purge has
  // started, no session is made for it, by any provider.
  plugins: [
    tanstackStartCookies(),
    banGate(),
    deletionGate(drizzle(env.DIALED_CORE)),
  ],
  passwordScreen: {
    verdict: (password) => breachVerdict(password),
    report: captureException,
  },
  // Task 126 (ACC-3, ACC-4): the confirm, existing-account and reset
  // emails, through modules/email.
  mail: authMail(drizzle(env.DIALED_CORE), emailDepsFromEnv, captureException),
  // Every email above leaves the request path, so no answer is slower for
  // an address that has an account (review of PR #119).
  background: waitUntil,
  // Task 126 (ACC-5): Turnstile and the invite code on sign-up, email and
  // Google, and the code spent as the account is made.
  access: accessGate(drizzle(env.DIALED_CORE), verifyTurnstileToken),
});
