/**
 * Auth factory — pure of bindings so tests and tooling can construct it.
 * The singleton wired to real bindings lives in index.ts.
 */
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { drizzle } from "drizzle-orm/d1";

import * as authSchema from "../../db/schema-auth";
import { PASSWORD_MIN_LENGTH } from "../../lib/contracts";
import { AUTH_COPY } from "./auth-copy";
import {
  BREACHED_CODE,
  newPasswordIn,
  type BreachVerdict,
} from "./breached-password";

export interface AuthConfig {
  db: ReturnType<typeof drizzle>;
  secret: string;
  baseUrl?: string | undefined;
  /** Absent when the deployment has no Google credentials — email/password
   *  still works (CLAUDE.md law 5). */
  google?: { clientId: string; clientSecret: string } | undefined;
  /** Framework cookie plugin — injected so this file never imports
   *  TanStack Start internals (which the vitest workers pool can't load). */
  plugins?: BetterAuthPlugin[] | undefined;
  /**
   * Breach screening for a new password (NIST SP 800-63B §3.1.1.2), and
   * where a screen that could not answer is reported. Required, so no
   * construction of the auth instance can quietly skip it; the instance
   * wires the real range-API check and Sentry, tests a stub.
   */
  passwordScreen: {
    verdict: (password: string) => Promise<BreachVerdict>;
    report: (error: unknown, context: Record<string, string>) => void;
  };
}

/**
 * The before-hook that screens a new password on sign-up and on a
 * password change.
 *
 * **Fails open** (law 5): a screen that times out or errors lets the
 * request through and reports it — sign-up is the primary action and the
 * screen is secondary. Only a positive match refuses, as a 400 carrying
 * `BREACHED_CODE`, which the form lands on the Password field.
 */
export function passwordScreenHook(screen: AuthConfig["passwordScreen"]) {
  return createAuthMiddleware(async (ctx) => {
    const password = newPasswordIn(ctx.path, ctx.body);
    if (password === undefined) return;
    const verdict = await screen.verdict(password);
    if (verdict === "breached") {
      throw new APIError("BAD_REQUEST", {
        code: BREACHED_CODE,
        message: AUTH_COPY.passwordBreached,
      });
    }
    if (verdict === "unknown") {
      screen.report(new Error("password breach screen did not answer"), {
        path: ctx.path,
      });
    }
  });
}

/**
 * The Google provider, or `undefined` when the deployment has no
 * credentials (law 5: a missing secondary feature degrades, it does not
 * fail — email/password still works).
 *
 * Here rather than inline in ./instance because that file reads bindings,
 * and a test inside the isolate cannot change a binding: the decision would
 * only ever be exercised with both values unset. Both halves matter — a
 * deployment with one of the two set is a misconfiguration, and starting
 * Google OAuth with half a credential fails at the redirect rather than at
 * boot.
 */
export function googleCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
): AuthConfig["google"] {
  if (clientId === undefined || clientSecret === undefined) return undefined;
  return { clientId, clientSecret };
}

export function createAuth({
  db,
  secret,
  baseUrl,
  google,
  plugins,
  passwordScreen,
}: AuthConfig) {
  return betterAuth({
    secret,
    telemetry: { enabled: false },
    ...(baseUrl !== undefined && { baseURL: baseUrl }),
    database: drizzleAdapter(db, {
      // Equivalent mutant, and the evidence is worth keeping: a *wrong*
      // recognised provider fails loudly — building this with "mysql" and
      // signing up gives "Failed to create user" — but an unrecognised one
      // falls back to no dialect-specific handling, which is what D1
      // through drizzle wants anyway. So `""` and `"sqlite"` cannot be
      // told apart from outside, while the mistake that matters can.
      // Stryker disable next-line StringLiteral
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      // The schema's floor, not a second copy of it: the form refuses a
      // short password before the round trip, and this is what makes the
      // server refuse the same one when the form is bypassed.
      minPasswordLength: PASSWORD_MIN_LENGTH,
    },
    ...(google !== undefined && { socialProviders: { google } }),
    hooks: { before: passwordScreenHook(passwordScreen) },
    plugins: plugins ?? [],
  });
}
