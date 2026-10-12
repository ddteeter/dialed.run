/**
 * ACC-7's Change password, on the server (register R-124, decision D-98).
 *
 * It used to be Better Auth's endpoint called from the browser, whose
 * limiter counts HTTP requests. So a runner who ran out of tries read the
 * band's "Too many tries. Wait a minute" rather than round 28 #10's
 * field message, and the per-runner count Change email and Delete account
 * share (`./password-check`) never saw these tries. Now the count comes
 * first, and Better Auth's endpoint is called only for the runner's own
 * password.
 *
 * **The password is checked twice**, once by the count's check and once
 * by Better Auth's endpoint, which has no way to skip its own. D-98
 * accepted that cost. The endpoint runs on the server, but it still passes
 * through the instance's before-hook, so a breached new password is still
 * refused. And `tanstackStartCookies` still sets the new session's cookie
 * once every other session ends.
 *
 * Here rather than in ./require-user for the reason `./password-check` is:
 * this takes the instance and the headers, so a worker test runs it
 * against a real one.
 */
import { APIError } from "better-auth/api";

import { nowSeconds } from "../../lib/now";
import { BREACHED_CODE } from "./breached-password";
import { checkOwnPassword } from "./password-check";
import type { PasswordAuth } from "./password-check";

/**
 * What a change came to, as the form draws it: done; the current password
 * refused (wrong, or tried too often, with when the next try may go, in
 * epoch seconds); or the new one found in a breach.
 */
export type PasswordChange =
  | { readonly status: "changed" }
  | { readonly status: "wrong" }
  | { readonly status: "limited"; readonly until: number }
  | { readonly status: "breached" };

/**
 * The two calls this file makes. As in `./password-check`, this is
 * narrower than the instance's own type, so a test double can stand in.
 */
interface ChangeAuth extends PasswordAuth {
  readonly api: PasswordAuth["api"] & {
    readonly changePassword: (input: {
      body: {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions: boolean;
      };
      headers: Headers;
    }) => Promise<unknown>;
  };
}

type Check = Parameters<typeof checkOwnPassword>[0] &
  Readonly<{ auth: ChangeAuth }>;

/**
 * The current password through the per-runner count, then the change. Every
 * other session ends with the old password: a runner who changes it
 * usually suspects someone else has it.
 */
export async function changeOwnPassword(
  check: Check,
  values: Readonly<{ currentPassword: string; password: string }>,
  now = nowSeconds(),
): Promise<PasswordChange> {
  const proved = await checkOwnPassword(check, values.currentPassword, now);
  if (proved.status !== "own") return proved;
  try {
    await check.auth.api.changePassword({
      body: {
        currentPassword: values.currentPassword,
        newPassword: values.password,
        revokeOtherSessions: true,
      },
      headers: check.headers,
    });
  } catch (error) {
    if (error instanceof APIError && error.body?.code === BREACHED_CODE) {
      return { status: "breached" };
    }
    throw error;
  }
  return { status: "changed" };
}
