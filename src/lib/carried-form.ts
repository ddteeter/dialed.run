import { z } from "zod";

/**
 * Which form an expired session carried to log-in (Au7), in the notice's
 * own nouns: *"'Your run' names the carried form: 'your garment', 'your
 * settings' for the others."* Every signed-in form carries (D-151), and one
 * that is none of the three carries `page`, which the notice says as
 * "back where you were" rather than a noun invented per form.
 *
 * Here rather than in `modules/auth` because both sides of the carry name
 * it: `ui/use-form-submit` sends a form under one of these, and
 * `modules/auth` parses it back out of log-in's URL — and `ui/` may not
 * import a module.
 */
export const carriedFormSchema = z.enum(["run", "garment", "settings", "page"]);
export type CarriedForm = z.infer<typeof carriedFormSchema>;
