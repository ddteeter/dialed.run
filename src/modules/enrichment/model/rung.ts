import type { ExtractedProduct, ExtractionModel } from "../../../lib/contracts";
import { fillBlanksFrom } from "../extracted";
import { pageTextFor } from "./page-text";

/**
 * The model rung: run it only where the deterministic rungs left a blank,
 * and learn from what it names.
 *
 * **"Only where there is a blank" is the cost control and the quality
 * control at once.** A shop that publishes its composition in JSON-LD has
 * already answered better than a model can, so asking one is spending money
 * to get a worse answer with a chance of a wrong one. Measured over the
 * eight sampled pages, the deterministic ladder now finds a composition on
 * seven — so this fires on the eighth, and on whatever the next shop does
 * strangely.
 */

/**
 * What the model is worth calling for.
 *
 * `fabricComposition` alone, and deliberately. It is the field the lane
 * exists for and the one a page states in prose rather than in a field; the
 * rest — name, brand, image — come from Open Graph on essentially every
 * page, so a model asked for them would be an expensive way to re-read a
 * `<meta>` tag.
 *
 * One field, so one comparison: a list of fields to check reads as more
 * general and is not, since `some` and `every` cannot be told apart over a
 * single entry. When a second field earns a model call, this becomes a
 * list and the test that pins it says why.
 */
export function requiresModel(extracted: Readonly<ExtractedProduct>): boolean {
  return extracted.fabricComposition === undefined;
}

export interface ModelPassDeps {
  model: ExtractionModel;
}

export interface ModelPass {
  extracted: ExtractedProduct;
  /**
  Whether the model actually contributed a field nothing else had.
  */
  didContribute: boolean;
}

/**
 * Ask the model and fill what it found into the blanks.
 *
 * **A model failure *is* a job failure now, and that is the change** (owner,
 * 2026-09-14). While the deterministic pass also produced compositions, an
 * unreachable model cost nothing: the job wrote what the rungs found and
 * finished. Now the model is the only source of composition, so a job that
 * swallows the error writes a product with none and marks it `done` — and
 * `requestEnrichment` will not claim a `done` row again, so a transient
 * outage would permanently cost that product its composition.
 *
 * So nothing is caught here. The error reaches the consumer, the message is
 * retried, and the row stays `pending` — which is what "enrichment is
 * eventually consistent" already meant.
 */
export async function modelPass(
  deps: ModelPassDeps,
  extracted: ExtractedProduct,
  page: { html: string; url: string },
): Promise<ModelPass> {
  const found = await deps.model.extract(pageTextFor(page.html), {
    url: page.url,
  });
  // Blanks only, and the ladder's own rule: a field a shop declared beats
  // a field a model inferred, whatever order they ran in.
  return { extracted, didContribute: fillBlanksFrom(extracted, found) > 0 };
}
