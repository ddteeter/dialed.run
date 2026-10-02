/**
 * A runner behind on the terms, at the one auth gate (task 126, ACC-6;
 * round 28 PR A) — the leaving refusal's shape (./leaving-gate).
 *
 * The root route's gate sends a runner whose latest acceptance is below
 * the current terms to the prompt before any page, but a redirect is the
 * client's to skip, and the browser's has-handle memo skips the question
 * for the rest of a page load. So the server says no itself, in
 * `requireUserId`, which every server function passes through.
 *
 * **Writes only.** A server function declared `GET` reads, and is let
 * through: Settings › Account, where a runner who will not accept goes to
 * delete their account, loads through reads; and a tab left open across a
 * terms bump keeps rendering until its next save, rather than every page
 * failing. Anything else — `POST`, the default — is a write, or is treated
 * as one, and needs the current terms.
 *
 * Exempt by construction rather than by a list: Accept itself
 * (`requireUserIdBeforeTerms`), Delete account (`requireSignedInSince` and
 * `checkCurrentPassword` check leaving only), Keep, and sign-out, which is
 * Better Auth's own endpoint and never passes through here.
 */
import type { drizzle } from "drizzle-orm/d1";

import { termsStanding } from "../account";
import { TermsNotAcceptedError } from "./auth-error";

type Db = ReturnType<typeof drizzle>;

/**
 * Every server function's terms rule: the runner, on a read or while they
 * have accepted the current terms — `TermsNotAcceptedError` otherwise.
 * `method` is the request's, which for a server function is the one it was
 * declared with.
 */
export async function agreedUserId(
  db: Db,
  userId: string,
  method: string,
): Promise<string> {
  if (method === "GET") return userId;
  if ((await termsStanding(db, userId)) === "behind") {
    throw new TermsNotAcceptedError();
  }
  return userId;
}
