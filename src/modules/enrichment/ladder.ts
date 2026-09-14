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

  // **No prose search here any more, and that is the lane's biggest
  // decision** (owner, 2026-09-14). A pass that read the page's text nodes
  // for a percentage beside a known fibre used to fill this field, and the
  // eval retired it: it lost every section after the first on a
  // multi-component garment, it could not see `88% PA 12% EL` because the
  // vocabulary has no abbreviations, and on one page it answered with
  // marketing copy — confidently, plausibly and wrongly. Composition now
  // comes from the model rung, or it waits.
  //
  // What is left here is *declared* data. The JSON-LD rung reads a
  // `material` field a shop published and the Shopify rung reads a cued
  // stretch of `body_html`; both hand that string to `parseComposition`,
  // which is unchanged. Reading a field someone published is not the same
  // act as guessing from prose, and only the guessing was retired.

  return { extracted, rung };
}
