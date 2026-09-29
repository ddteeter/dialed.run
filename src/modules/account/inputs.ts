/**
 * The account module's server-function inputs, parsed at the trust
 * boundary (a route file may not declare a schema; see
 * `server-functions-are-glue`).
 */
import { z } from "zod";

import { requestAccessSchema } from "../../lib/contracts";
import { rowIdSchema } from "../../lib/ids";

/**
 * Au4's Resend and the nag's: the address the link goes to. Parsed loosely
 * — an address that is not one simply has no account, and the answer is
 * the same.
 */
export const resendInput = z.object({ email: z.string().max(320) });

/**
 * The confirm link's token, as it arrived in the search — the page's own
 * parse, so a mangled link reaches the server as no token and lands on
 * "That link has run out".
 */
export { tokenSearch as confirmInput } from "./route-decisions";

export { changeEmailSchema as changeEmailInput } from "../../lib/contracts";

/**
 * Au5's request as the server takes it: the form's fields and the
 * Turnstile token the widget handed the form.
 */
export const requestAccessInput = requestAccessSchema.extend({
  turnstileToken: z.string().max(2048).optional(),
});

/**
 * D7's New code (undrawn beyond "a label, a uses limit"): the label names
 * who it is for, and the limit is a whole number from 1 to 100.
 */
const USES_MESSAGE = "Use a whole number from 1 to 100.";
export const newInviteSchema = z.object({
  label: z.string().max(60, "Keep the label under 60 characters."),
  maxUses: z.coerce
    .number(USES_MESSAGE)
    .int(USES_MESSAGE)
    .min(1, USES_MESSAGE)
    .max(100, USES_MESSAGE),
});

export const newInviteInput = newInviteSchema.extend({
  idempotencyKey: z.string().min(1).max(64),
});

/**
One request or one code, by id — D7's row actions.
*/
export const deskRowInput = z.object({ id: rowIdSchema });

/**
 * Which legal text a page reads (ACC-13). Only the texts that exist:
 * `/terms` and `/copyright` join when the owner's texts do.
 */
const legalSlugSchema = z.enum(["privacy"]);
export type LegalSlug = z.infer<typeof legalSlugSchema>;
export const legalPageInput = z.object({ slug: legalSlugSchema });
