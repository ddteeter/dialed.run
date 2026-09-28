/**
 * The account module's server-function inputs, parsed at the trust
 * boundary (a route file may not declare a schema; see
 * `server-functions-are-glue`).
 */
import { z } from "zod";

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
