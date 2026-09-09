/**
 * "You are not signed in", as a value both sides can recognise.
 *
 * It lives in `lib/` rather than in `modules/auth` because two layers need
 * it and they cannot reach each other: `modules/auth` throws it, and
 * `ui/use-form-submit` has to tell it apart from a network failure or a
 * 500 — but `ui/` may not import `modules/` (dependency-cruiser,
 * "foundation-stays-foundation"). Without a shared definition the UI's only
 * option was matching the error's *message text* with a regex, which is the
 * kind of thing that silently stops working.
 *
 * `code` rather than `instanceof`: a server function's rejection is
 * structurally cloned on the way back, so the prototype is gone by the time
 * a component sees it. A plain own property survives that trip.
 */
import { z } from "zod";

export const AUTH_REQUIRED_CODE = "AUTH_REQUIRED";

/**
 * True for the error raised in this isolate *and* for the cloned shape a
 * server-function call rejects with.
 */
export function isAuthRequired(error: unknown): boolean {
  const parsed = signalSchema.safeParse(error);
  return parsed.success && parsed.data.code === AUTH_REQUIRED_CODE;
}

/**
 * Parsed rather than narrowed by hand. `typeof x === "object"` plus a
 * `"code" in x` guard is three branches the compiler needs and no input can
 * distinguish — every one of them was an equivalent mutant. One schema does
 * the same job with none, and it is the house rule anyway: what arrives
 * from a server function is `unknown` until something parses it.
 */
const signalSchema = z.object({ code: z.string() });
