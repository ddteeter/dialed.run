import { eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";

import { account, session, user } from "../../src/db/schema-auth";
import { termsAcceptances, userProfiles } from "../../src/db/schema-core";
import { admissionHeaders, ensureInviteCode } from "./invites";
import { withLocalDb } from "./local-db";

/**
 * A signed-in user with a *known id*, for a feature whose "who" is
 * configuration rather than data: the Desk's operator (`ADMIN_USER_IDS`)
 * and Garmin's owner (`GARMIN_OWNER_USER_ID`), each an id the dev server's
 * `.dev.vars` names, while a sign-up mints a fresh ULID.
 *
 * This signs up through Better Auth itself, as every demo account does (no
 * hand-rolled password hash, no forged cookie), and then gives that user
 * the known id in the local database, carrying its session and its
 * credential with it. The session cookie the browser holds points at the
 * session row, which now points at the known id. The handle is fixed like
 * the id: every signed-in runner without one is sent to O0 by the root's
 * handle gate, and the last run's row is deleted first, which frees it.
 */
export async function signInAsKnownUser(
  page: Page,
  id: string,
  handle: string,
): Promise<void> {
  const context = page.context();
  // Better Auth's own sign-up endpoint, through the page's request context
  // so the session cookie lands in this browser. Not the form: the form is
  // the auth demo's subject, and this journey is something else's.
  // Better Auth refuses a POST without an Origin it trusts (CSRF), so the
  // request says it comes from the app, which it does.
  await page.goto("/auth/login");
  const origin = new URL(page.url()).origin;
  const credentials = {
    email: `${id}-${String(Date.now())}@example.com`,
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
    // The last run's user goes first: the id is fixed, so it is taken.
    await core.delete(user).where(eq(user.id, id));
    await core.delete(userProfiles).where(eq(userProfiles.userId, id));
    await core.delete(termsAcceptances).where(eq(termsAcceptances.userId, id));
    // One batch, with foreign keys checked at the end of it rather than per
    // statement: mid-batch, the session briefly points at a user id that
    // does not exist yet.
    await core.batch([
      core.run(sql`PRAGMA defer_foreign_keys = ON`),
      // Confirmed: the Desk waits for a confirmed address (design 133,
      // D-113 Q5), and nothing a known user is for wants an unconfirmed one.
      core
        .update(user)
        .set({ id, emailVerified: true })
        .where(eq(user.id, from)),
      core.update(session).set({ userId: id }).where(eq(session.userId, from)),
      core.update(account).set({ userId: id }).where(eq(account.userId, from)),
      core
        .update(userProfiles)
        .set({ userId: id })
        .where(eq(userProfiles.userId, from)),
      // The terms the sign-up accepted (ACC-6) go with the account, or —
      // once the terms are published (D-93) — the root's gate would send
      // the operator to the terms prompt.
      core
        .update(termsAcceptances)
        .set({ userId: id })
        .where(eq(termsAcceptances.userId, from)),
      core
        .insert(userProfiles)
        .values({ userId: id, username: handle })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { username: handle },
        }),
    ]);
  });
}
