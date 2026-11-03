/**
 * Common — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

// ---- Common ---------------------------------------------------------------

/**
 * An https URL, checked by parsing rather than by pattern.
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
 * `httpsUrlProblem` is the check itself, as the one sentence a runner
 * reads or `undefined` for a good link: F's blur and Edit's opening error
 * ask it directly rather than digging the first issue out of a parse.
 */
export function httpsUrlProblem(value: string): string | undefined {
  // Round 43 #93's two words: one for what is not a link at all, and one
  // for a link on the wrong scheme. A host with no dot is not a shop's
  // page, and `javascript:` has no host, so both read as "not a link".
  // One parse answers both, so the scheme is only asked of a string that
  // read as a URL.
  const url = URL.parse(value);
  if (!url?.hostname.includes(".")) {
    return "That isn't a link. Paste the address of the shop's page.";
  }
  return url.protocol === "https:"
    ? undefined
    : "Use a link that starts with https://.";
}

export const httpsUrlSchema = z.string().superRefine((value, context) => {
  const problem = httpsUrlProblem(value);
  if (problem !== undefined) context.addIssue(problem);
});
