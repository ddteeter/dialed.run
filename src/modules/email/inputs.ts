/**
 * The email module's server-function inputs (a route file may not declare
 * a schema; see `server-functions-are-glue`).
 */
import { z } from "zod";

/**
 * An unsubscribe link's search, as it arrived — checked by its signature
 * in `switchByLink`, not here, so a malformed link lands on the "doesn't
 * work" page rather than an error.
 */
export const linkSearchInput = z.object({ search: z.unknown() });

/**
 * The unsubscribe landing's form (D-64): one button and nothing to fill,
 * because the link's own search is the whole of the permission.
 */
export const unsubscribeFormSchema = z.object({});

export { notificationSettingsSchema as notificationSettingsInput } from "../../lib/email";
