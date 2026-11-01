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
 */
export const httpsUrlSchema = z
  .string()
  // Round 43 #93's two words: one for what is not a link at all, and one
  // for a link on the wrong scheme. A host with no dot is not a shop's
  // page, and `javascript:` has no host, so both read as "not a link".
  // `abort` because the second check has nothing to say about a string
  // the first could not read.
  .refine((value) => URL.parse(value)?.hostname.includes(".") === true, {
    message: "That isn't a link. Paste the address of the shop's page.",
    abort: true,
  })
  .refine(
    (value) => URL.parse(value)?.protocol === "https:",
    "Use a link that starts with https://.",
  );
