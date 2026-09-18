import type { ExtractedProduct, ExtractionModel } from "../../../lib/contracts";
import { fillBlanksFrom } from "../extracted";
import { pageTextFor } from "./page-text";

/**
 * The model rung: the one source of composition, filling whatever the
 * declared rungs left blank.
 *
 * **It runs on every page, whenever a model is configured** — the consumer
 * has no "only if a blank is left" gate any more, and this comment used to
 * say it did (PR #72 review). The gate made sense while the deterministic
 * ladder also produced compositions; when the last of those was retired
 * (owner, 2026-09-14) the ladder could no longer fill the field, so the
 * gate was a condition no page could make false and it went.
 *
 * What the model does *not* do is overwrite: `fillBlanksFrom` below is the
 * ladder's own rule, so a name or an image the shop declared in JSON-LD
 * stays, and the model's answer lands only where nothing did. That keeps
 * the cheap declared facts cheap and reserves the inference for the one
 * field nothing else can supply.
 */

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
