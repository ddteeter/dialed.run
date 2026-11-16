/**
 * Email sign-in's tries per typed address (owner, 2026-11-15): ten in
 * fifteen minutes (`SIGN_IN_TRIES`), counted in `rate_limits` under
 * `sign-in`.
 *
 * **Every try is counted before the password is checked**, and a sign-in
 * that works clears the count, so what is left is the wrong ones. The
 * count is one upsert, so two tries at once cannot both read nine. Past
 * the limit even the right password is refused until the window ends:
 * the answer cannot depend on the password without saying which one was
 * right.
 *
 * **An address with no account is counted the same way**, and refused the
 * same way, so the limit says nothing about which addresses have one.
 */
import { APIError, type createAuthMiddleware } from "better-auth/api";
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { SIGN_IN_LIMITED_CODE } from "../../lib/contracts/access";
import { claimSignInTry, forgetSignInTries } from "../email";

type Db = ReturnType<typeof drizzle>;
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
Better Auth's email sign-in, as its hooks name it.
*/
export const SIGN_IN_EMAIL_PATH = "/sign-in/email";

/**
 * The typed address. A body without one is Better Auth's to refuse; it
 * signs nobody in, so there is nothing to count.
 */
const signInBody = z.object({ email: z.string() });

function typedAddress(ctx: HookContext): string | undefined {
  if (ctx.path !== SIGN_IN_EMAIL_PATH) return undefined;
  const body = signInBody.safeParse(ctx.body);
  return body.success ? body.data.email : undefined;
}

/**
 * Count the try, or refuse it: 429 with `SIGN_IN_LIMITED_CODE` and
 * `until`, which the log-in band turns into the owner's sentence.
 */
export async function countSignInTry(db: Db, ctx: HookContext): Promise<void> {
  const address = typedAddress(ctx);
  if (address === undefined) return;
  const claim = await claimSignInTry(db, address);
  if (claim.isAllowed) return;
  throw new APIError("TOO_MANY_REQUESTS", {
    code: SIGN_IN_LIMITED_CODE,
    until: claim.until,
  });
}

/**
A sign-in that made a session clears the address's count.
*/
export async function clearSignInTries(
  db: Db,
  ctx: HookContext,
): Promise<void> {
  const address = typedAddress(ctx);
  if (address === undefined || !ctx.context.newSession) return;
  await forgetSignInTries(db, address);
}
