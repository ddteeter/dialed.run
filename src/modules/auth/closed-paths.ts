/**
 * Better Auth's routed endpoints that the app answers 404 (`disabledPaths`).
 *
 * The browser calls seven of Better Auth's paths (`./credentials`); the
 * server calls two more through `auth.api`, which never passes the router,
 * so they keep working when their HTTP path is closed. Everything else
 * Better Auth mounts is an action the app does through its own server
 * functions, with its own checks, or does not do at all — so over HTTP it
 * is closed rather than left as a second way to do it.
 *
 * `test/auth/closed-paths.test.ts` lists every routed path and fails on
 * one that is neither here nor on its allow-list, so a Better Auth upgrade
 * that mounts a new endpoint is a decision, not a default.
 *
 * A parameterised route (`/reset-password/:token`, `/callback/:id`) cannot
 * be closed here: the router compares the request's own path with this
 * list. Those stay on the test's allow-list with their reasons.
 */
import { CHANGE_PASSWORD_PATH } from "./breached-password";

export const CLOSED_AUTH_PATHS: readonly string[] = [
  // Ours, with the per-runner count on tries (R-124).
  CHANGE_PASSWORD_PATH,
  // Checked from the server only (`./password-check`), inside that count.
  "/verify-password",
  // The app confirms addresses with its own links (`modules/account`).
  "/verify-email",
  "/send-verification-email",
  // Change email and Delete account are the app's (`modules/account`).
  "/change-email",
  "/delete-user",
  "/delete-user/callback",
  // The profile is the app's (`user_profiles`), not Better Auth's user row.
  "/update-user",
  // Google is a way to sign in, not an account to manage from the browser.
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/get-access-token",
  "/refresh-token",
  // Sign out everywhere is the one session control (`/revoke-sessions`).
  "/list-sessions",
  "/revoke-session",
  "/revoke-other-sessions",
  "/update-session",
];
