/**
 * Auth factory — pure of bindings so tests and tooling can construct it.
 * The singleton wired to real bindings lives in index.ts.
 */
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import * as authSchema from "../../db/schema-auth";
import type { AuthMail } from "../account";
import { PASSWORD_MIN_LENGTH } from "../../lib/contracts";
import { outboxInsertWhere, oweOutbox } from "../ops";
import {
  admitSignUp,
  claimInvite,
  type AccessGate,
  type HookRequest,
} from "./access-hook";
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
  /**
   * The emails auth sends (task 126: ACC-3, ACC-4) — the confirm link for
   * a new account, "you already have an account" for a sign-up with a
   * registered address, and the reset link. Required for the reason the
   * breach screen is: no construction can quietly send nothing. The
   * instance wires `account`'s `authMail`; tests a recorder.
   */
  mail: AuthMail;
  /**
   * Keeps the Worker alive for work the answer does not wait on — the
   * instance wires `waitUntil`. With it, every email auth sends leaves
   * the request path: a reset request, a sign-up and a repeat sign-up then
   * answer in the same time whether or not the address has an account,
   * which is what their identical bodies were promising. Without it (a
   * test), the sends are awaited.
   */
  background?: ((work: Promise<unknown>) => void) | undefined;
  /**
   * The way in (ACC-5): Turnstile and the invite code on sign-up, email
   * and Google, and the code spent as the account is made. Required for
   * the breach screen's reason: no construction can leave the door open
   * by forgetting it. See `./access-hook.ts`.
   */
  access: AccessGate;
}

/**
 * The before-hook's half that screens a new password on sign-up and on a
 * password change.
 *
 * **Fails open** (law 5): a screen that times out or errors lets the
 * request through and reports it — sign-up is the primary action and the
 * screen is secondary. Only a positive match refuses, as a 400 carrying
 * `BREACHED_CODE`, which the form lands on the Password field.
 */
async function screenPassword(
  screen: AuthConfig["passwordScreen"],
  ctx: HookRequest,
): Promise<void> {
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
}

/**
 * What the deployment's own origin says about how auth should behave
 * (OPS-4, audit finding 0.7), decided here rather than by `NODE_ENV`,
 * which Better Auth reads by default and a Worker does not have.
 *
 * An `https` origin is a real deployment: its cookies carry the
 * `__Secure-` prefix, and sign-in, sign-up and the other sensitive paths
 * are rate limited. Anything else — local dev and CI, on
 * `http://localhost` — gets neither: a browser refuses a secure cookie
 * over plain http, and every e2e account signs up from one address inside
 * a few seconds, which a production limit exists to refuse.
 */
export function deploymentPosture(baseUrl: string | undefined): {
  secureCookies: boolean;
  rateLimited: boolean;
} {
  const isHttps = baseUrl?.startsWith("https://") === true;
  return { secureCookies: isHttps, rateLimited: isHttps };
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

/**
 * A reset link's life: an hour (ACC-4). Shorter than a confirm link's day
 * because this one hands over the account.
 */
export const RESET_LINK_TTL_S = 60 * 60;

export function createAuth({
  db,
  secret,
  baseUrl,
  google,
  plugins,
  passwordScreen,
  mail,
  background,
  access,
}: AuthConfig) {
  const posture = deploymentPosture(baseUrl);
  // Better Auth's own sends go through `backgroundTasks`; the one it
  // awaits itself — the after-create hook — through this.
  async function later(work: Promise<void>): Promise<void> {
    if (background === undefined) await work;
    else background(work);
  }
  return betterAuth({
    secret,
    telemetry: { enabled: false },
    ...(baseUrl !== undefined && { baseURL: baseUrl }),
    // Better Auth's own limits for its sensitive paths (sign-in and
    // sign-up: 3 per 10 s per address) and 100 per minute elsewhere, with
    // the counters in D1 so every isolate shares them.
    rateLimit: {
      enabled: posture.rateLimited,
      storage: "database",
      window: 60,
      max: 100,
    },
    advanced: {
      useSecureCookies: posture.secureCookies,
      // Cloudflare's edge sets this, and a client cannot: the one address
      // worth keying a limit on. Better Auth's default reads
      // X-Forwarded-For, which a client can write.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...(background !== undefined && {
        backgroundTasks: { handler: background },
      }),
    },
    // Reset tokens are stored as their hash, like our own email links: a
    // leaked database hands nobody a live reset link.
    verification: { storeIdentifier: "hashed" },
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
      // Every email sign-up ends on Au4, "Check your email" (round 26
      // #11), whether the address is new or registered, and the page must
      // not be able to tell the two apart. Signing a new account in would
      // tell them apart, so sign-up signs nobody in — Better Auth then
      // answers a registered address with the same body as a new one, and
      // calls `onExistingUserSignUp` instead of making an account. The
      // runner logs in (unconfirmed runners can: D-50), or follows the
      // link, whichever comes first.
      autoSignIn: false,
      onExistingUserSignUp: ({ user }) => mail.existingAccount(user),
      // ACC-4. Better Auth's reset: single use, its row deleted when
      // spent; the link lives an hour, and a reset signs every session
      // out, so a stolen session does not outlive the password it rode in
      // on.
      sendResetPassword: ({ user, token }) => mail.resetPassword(user, token),
      resetPasswordTokenExpiresIn: RESET_LINK_TTL_S,
      revokeSessionsOnPasswordReset: true,
      // A spent reset link proves the runner reads that inbox, which is
      // everything a confirm link proves (owner, 2026-09-27): an
      // unconfirmed runner who resets is confirmed by it — and is owed
      // what a confirmation owes, the link of their garments to the
      // shared products (design 133, D-113 Q1). Owed only when this reset
      // is what confirms the address: the debt's insert reads the row
      // before the update beside it does, in one batch.
      onPasswordReset: async ({ user }) => {
        const account = eq(authSchema.user.id, user.id);
        const productLink = oweOutbox({
          kind: "product_link",
          payload: { userId: user.id },
        });
        await db.batch([
          outboxInsertWhere(db, productLink, {
            table: authSchema.user,
            where: sql`${authSchema.user.id} = ${user.id} AND ${authSchema.user.emailVerified} = 0`,
          }),
          db
            .update(authSchema.user)
            .set({ emailVerified: true })
            .where(account),
        ]);
      },
    },
    // The confirm link goes out once the account exists. Only an email
    // sign-up needs one: Google's accounts come confirmed (round 26 #11,
    // "Google accounts skip Au4").
    databaseHooks: {
      user: {
        create: {
          // No name, and (invite-only) a code spent: `claimInvite`.
          before: claimInvite(access),
          after: async (user) => {
            // The code's use is the account's for good now, even if the
            // account is deleted later. Awaited: it is one small write,
            // and until it lands the address alone holds the use.
            await access.confirm(user.id);
            if (!user.emailVerified) await later(mail.newAccount(user));
          },
        },
      },
    },
    // Google makes an account only when Au2 asks it to (`requestSignUp`),
    // which is where Turnstile and the code are checked; from the log-in
    // page an unknown Google address is refused, not signed up.
    ...(google !== undefined && {
      socialProviders: { google: { ...google, disableImplicitSignUp: true } },
    }),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The password first: a breached one is the form's to fix
        // whatever the code says. Then the way in.
        await screenPassword(passwordScreen, ctx);
        await admitSignUp(access, ctx);
      }),
    },
    plugins: plugins ?? [],
  });
}
