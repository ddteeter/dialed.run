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
  .refine(
    (value) => URL.parse(value)?.protocol === "https:",
    "Product links need to start with https://",
  );
