import type { DrizzleD1Database } from "drizzle-orm/d1";

import { fibreCandidates } from "../../../db/schema-core";
import type {
  ExtractedProduct,
  ExtractionModel,
  FabricComposition,
} from "../../../lib/contracts";
import { newUlid } from "../../../lib/ids";
import { fillBlanksFrom } from "../extracted";
import { isFibre } from "../fibres";
import { pageTextFor } from "./page-text";

type Db = DrizzleD1Database & { $client: D1Database };

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

/**
Every material the model named that the vocabulary does not recognise.
*/
export function unknownFibres(
  extracted: Readonly<ExtractedProduct>,
): readonly string[] {
  const composition = extracted.fabricComposition;
  return composition === undefined ? [] : unknownIn(composition);
}

function unknownIn(composition: Readonly<FabricComposition>): string[] {
  const unknown = new Set<string>();
  const parts = composition.parts ?? [];
  for (const part of parts) {
    for (const { material } of part.materials) {
      if (!isFibre(material)) unknown.add(material.toLowerCase());
    }
  }
  return [...unknown];
}

export interface ModelPassDeps {
  db: Db;
  model: ExtractionModel;
  captureException: (error: unknown, context: Record<string, string>) => void;
}

export interface ModelPass {
  extracted: ExtractedProduct;
  /**
  Whether the model actually contributed a field nothing else had.
  */
  didContribute: boolean;
}

/**
 * Ask the model, fill what it found into the blanks, and record the fibres
 * it named that we do not know.
 *
 * **A model failure is not a job failure.** Everything the deterministic
 * rungs found is already good, and the page is already stored — throwing
 * here would discard a working extraction because an optional upstream was
 * slow. The error is reported and the deterministic answer stands, which is
 * law 5 applied inside the consumer.
 */
export async function modelPass(
  deps: ModelPassDeps,
  extracted: ExtractedProduct,
  page: { html: string; url: string; snapshotId: string; productId: string },
): Promise<ModelPass> {
  try {
    const found = await deps.model.extract(pageTextFor(page.html), {
      url: page.url,
    });
    // Blanks only, and the ladder's own rule: a field a shop declared beats
    // a field a model inferred, whatever order they ran in.
    const didContribute = fillBlanksFrom(extracted, found) > 0;
    await recordCandidates(deps.db, found, page);
    return { extracted, didContribute };
  } catch (error) {
    deps.captureException(error, {
      surface: "enrichment-model",
      productId: page.productId,
    });
    return { extracted, didContribute: false };
  }
}

/**
 * The words a human will be asked to rule on.
 *
 * `INSERT OR IGNORE` against the UNIQUE (material, snapshot) index rather
 * than a read-then-write: a redelivery and a `reextract` both re-derive the
 * same candidates, and idempotency belongs in the database (law 1).
 */
async function recordCandidates(
  db: Db,
  found: Readonly<ExtractedProduct>,
  page: { snapshotId: string; productId: string },
): Promise<void> {
  const composition = found.fabricComposition;
  if (composition === undefined) return;
  const rows = unknownIn(composition).map((material) => ({
    id: newUlid(),
    material,
    productId: page.productId,
    snapshotId: page.snapshotId,
    verbatim: composition.verbatim,
    // Epoch seconds, like every other timestamp in this schema.
    seenAt: Math.floor(Date.now() / 1000),
  }));
  if (rows.length === 0) return;
  await db.insert(fibreCandidates).values(rows).onConflictDoNothing();
}
