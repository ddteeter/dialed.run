import { redirect } from "@tanstack/react-router";
import { z } from "zod";

import { landingAfterSignIn, returnPathSchema } from "../../lib/return-path";

/**
 * What the log-in page can be handed in its URL: Au7's arrival.
 *
 * The Form Contract routes an expired session to sign-in *carrying the
 * payload*, and the Auth board draws where that lands: *"A square notice
 * above the heading, email prefilled, focus on Password … After Log in,
 * the runner lands on the filled form they left."* So the arrival carries
 * two things in its URL, each optional — and the email beside it, out of
 * the URL — and a plain visit to `/auth/login` carries none of them and is
 * simply Au2.
 *
 * Search params are a trust boundary like any other input, so they are
 * parsed rather than read — and **a bad value is dropped, never an
 * error**: someone who edits the URL gets the ordinary log-in page, not a
 * failure screen for a form they have not touched.
 */

/**
 * Which form was carried, in the notice's own nouns: *"'Your run' names
 * the carried form: 'your garment', 'your settings' for the others."*
 */
const carriedFormSchema = z.enum(["run", "garment", "settings"]);
export type CarriedForm = z.infer<typeof carriedFormSchema>;

/**
 * What Better Auth appends to the error callback when Google's round trip
 * fails: `?error=<code>`. Only read, never shown — the band says its own
 * sentence — so any short string is kept.
 */
const googleErrorSchema = z.string().max(100);

/**
 * An invite code from `/join?code=` (ACC-5), kept only if it is short
 * enough to be one; the form parses it properly.
 */
const inviteSearchSchema = z.string().max(20);

export interface SignInSearch {
  redirect?: string | undefined;
  carried?: CarriedForm | undefined;
  /**
  Au2's invite code, filled in from an invite link.
  */
  code?: string | undefined;
  /**
  Google's round trip came back refused (see `didGoogleFail`).
  */
  error?: string | undefined;
}

/**
One value, or nothing when it is not one.
*/
function kept<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Both auth routes' `validateSearch`. Each field is parsed on its own, so
 * one bad value costs only itself.
 *
 * **No email.** Au7 prefills the email, but a URL is the wrong place to
 * carry one: it lands in the Workers request log and the browser's
 * history. It travels in session storage instead — see `useCarriedEmail`.
 */
export function parseSignInSearch(
  search: Readonly<Record<string, unknown>>,
): SignInSearch {
  return {
    redirect: kept(returnPathSchema, search.redirect),
    carried: kept(carriedFormSchema, search.carried),
    error: kept(googleErrorSchema, search.error),
    code: kept(inviteSearchSchema, search.code),
  };
}

/**
 * `/join`'s answer: on to Au2 with the code filled in — the invite
 * email's "Create your account" and D7's Copy link both land here.
 */
export function onToSignUp(search: { code?: string | undefined }): void {
  redirect({
    to: "/auth/signup",
    search: { code: search.code },
    throw: true,
  });
}

/**
`/join`'s search: the code, and nothing else.
*/
export function joinSearch(
  search: Readonly<Record<string, unknown>>,
): { code?: string | undefined } {
  return { code: kept(inviteSearchSchema, search.code) };
}

/**
 * Round 22, Au6: *"Cancelled in the popup is not an error: return to rest,
 * silently."* Google reports a refused consent as `access_denied`; every
 * other code is a failure the runner is told about.
 */
export function didGoogleFail(error: string | undefined): boolean {
  return error !== undefined && error !== "access_denied";
}

/**
 * Where Google's round trip lands, both ways.
 *
 * Success goes where the log-in would have (`redirect`, or home). Failure
 * comes back to *the page it left from* — sign-up stays sign-up — carrying
 * the same `redirect` and `carried`, so a failed Google attempt from Au7
 * is still Au7, with its notice and its way back.
 */
export function googleReturn(
  page: "/auth/login" | "/auth/signup",
  search: SignInSearch,
): { callbackURL: string; errorCallbackURL: string } {
  const back = new URLSearchParams();
  if (search.redirect !== undefined) back.set("redirect", search.redirect);
  if (search.carried !== undefined) back.set("carried", search.carried);
  // A refused Google attempt from Au2 comes back with its code still in
  // the field.
  if (search.code !== undefined) back.set("code", search.code);
  const query = back.toString();
  return {
    // Validated again here, at the point of use, rather than trusted
    // because `parseSignInSearch` ran: this is where the runner is sent.
    callbackURL: landingAfterSignIn(search.redirect),
    errorCallbackURL: query === "" ? page : `${page}?${query}`,
  };
}
