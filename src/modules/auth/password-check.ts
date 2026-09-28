/**
 * Whether a password is the signed-in runner's own — Better Auth's check,
 * against the hash it stores, for a form that asks for the current
 * password before it acts (ACC-8's email change).
 *
 * Here rather than in ./require-user because that file pulls TanStack's
 * request context and no test can import it; this takes the instance and
 * the headers, so a worker test runs it against a real one.
 */
import { APIError } from "better-auth/api";

import type { createAuth } from "./create-auth";

type Auth = Pick<ReturnType<typeof createAuth>, "api">;

/**
Better Auth's code for a password that is not the account's.
*/
const NOT_THEIRS_CODE = "INVALID_PASSWORD";

/**
 * `true` for the account's password, `false` for any other — including
 * for an account with no password at all (Google only), which has nothing
 * to match. Anything else Better Auth refuses — no session, say — is
 * thrown, not answered.
 */
export async function isOwnPassword(
  auth: Auth,
  headers: Headers,
  password: string,
): Promise<boolean> {
  try {
    await auth.api.verifyPassword({ body: { password }, headers });
    return true;
  } catch (error) {
    if (error instanceof APIError && error.body?.code === NOT_THEIRS_CODE) {
      return false;
    }
    throw error;
  }
}
