/**
 * The body a Google press may send to `/sign-in/social`: the five fields
 * the app's own press posts (`googleConsentUrl`, `./credentials`), with
 * both return paths at most `RETURN_PATH_MAX` characters. Any other field,
 * or a longer path, is refused 400 before Better Auth's endpoint runs.
 */
import { APIError } from "better-auth/api";
import { z } from "zod";

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
 * Refuse a `/sign-in/social` body with anything beyond the app's own
 * press. Any other path passes.
 */
export function holdSocialBody(ctx: { path: string; body?: unknown }): void {
  if (
    ctx.path !== SOCIAL_SIGN_IN_PATH ||
    socialBody.safeParse(ctx.body).success
  )
    return;
  throw new APIError("BAD_REQUEST", { message: SOCIAL_BODY_REFUSED });
}
