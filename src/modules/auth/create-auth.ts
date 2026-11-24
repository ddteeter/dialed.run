/**
 * Auth factory — pure of bindings so tests and tooling can construct it.
 * The singleton wired to real bindings lives in index.ts.
 */
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import * as authSchema from "../../db/schema-auth";
import { newUlid } from "../../lib/ids";
import { changeLinkWithdrawal, type AuthMail } from "../account";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../lib/contracts";
import { outboxInsertWhere, oweOutbox } from "../ops";
import {
  admitSignUp,
  claimInvite,
  type AccessGate,
  type HookRequest,
} from "./access-hook";
import { AUTH_COPY } from "./auth-copy";
import { CLOSED_AUTH_PATHS } from "./closed-paths";
import { clearSignInTries, countSignInTry } from "./sign-in-limit";
import { cutUserAgent, endOldestSessions } from "./session-cap";
import { countSocialStart, holdSocialBody } from "./social-body";
import {
  BREACHED_CODE,
  newPasswordIn,
  type BreachVerdict,
} from "./breached-password";

export interface AuthConfig {
  db: ReturnType<typeof drizzle>;
  /**
   * `undefined` when the binding is unset: `signingSecret` refuses it.
   */
  secret: string | undefined;
  /**
   * The deployment's origin: `deploymentOrigin` refuses an unset one, or
   * one the limiter and the `__Host-` cookies would quietly be off for.
   */
  baseUrl: string | undefined;
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
 * The before-hook's half that screens a new password on sign-up, on a
 * password change and on a reset.
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
Better Auth's Sign out everywhere, as its hooks name it.
*/
const REVOKE_SESSIONS_PATH = "/revoke-sessions";

/**
 * Sign out everywhere also withdraws the runner's open change-email link:
 * it is what a runner presses when they think someone else got in, and a
 * change that someone asked for must not outlive it. Withdrawn before the
 * sessions end, from the session that asked; no session, nothing to do
 * (the endpoint refuses it anyway).
 */
async function withdrawChangeOnSignOutEverywhere(
  db: AuthConfig["db"],
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): Promise<void> {
  if (ctx.path !== REVOKE_SESSIONS_PATH) return;
  const session = await getSessionFromCtx(ctx);
  if (session === null) return;
  await changeLinkWithdrawal(db, session.user.id);
}

/**
 * Better Auth's cookies on an https origin (SA-M35, design 230): named
 * `__Host-`, which a browser keeps only as this host set it (`Secure`,
 * `Path=/`, no `Domain`), so no other host under the domain can set a
 * cookie this host then reads. Better Auth's own `useSecureCookies` would
 * put `__Secure-` in front of any name, which allows a `Domain`; so it is
 * off, the prefix is the name's, and `secure` is set on every cookie it
 * writes. On plain http nothing changes: no prefix, no `Secure`.
 */
export const HOST_ONLY_COOKIES = {
  cookiePrefix: "__Host-better-auth",
  defaultCookieAttributes: { secure: true },
} as const;

/**
 * What the deployment's own origin says about how auth should behave
 * (OPS-4, audit finding 0.7), decided here rather than by `NODE_ENV`,
 * which Better Auth reads by default and a Worker does not have.
 *
 * An `https` origin is a real deployment: its cookies carry the
 * `__Host-` prefix (`HOST_ONLY_COOKIES`), and sign-in, sign-up and the other sensitive paths
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
The hosts a plain http origin may name: local dev and CI's own machine.
*/
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

/**
 * An origin auth may run on: an https one, spelled as `deploymentPosture`
 * reads it, or plain http on this machine.
 */
function isServedOrigin(origin: string): boolean {
  if (!URL.canParse(origin)) return false;
  if (deploymentPosture(origin).secureCookies) return true;
  return (
    origin.startsWith("http://") && LOCAL_HOSTS.has(new URL(origin).hostname)
  );
}

/**
 * The deployment's origin, or no auth instance at all.
 *
 * An origin decides the posture (`deploymentPosture`): anything but a
 * lower-case `https://` one has the limiter and the `__Host-` cookies
 * off. So auth starts only on an https origin, or on plain http to
 * `localhost` or `127.0.0.1`, which local dev and CI set; an unset or
 * blank `BETTER_AUTH_URL`, or any other value (`http://` to a real host, a
 * bare host, `HTTPS://`), stops the instance being built, as an unset
 * secret does, and so the Worker serving anything.
 */
export function deploymentOrigin(origin: string | undefined): string {
  if (origin === undefined || origin.trim() === "") {
    throw new Error("BETTER_AUTH_URL is not set: auth will not start");
  }
  if (!isServedOrigin(origin)) {
    throw new Error(
      "BETTER_AUTH_URL is not an https origin, or http on this machine: auth will not start",
    );
  }
  return origin;
}

/**
 * The secret every token and cookie Better Auth signs is signed with, or
 * no auth instance at all.
 *
 * Better Auth answers an empty secret with a fixed fallback of its own
 * and refuses that fallback only under `NODE_ENV=production`, which a
 * Worker does not have. So the refusal is ours: an unset or blank
 * `BETTER_AUTH_SECRET` stops the instance being built, which stops the
 * Worker serving anything, rather than starting on a secret everyone
 * can read.
 */
function signingSecret(secret: string | undefined): string {
  if (secret === undefined || secret.trim() === "") {
    throw new Error("BETTER_AUTH_SECRET is not set: auth will not start");
  }
  return secret;
}

/**
 * A date as the `user` table stores it: `integer` in timestamp mode keeps
 * whole seconds.
 */
function toWholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
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
  return clientId === undefined || clientSecret === undefined
    ? undefined
    : { clientId, clientSecret };
}

/**
 * What Better Auth would keep of an OAuth grant, kept as nothing (legal C4).
 *
 * After "Sign in with Google" Better Auth writes Google's access, refresh
 * and ID tokens to the `account` row, and refreshes them on every later
 * sign-in. Nothing here reads them: Google only proves who the runner is,
 * at the callback, which has already used the tokens by the time the row
 * is written. Google's OAuth 2.0 Policies say to delete tokens you do not
 * need, so they are never stored.
 *
 * Every account write, not only Google's: the token-refresh paths update
 * a row without saying whose provider it is, and the only other accounts
 * Better Auth holds are email/password ones, which carry no tokens.
 * Strava's grant is not one of them; it lives in our own tables.
 *
 * `undefined`, not NULL: the hook's data is spread over Better Auth's, and
 * its adapter skips an `undefined` field, so these columns are simply
 * never written. A new row leaves them NULL; an update leaves them as
 * they are, which is NULL, because no write ever filled them. (The app has
 * never been deployed, so no row from before this exists to clear.)
 */
const NO_PROVIDER_TOKENS = {
  accessToken: undefined,
  refreshToken: undefined,
  idToken: undefined,
  accessTokenExpiresAt: undefined,
  refreshTokenExpiresAt: undefined,
};

function withoutProviderTokens(): Promise<{
  data: typeof NO_PROVIDER_TOKENS;
}> {
  return Promise.resolve({ data: NO_PROVIDER_TOKENS });
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
  const origin = deploymentOrigin(baseUrl);
  const posture = deploymentPosture(origin);
  // Better Auth's own sends go through `backgroundTasks`; the one it
  // awaits itself — the after-create hook — through this.
  async function later(work: Promise<void>): Promise<void> {
    if (background === undefined) await work;
    else background(work);
  }
  return betterAuth({
    secret: signingSecret(secret),
    telemetry: { enabled: false },
    // Every routed endpoint the app does not call from the browser is
    // answered 404 (`./closed-paths`). Change password among them is ours
    // (`./change-password`, R-124): the per-runner count on tries at the
    // current password runs before Better Auth's endpoint is called. Only
    // the router reads this list, so the server-side
    // `auth.api.changePassword` and `auth.api.verifyPassword` still work.
    disabledPaths: [...CLOSED_AUTH_PATHS],
    baseURL: origin,
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
      useSecureCookies: false,
      ...(posture.secureCookies && HOST_ONLY_COOKIES),
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
      // And its ceiling, Better Auth's own default, said here so the forms'
      // `PASSWORD_MAX_LENGTH` and the server cannot drift apart.
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Every email sign-up ends on Au4, "Check your email" (round 26
      // #11), whether the address is new or registered, and the page must
      // not be able to tell the two apart. Signing a new account in would
      // tell them apart, so sign-up signs nobody in — Better Auth then
      // answers a registered address with the same body as a new one, and
      // calls `onExistingUserSignUp` instead of making an account. The
      // runner logs in (unconfirmed runners can: D-50), or follows the
      // link, whichever comes first.
      autoSignIn: false,
      // What Better Auth answers a registered address with: the user a new
      // account's answer carries, as the create hook and the column leave
      // it (`claimInvite`: no name, and a ULID when invite-only; the
      // `user` table's dates: whole seconds). Pinned against a real
      // sign-up's answer in `test/auth/create-auth.test.ts`.
      // The app declares no additional user fields, so there are none to
      // carry over.
      customSyntheticUser: ({ coreFields, id }) => {
        const at = toWholeSecond(coreFields.createdAt);
        return {
          ...coreFields,
          name: "",
          createdAt: at,
          updatedAt: at,
          id: access.isInviteOnly ? newUlid() : id,
        };
      },
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
          // A change asked for before the reset moves the account no more.
          changeLinkWithdrawal(db, user.id),
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
      session: {
        create: {
          before: (row) => Promise.resolve(cutUserAgent(row)),
          after: (row) => endOldestSessions(db, row),
        },
      },
      account: {
        create: { before: withoutProviderTokens },
        update: { before: withoutProviderTokens },
      },
    },
    // Google signs in only to an account it is already a login of. An
    // address whose account was made with a password is refused as
    // `account_not_linked` (owner, 2026-11-15): the runner logs in with the
    // password, or resets it, and the band says so (`GOOGLE_REFUSALS`).
    account: { accountLinking: { disableImplicitLinking: true } },
    // Google makes an account only when Au2 asks it to (`requestSignUp`),
    // which is where Turnstile and the code are checked; from the log-in
    // page an unknown Google address is refused, not signed up.
    ...(google !== undefined && {
      socialProviders: {
        google: {
          ...google,
          disableImplicitSignUp: true,
          // No refresh token is asked for (legal C4). Better Auth sends no
          // `access_type` by default, which Google reads as online; saying
          // so keeps a later default from asking for offline access.
          accessType: "online",
        },
      },
    }),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A Google press carries only what the app's own press sends.
        const press = holdSocialBody(ctx);
        // The password first: a breached one is the form's to fix
        // whatever the code says. Then the way in.
        await screenPassword(passwordScreen, ctx);
        await admitSignUp(access, ctx);
        await withdrawChangeOnSignOutEverywhere(db, ctx);
        await countSignInTry(db, ctx);
        // Last, so a press the way in refused is not counted as a start.
        await countSocialStart(db, ctx.context.socialProviders, press);
      }),
      after: createAuthMiddleware(async (ctx) => {
        await clearSignInTries(db, ctx);
      }),
    },
    plugins: plugins ?? [],
  });
}
