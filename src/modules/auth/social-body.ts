/**
 * The body a Google press may send to `/sign-in/social`: the five fields
 * the app's own press posts (`googleConsentUrl`, `./credentials`), with
 * both return paths at most `RETURN_PATH_MAX` characters. Any other field,
 * or a longer path, is refused 400 before Better Auth's endpoint runs.
 *
 * And how many presses may start a sign-in: each one names a provider the
 * instance has, so Better Auth writes a state row for it, and they are
 * counted across everyone (`google-start`, `GOOGLE_STARTS_PER_HOUR`).
 */
import { APIError } from "better-auth/api";
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { GLOBAL_SUBJECT } from "../../lib/contracts/rate-limits";
import { claimLimit } from "../email";
import { GOOGLE_BUSY } from "./auth-copy";

/**
The path whose body this holds.
*/
const SOCIAL_SIGN_IN_PATH = "/sign-in/social";

/**
 * The longest return path a press may name: room for any path and query
 * the app builds.
 */
export const RETURN_PATH_MAX = 2048;

const returnPath = z.string().max(RETURN_PATH_MAX).optional();

const socialBody = z.strictObject({
  provider: z.string(),
  callbackURL: returnPath,
  errorCallbackURL: returnPath,
  disableRedirect: z.boolean().optional(),
  requestSignUp: z.boolean().optional(),
});

/**
The message a refused body is answered with.
*/
export const SOCIAL_BODY_REFUSED = "Unexpected sign-in request";

/**
A press the app's own Google button could have sent.
*/
export type SocialPress = z.infer<typeof socialBody>;

/**
 * Refuse a `/sign-in/social` body with anything beyond the app's own
 * press, and hand back the press it let through. Any other path passes,
 * with no press.
 */
export function holdSocialBody(ctx: {
  path: string;
  body?: unknown;
}): SocialPress | undefined {
  if (ctx.path !== SOCIAL_SIGN_IN_PATH) return undefined;
  const press = socialBody.safeParse(ctx.body);
  if (press.success) return press.data;
  throw new APIError("BAD_REQUEST", { message: SOCIAL_BODY_REFUSED });
}

/**
 * Count a press that will start a sign-in, or refuse it: 429 with
 * `GOOGLE_BUSY` once the hour's starts are all taken, before Better Auth
 * writes the state row. A press naming a provider the instance does not
 * have starts nothing (Better Auth answers it 404), so it is not counted.
 */
export async function countSocialStart(
  db: ReturnType<typeof drizzle>,
  providers: readonly Readonly<{ id: string }>[],
  press: SocialPress | undefined,
): Promise<void> {
  if (
    press === undefined ||
    providers.every((provider) => provider.id !== press.provider)
  )
    return;
  const claim = await claimLimit(db, "google-start", GLOBAL_SUBJECT);
  if (claim.isAllowed) return;
  throw new APIError("TOO_MANY_REQUESTS", { code: GOOGLE_BUSY });
}
