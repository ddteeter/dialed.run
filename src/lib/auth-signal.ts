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
 * "You have not accepted the current terms" (task 126, ACC-6): the one
 * auth gate refusing a runner behind on them. Here for the same reason as
 * `AUTH_REQUIRED_CODE`: `modules/auth` throws it, and `ui/` has to tell it
 * apart — a refused write sends the runner to the terms prompt rather than
 * to a failure band (decision D-96).
 */
export const TERMS_NOT_ACCEPTED_CODE = "TERMS_NOT_ACCEPTED";

/**
 * True for the terms refusal, raised here or cloned back from a server
 * function.
 */
export function isTermsRefusal(error: unknown): boolean {
  const parsed = signalSchema.safeParse(error);
  return parsed.success && parsed.data.code === TERMS_NOT_ACCEPTED_CODE;
}

/**
 * "Confirm your email first" (design 133, decision D-113): the one
 * verification gate refusing a runner whose address is not confirmed, for a
 * write other runners see or that trusts the address. Here for the terms
 * refusal's reason: `modules/auth` throws it, and `ui/` answers it by
 * opening the confirm sheet rather than a failure band — nothing failed.
 */
export const EMAIL_UNCONFIRMED_CODE = "EMAIL_UNCONFIRMED";

/**
 * The controls that can be refused for want of a confirmed address, by
 * the name "Confirm your email first" leads with (round 27 #17: the body's
 * first word changes with the trigger). A form or control names its own;
 * the sheet, which belongs to `modules/account`, says the sentence. Here
 * because `ui/`'s hooks carry it and may not import a module.
 */
export type ConfirmTrigger = "useful" | "report" | "follow";

/**
 * True for the unconfirmed refusal, raised here or cloned back from a
 * server function.
 */
export function isUnconfirmedRefusal(error: unknown): boolean {
  const parsed = signalSchema.safeParse(error);
  return parsed.success && parsed.data.code === EMAIL_UNCONFIRMED_CODE;
}

/**
 * Parsed rather than narrowed by hand. `typeof x === "object"` plus a
 * `"code" in x` guard is three branches the compiler needs and no input can
 * distinguish — every one of them was an equivalent mutant. One schema does
 * the same job with none, and it is the house rule anyway: what arrives
 * from a server function is `unknown` until something parses it.
 */
const signalSchema = z.object({ code: z.string() });
