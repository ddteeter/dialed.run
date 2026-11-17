/**
 * Common — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

import { isOwnHost } from "../domain";

// ---- Common ---------------------------------------------------------------

/**
 * A link, checked by parsing rather than by pattern.
 *
 * `URL.parse` returns null instead of throwing, which is why there is no
 * try/catch here any more. The old version wrapped `new URL` and returned
 * false from a `catch` — behaviourally identical, but the catch body was a
 * mutant nothing could kill (an empty catch returns undefined, which zod
 * rejects exactly as false does) and a Stryker directive cannot attach
 * above a `} catch {`. Removing the construct beat exempting it.
 *
 * A scheme allowlist rather than a prefix check because the value reaches
 * an `href`: `javascript:` parses as a URL perfectly well.
 *
 * Round 43 #93's two words: one for what is not a link at all, and one for
 * a link on a scheme not allowed here. A host with no dot is not a shop's
 * page, and `javascript:` has no host, so both read as "not a link". One
 * parse answers both, so the scheme is only asked of a string that read as
 * a URL.
 */
function linkProblem(
  value: string,
  schemes: ReadonlySet<string>,
): string | undefined {
  const url = URL.parse(value);
  if (!url?.hostname.includes(".")) {
    return "That isn't a link. Paste the address of the shop's page.";
  }
  if (isOwnHost(url.hostname)) {
    return "That's a dialed.run page. Paste the address of the shop's page.";
  }
  return schemes.has(url.protocol)
    ? undefined
    : "Use a link that starts with https://.";
}

const HTTPS_ONLY: ReadonlySet<string> = new Set(["https:"]);
const WEB_SCHEMES: ReadonlySet<string> = new Set(["https:", "http:"]);

/**
 * An https URL and nothing else: what the build reads or fetches itself,
 * such as a product page's image (`extractedProductSchema`). Plain
 * refinement, no transform, because the enrichment model is handed this
 * contract as JSON Schema, and a transform cannot be written there.
 */
export function httpsUrlProblem(value: string): string | undefined {
  return linkProblem(value, HTTPS_ONLY);
}

export const httpsUrlSchema = z.string().superRefine((value, context) => {
  const problem = httpsUrlProblem(value);
  if (problem !== undefined) context.addIssue(problem);
});

/**
 * A product link a runner typed (F's link, a product's source page).
 * **An explicit `http://` is accepted and stored as `https://`** (owner,
 * 2026-11-06, D-166; round 43 #93 as round 48 re-read it: "only a non-URL
 * errors"). The parsed value is still https only, so every reader of it —
 * an `href`, the enrichment fetch — sees nothing else.
 *
 * `productLinkProblem` is the check itself, as the one sentence a runner
 * reads or `undefined` for a good link: F's blur and Edit's opening error
 * ask it directly rather than digging the first issue out of a parse.
 */
export function productLinkProblem(value: string): string | undefined {
  return value.length > MAX_PRODUCT_LINK_LENGTH
    ? PRODUCT_LINK_TOO_LONG
    : linkProblem(value, WEB_SCHEMES);
}

/**
 * The longest product link kept (SA-M17): longer than any shop's page
 * address, and short enough that a link is never a store of text.
 */
export const MAX_PRODUCT_LINK_LENGTH = 2048;

/**
The sentence for a link past it (owner, 2026-11-16).
*/
export const PRODUCT_LINK_TOO_LONG =
  "That link is too long. Paste the shop page's address.";

/**
 * The same link on https. Only the scheme moves: the rest is the runner's
 * own text, so a link that was already https comes back exactly as typed
 * rather than as `URL`'s normalised spelling of it.
 */
function upgraded(value: string): string {
  // Runs only on a value the refinement passed, so its scheme is one of
  // the two, in either case.
  return value.replace(HTTP_SCHEME, "https:");
}

const HTTP_SCHEME = /^http:/iu;

export const productLinkSchema = z
  .string()
  .superRefine((value, context) => {
    const problem = productLinkProblem(value);
    if (problem !== undefined) context.addIssue(problem);
  })
  .transform(upgraded);
