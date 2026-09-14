import type { ExtractedProduct } from "../../lib/contracts";
import type { productSnapshots } from "../../db/schema-core";
import { fillBlanksFrom } from "./extracted";
import { jsonLdExtractor } from "./rungs/jsonld";
import { openGraphExtractor } from "./rungs/og";
import { shopifyExtractor } from "./rungs/shopify";

type Rung = typeof productSnapshots.$inferInsert.rung;

/**
 * The deterministic ladder: declared data first, inferred data last.
 *
 * JSON-LD is a shop saying what a product *is*. Shopify's own JSON is the
 * platform saying it. Open Graph is a preview card. They are tried in that
 * order because that is the order of how much the page meant it.
 */
const RUNGS = [jsonLdExtractor, shopifyExtractor, openGraphExtractor];

export interface LadderResult {
  extracted: ExtractedProduct;
  /**
  How far down the ladder we had to go to learn anything new.
  */
  rung: Rung;
}

/**
 * Run every rung, keeping the best answer for each field.
 *
 * **The recorded rung is the deepest that contributed, not the highest.**
 * The design doc first said highest, and that is the less useful of the two.
 * The column's job is to tell a later reader whether re-running would help:
 * `reextract` exists so a better parser or a better model can be applied to
 * a stored snapshot (D-31), and a page whose every field came from JSON-LD
 * has nothing to gain from either. Recording "jsonld" because it supplied a
 * name, on a page where the composition came from a description, would hide
 * exactly the part that a later run could improve.
 *
 * `none` means no rung found anything, which is a real answer: it is the
 * page that needs the model rung, and the one worth looking at by hand.
 */
export function runLadder(url: URL, html: string): LadderResult {
  const extracted: ExtractedProduct = {};
  let rung: Rung = "none";

  for (const extractor of RUNGS) {
    const found = extractor.extract(url, html);
    if (found === undefined) continue;
    if (fillBlanksFrom(extracted, found) > 0) rung = extractor.rung;
  }

  // **The ladder does not produce a composition at all** (owner,
  // 2026-09-14). A pass that read the page's text nodes for a percentage
  // beside a known fibre used to fill it, and the eval retired it: it lost
  // every section after the first on a multi-component garment, could not
  // see `88% PA 12% EL`, and on one page answered with marketing copy —
  // confidently, plausibly and wrongly. The Shopify rung's cued read of
  // `body_html` went next, then the JSON-LD rung's `material` field, which
  // answered on 2 of 22 real pages against the model's 22 and agreed with
  // it on both.
  //
  // So `fabricComposition` has one source, and it is the model rung the
  // consumer runs after this. What these rungs are for is the cheap
  // declared facts — name on 19 of 22 pages, image on 21 — read out of a
  // payload the shop published rather than inferred from its prose.

  return { extracted, rung };
}
