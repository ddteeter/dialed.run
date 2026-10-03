/**
 * A runner whose account is set to be deleted, at the one auth gate
 * (task 126, ACC-9; review of PR #130).
 *
 * "Keep your account?" used to be enforced by the root route's redirect
 * alone, and a client can go round a redirect — the browser's has-handle
 * memo skips the question that carries it. So a runner who signed in
 * during the week could save a garment after the purge's closet step, and
 * the garment and its photo outlived the account. The server now says no
 * itself, in the two places every way in passes through:
 *
 * - **`requireUserId`** refuses a runner with any `account_deletions` row:
 *   nothing is written for an account that is going. Reads through it go
 *   too, which costs nothing — every page but "Keep your account?" is
 *   already behind the redirect — and is one rule rather than a list of
 *   which server functions write. Only Keep itself is let through
 *   (`keepableUserId`), so the week's one way back still works.
 * - **Session creation** refuses a runner whose purge has started
 *   (`deletionGate`), and the purge's claim deletes their sessions in the
 *   same batch that starts it (`account/purge.ts`). So once
 *   `purge_started_at` is set there is no session to act with and no way
 *   to get one: everything is refused, sign-in included.
 *
 * Here rather than in `modules/account`, which owns the table: the auth
 * instance already imports that module's barrel, so account's barrel
 * importing auth's back would be a cycle, and the gate is auth's concern.
 */
import type { BetterAuthPlugin } from "better-auth";
import { BASE_ERROR_CODES } from "better-auth";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { accountDeletions } from "../../db/schema-core";
import { AccountLeavingError, AuthRequiredError } from "./auth-error";

type Db = ReturnType<typeof drizzle>;

/**
 * Where an account stands: in use, inside its deletion's week, or being
 * purged.
 */
export type Standing = "active" | "leaving" | "purging";

export async function standingOf(db: Db, userId: string): Promise<Standing> {
  const [claim] = await deletionClaimOf(db, userId);
  return standingFrom(claim);
}

/**
 * The runner's deletion claim, if any, unsent — a seek on the table's
 * primary key, so at most one row and no `LIMIT` to say so — for the one
 * auth gate to batch with the terms read (`./terms-gate`).
 */
export function deletionClaimOf(db: Db, userId: string) {
  return db
    .select({ purgeStartedAt: accountDeletions.purgeStartedAt })
    .from(accountDeletions)
    .where(eq(accountDeletions.userId, userId));
}

/**
The standing a deletion claim (or none) means.
*/
export function standingFrom(
  claim: { readonly purgeStartedAt: number | null } | undefined,
): Standing {
  if (claim === undefined) return "active";
  return claim.purgeStartedAt === null ? "leaving" : "purging";
}

/**
 * Every server function's rule: the runner, while their account is not
 * set to be deleted — `AccountLeavingError` otherwise.
 */
export async function activeUserId(db: Db, userId: string): Promise<string> {
  if ((await standingOf(db, userId)) !== "active") {
    throw new AccountLeavingError();
  }
  return userId;
}

/**
 * "Keep my account"'s rule, and nothing else's: a runner inside the week
 * may keep it. Once the purge has started the account is as good as gone,
 * so they are nobody (`AuthRequiredError`), as a runner with no session is.
 */
export async function keepableUserId(db: Db, userId: string): Promise<string> {
  if ((await standingOf(db, userId)) === "purging") {
    throw new AuthRequiredError();
  }
  return userId;
}

/**
 * The session-creation half, as a Better Auth plugin (the ban gate's
 * shape, `safety/ban-gate.ts`): every way of signing in — email, Google,
 * any provider added later — makes a session, so this is the one place a
 * purge in progress can refuse them all.
 *
 * **The refusal is log-in's own "wrong email or password"**, word for
 * word: a purged account's old handle says only "This runner isn't here."
 * (decision D-82), and a sign-in that said "being deleted" would tell whoever typed
 * the address what the page will not.
 */
export function deletionGate(db: Db): BetterAuthPlugin {
  return {
    id: "deletion-gate",
    init: () => ({
      options: {
        databaseHooks: {
          session: {
            create: {
              before: async (session: { userId: string }) => {
                if ((await standingOf(db, session.userId)) !== "purging") {
                  return;
                }
                throw APIError.from(
                  "UNAUTHORIZED",
                  BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD,
                );
              },
            },
          },
        },
      },
    }),
  };
}
