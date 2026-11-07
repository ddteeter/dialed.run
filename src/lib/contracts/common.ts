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
 * **An explicit `http://` is accepted and stored as `https://`** (owner,
 * 2026-11-06, D-166; round 43 #93 as round 48 re-read it: "only a non-URL
 * errors"). The schema's output is still https only, so every reader of a
 * parsed link — an `href`, the enrichment fetch — sees nothing else.
 *
 * `httpsUrlProblem` is the check itself, as the one sentence a runner
 * reads or `undefined` for a good link: F's blur and Edit's opening error
 * ask it directly rather than digging the first issue out of a parse.
 */
export function httpsUrlProblem(value: string): string | undefined {
  // Round 43 #93's two words: one for what is not a link at all, and one
  // for a link on a scheme that is not the web's. A host with no dot is
  // not a shop's page, and `javascript:` has no host, so both read as
  // "not a link". One parse answers both, so the scheme is only asked of
  // a string that read as a URL.
  const url = URL.parse(value);
  if (!url?.hostname.includes(".")) {
    return "That isn't a link. Paste the address of the shop's page.";
  }
  return WEB_SCHEMES.has(url.protocol)
    ? undefined
    : "Use a link that starts with https://.";
}

const WEB_SCHEMES: ReadonlySet<string> = new Set(["https:", "http:"]);

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

export const httpsUrlSchema = z
  .string()
  .superRefine((value, context) => {
    const problem = httpsUrlProblem(value);
    if (problem !== undefined) context.addIssue(problem);
  })
  .transform(upgraded);
