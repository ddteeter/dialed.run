import { eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";

import { account, session, user } from "../../src/db/schema-auth";
import { userProfiles } from "../../src/db/schema-core";
import { withLocalDb } from "../support/local-db";

/**
 * The Desk's operator for e2e: the one user id `ADMIN_USER_IDS` names in
 * the dev server's `.dev.vars` (`e2e-desk-operator`; register D-72).
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

export async function signInAsOperator(page: Page): Promise<void> {
  const context = page.context();
  // Better Auth's own sign-up endpoint, through the page's request context
  // so the session cookie lands in this browser. Not the form: the form is
  // the auth demo's subject, and this journey is the Desk's.
  // Better Auth refuses a POST without an Origin it trusts (CSRF), so the
  // request says it comes from the app, which it does.
  await page.goto("/auth/login");
  const origin = new URL(page.url()).origin;
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin },
    data: {
      name: "Desk Operator",
      email: `operator-${String(Date.now())}@example.com`,
      // Never used again: the session is what the journey needs.
      password: crypto.randomUUID(),
    },
  });
  if (!signUp.ok())
    throw new Error(`sign-up failed: ${String(signUp.status())}`);

  const cookies = await context.cookies();
  const token = cookies
    .find((cookie) => cookie.name.endsWith("session_token"))
    ?.value.split(".", 1)[0];
  if (token === undefined) throw new Error("sign-up left no session cookie");

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
    ]);
  });
}
