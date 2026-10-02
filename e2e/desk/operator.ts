import { eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";

import { account, session, user } from "../../src/db/schema-auth";
import { termsAcceptances, userProfiles } from "../../src/db/schema-core";
import { admissionHeaders, ensureInviteCode } from "../support/invites";
import { withLocalDb } from "../support/local-db";

/**
 * The Desk's operator for e2e: the one user id `ADMIN_USER_IDS` names in
 * the dev server's `.dev.vars` (`e2e-desk-operator`; register R-72).
 *
 * **Admin-ness is configuration, not data** — `isAdmin` reads the env var
 * and nothing else — so the operator needs a *known id*, and a sign-up
 * mints a fresh ULID. This signs up through Better Auth itself, as every demo
 * account does (no hand-rolled password hash, no forged cookie), and then
 * gives that user the known id in the local database, carrying its session
 * and its credential with it. The session cookie the browser holds points
 * at the session row, which now points at the operator.
 */
export const OPERATOR_ID = "e2e-desk-operator";

/**
 * The operator's handle. Every signed-in runner without one is sent to O0
 * by the root's handle gate, and the Desk is not O0's subject, so the
 * operator arrives with one already claimed. Fixed like the id: the last
 * run's operator row is deleted first, which frees it.
 */
const OPERATOR_HANDLE = "desk_operator";

export async function signInAsOperator(page: Page): Promise<void> {
  const context = page.context();
  // Better Auth's own sign-up endpoint, through the page's request context
  // so the session cookie lands in this browser. Not the form: the form is
  // the auth demo's subject, and this journey is the Desk's.
  // Better Auth refuses a POST without an Origin it trusts (CSRF), so the
  // request says it comes from the app, which it does.
  await page.goto("/auth/login");
  const origin = new URL(page.url()).origin;
  const credentials = {
    email: `operator-${String(Date.now())}@example.com`,
    // Never used again: the session is what the journey needs.
    password: crypto.randomUUID(),
  };
  // Sign-up is invite-only and Turnstile-guarded (task 126, ACC-5): the
  // harness's code, and the token Cloudflare's test secret accepts.
  await ensureInviteCode();
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin, ...admissionHeaders() },
    data: { name: "", ...credentials },
  });
  if (!signUp.ok())
    throw new Error(`sign-up failed: ${String(signUp.status())}`);
  // Sign-up signs nobody in (task 126, ACC-3: every sign-up ends on Au4),
  // so the session is the log-in's.
  const signIn = await page.request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: credentials,
  });
  if (!signIn.ok())
    throw new Error(`sign-in failed: ${String(signIn.status())}`);

  const cookies = await context.cookies();
  const token = cookies
    .find((cookie) => cookie.name.endsWith("session_token"))
    ?.value.split(".", 1)[0];
  if (token === undefined) throw new Error("sign-in left no session cookie");

  await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ userId: session.userId })
      .from(session)
      .where(eq(session.token, decodeURIComponent(token)));
    if (row === undefined) throw new Error("no session row for the cookie");
    const from = row.userId;
    // The last run's operator goes first: the id is fixed, so it is taken.
    await core.delete(user).where(eq(user.id, OPERATOR_ID));
    await core.delete(userProfiles).where(eq(userProfiles.userId, OPERATOR_ID));
    await core
      .delete(termsAcceptances)
      .where(eq(termsAcceptances.userId, OPERATOR_ID));
    // One batch, with foreign keys checked at the end of it rather than per
    // statement: mid-batch, the session briefly points at a user id that
    // does not exist yet.
    await core.batch([
      core.run(sql`PRAGMA defer_foreign_keys = ON`),
      core.update(user).set({ id: OPERATOR_ID }).where(eq(user.id, from)),
      core
        .update(session)
        .set({ userId: OPERATOR_ID })
        .where(eq(session.userId, from)),
      core
        .update(account)
        .set({ userId: OPERATOR_ID })
        .where(eq(account.userId, from)),
      core
        .update(userProfiles)
        .set({ userId: OPERATOR_ID })
        .where(eq(userProfiles.userId, from)),
      // The terms the sign-up accepted (ACC-6) go with the account, or the
      // root's gate would send the operator to the terms prompt.
      core
        .update(termsAcceptances)
        .set({ userId: OPERATOR_ID })
        .where(eq(termsAcceptances.userId, from)),
      core
        .insert(userProfiles)
        .values({ userId: OPERATOR_ID, username: OPERATOR_HANDLE })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { username: OPERATOR_HANDLE },
        }),
    ]);
  });
}
