import { z } from "zod";

/**
 * What the log-in page can be handed in its URL: Au7's arrival.
 *
 * The Form Contract routes an expired session to sign-in *carrying the
 * payload*, and the Auth board draws where that lands: *"A square notice
 * above the heading, email prefilled, focus on Password … After Log in,
 * the runner lands on the filled form they left."* So the arrival carries
 * three things, each optional, and a plain visit to `/auth/login` carries
 * none of them and is simply Au2.
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
 * Where to go back to: a path on this site, and never the auth pages
 * themselves.
 *
 * **Same-origin by construction**, because an open redirect on a log-in
 * page is the textbook phishing aid: `//evil.example` is a protocol-
 * relative URL to another host, and `/\evil.example` is read the same way
 * by browsers that normalise the backslash. Only a single leading slash
 * followed by something else is accepted.
 */
const returnPathSchema = z
  .string()
  .regex(/^\/(?![/\\])/u)
  .refine((path) => !path.startsWith("/auth"));

const emailSchema = z.email();

export interface SignInSearch {
  redirect?: string | undefined;
  carried?: CarriedForm | undefined;
  email?: string | undefined;
}

/**
One value, or nothing when it is not one.
*/
function kept<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The log-in route's `validateSearch`. Each field is parsed on its own, so
 * one bad value costs only itself.
 */
export function parseSignInSearch(
  search: Readonly<Record<string, unknown>>,
): SignInSearch {
  return {
    redirect: kept(returnPathSchema, search.redirect),
    carried: kept(carriedFormSchema, search.carried),
    email: kept(emailSchema, search.email),
  };
}
