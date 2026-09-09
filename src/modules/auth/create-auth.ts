/**
 * Auth factory — pure of bindings so tests and tooling can construct it.
 * The singleton wired to real bindings lives in index.ts.
 */
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { drizzle } from "drizzle-orm/d1";

import * as authSchema from "../../db/schema-auth";

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

export function createAuth({ db, secret, baseUrl, google, plugins }: AuthConfig) {
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
    },
    ...(google !== undefined && { socialProviders: { google } }),
    plugins: plugins ?? [],
  });
}
