/**
 * The pages the extraction eval runs against (D-32).
 *
 * **URLs, not pages.** The pages themselves are copyrighted marketing HTML
 * and this repo is public, so they are fetched on demand into a gitignored
 * cache (`eval/pages/`) rather than committed. `docs/designs/107` records
 * the same reasoning for the unit fixtures, which are trimmed fragments.
 *
 * **Chosen for spread, not for size.** The first measurement ran against
 * eight Shopify storefronts and concluded the deterministic ladder answered
 * seven of them — which was true and useless, because "answered" is not
 * "answered correctly". The spread that matters is:
 *
 * - **platform**, because the markup is the platform's: Shopify, Salesforce
 *   Commerce, and hand-rolled React storefronts all bury composition
 *   differently.
 * - **category**, because socks, gloves and headwear state fabric in ways a
 *   corpus of tees never shows.
 * - **vocabulary**, because European brands write `88% PA 12% EL` where
 *   American ones write "88% polyamide" — the abbreviation case the
 *   deterministic pass silently missed on `soarrunning`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const corpusEntrySchema = z.object({
  url: z.string(),
  brand: z.string(),
  /**
  A garment category, so a gap in the corpus is visible in the results.
  */
  category: z.string(),
});
export type CorpusEntry = z.infer<typeof corpusEntrySchema>;

/**
 * Held as JSON rather than as a TypeScript array, and that is not a
 * formality. Written out as literals — objects or tuples — twenty-two rows
 * of the same shape are a clone to any detector, and correctly so: a data
 * table *is* the same shape repeated. Moving it to data says that instead
 * of arguing with the gate about it, and a list of URLs is easier for a
 * person to edit without a compiler in the loop.
 *
 * Parsed rather than cast, like anything else read off a disk.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

const file = readFileSync(path.join(HERE, "corpus.json"), "utf8");
const parsed: unknown = JSON.parse(file);

export const CORPUS: readonly CorpusEntry[] = z
  .array(corpusEntrySchema)
  .parse(parsed);
