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
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { passwordAttempts } from "../../db/schema-core";
import { PASSWORD_ATTEMPTS_PER_WINDOW } from "../../lib/contracts";
import { nowSeconds } from "../../lib/now";
import {
  windowedCountSet,
  windowedCountUntil,
} from "../../lib/sql/window-count";

type Db = ReturnType<typeof drizzle>;

/**
 * Only the call this file makes — narrower than Better Auth's own
 * `verifyPassword` endpoint type (which carries an `options`/`path` pair
 * alongside several call-shape overloads, none of which this file uses),
 * both because that is all this needs and because it is what lets a test
 * double stand in for `auth` without implementing the rest of that shape.
 * The real instance satisfies this structurally — it does strictly more.
 */
interface Auth {
  readonly api: {
    readonly verifyPassword: (input: {
      body: { password: string };
      headers: Headers;
    }) => Promise<unknown>;
  };
}

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

/**
 * Tries at the current password a runner gets per window
 * (`PASSWORD_ATTEMPTS_PER_WINDOW`, in `lib/contracts` so the refusal can
 * say it). Better Auth's own limiter counts HTTP requests to its
 * endpoints, and a server-side `auth.api.verifyPassword` never passes
 * through it, so this is the only thing between an open session and
 * unlimited guesses.
 */
export const PASSWORD_ATTEMPT_WINDOW_S = 15 * 60;

/**
 * Count one try, and say when the runner may try again if this one is over
 * the limit — `undefined` when it may go ahead. One statement, as the
 * email send limit is (`windowedCountSet`), and counted before the check,
 * so a try that is refused is still a try.
 */
async function claimAttempt(
  db: Db,
  userId: string,
  now: number,
): Promise<number | undefined> {
  const next = windowedCountSet(
    {
      startedAt: passwordAttempts.windowStartedAt,
      count: passwordAttempts.attempts,
    },
    now,
    PASSWORD_ATTEMPT_WINDOW_S,
  );
  const rows = await db
    .insert(passwordAttempts)
    .values({ userId, windowStartedAt: now, attempts: 1 })
    .onConflictDoUpdate({
      target: passwordAttempts.userId,
      set: { windowStartedAt: next.startedAt, attempts: next.count },
    })
    .returning({
      startedAt: passwordAttempts.windowStartedAt,
      count: passwordAttempts.attempts,
    });
  return windowedCountUntil(
    rows,
    PASSWORD_ATTEMPTS_PER_WINDOW,
    PASSWORD_ATTEMPT_WINDOW_S,
  );
}

export type PasswordCheck =
  | { readonly status: "own" }
  | { readonly status: "wrong" }
  | {
      readonly status: "limited";
      /**
      When the next try may go, in epoch seconds.
      */
      readonly until: number;
    };

/**
 * `isOwnPassword`, limited per runner: past the limit the password is not
 * checked at all, and the right one clears the count.
 */
export async function checkOwnPassword(
  check: Readonly<{ auth: Auth; db: Db; userId: string; headers: Headers }>,
  password: string,
  now = nowSeconds(),
): Promise<PasswordCheck> {
  const until = await claimAttempt(check.db, check.userId, now);
  if (until !== undefined) return { status: "limited", until };
  if (!(await isOwnPassword(check.auth, check.headers, password))) {
    return { status: "wrong" };
  }
  await check.db
    .delete(passwordAttempts)
    .where(eq(passwordAttempts.userId, check.userId));
  return { status: "own" };
}
