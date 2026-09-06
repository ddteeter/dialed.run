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

export function createAuth({ db, secret, baseUrl, google, plugins }: AuthConfig) {
  return betterAuth({
    secret,
    telemetry: { enabled: false },
    ...(baseUrl !== undefined && { baseURL: baseUrl }),
    database: drizzleAdapter(db, {
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
