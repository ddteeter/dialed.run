/**
 * Products — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

import { httpsUrlSchema } from "./common";
import { fabricSchema, weightSchema } from "./garments";

// ---- Products (D-26/D-31/D-34) --------------------------------------------

/**
 * Field-level, because two schemas need the same rule under different keys:
 * `productDraftSchema` below takes `brand`/`name`, and the server function
 * that resolves brand and product together takes `brandName`/`productName`
 * to match its service signature. Written out twice, a change to the brand
 * length would land in one and not the other, and the product name cap is
 * not the garment name cap (80) — so the numbers cannot be shared any
 * further up either.
 */
export const brandNameSchema = z.string().min(1).max(60);
export const productNameSchema = z.string().min(1).max(120);

export const productDraftSchema = z.object({
  brand: brandNameSchema,
  name: productNameSchema,
  sourceUrl: httpsUrlSchema.optional(),
});
export type ProductDraft = z.infer<typeof productDraftSchema>;

/**
Multi-part by design (D-34): `verbatim` is kept exactly as published.
*/
const fabricMaterialSchema = z.object({
  material: z.string(),
  pct: z.number().min(0).max(100).optional(),
});
export const fabricPartSchema = z.object({
  part: z.string().optional(),
  materials: z.array(fabricMaterialSchema).min(1),
});
export const fabricCompositionSchema = z.object({
  verbatim: z.string(),
  parts: z.array(fabricPartSchema).optional(),
});
export type FabricComposition = z.infer<typeof fabricCompositionSchema>;

/**
 * What `products.fabric_parts` holds, on the way back out.
 *
 * The column is `text`, so a read is a trust boundary like any other even
 * though the write was ours: a row written by an older deploy, or by hand
 * against the local D1, is `unknown` until this says otherwise.
 * `JSON.parse(x) as FabricPart[]` is the violation CLAUDE.md names.
 */
export const fabricPartsSchema = z.array(fabricPartSchema);
export type FabricPart = z.infer<typeof fabricPartSchema>;

/**
What the extraction ladder emits; every field independently optional.
*/
export const extractedProductSchema = z.object({
  name: z.string().optional(),
  brand: z.string().optional(),
  categoryHint: z.string().optional(),
  fabricComposition: fabricCompositionSchema.optional(),
  weight: weightSchema.optional(),
  fabric: fabricSchema.optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
  imageUrl: httpsUrlSchema.optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
});
export type ExtractedProduct = z.infer<typeof extractedProductSchema>;

/**
Deterministic rungs (JSON-LD, Shopify JSON, OG) implement this per source.
*/
export interface PageExtractor {
  readonly rung: "jsonld" | "shopify" | "og";
  /**
   * `undefined`, not `null`, for "this rung found nothing" — `unicorn/no-null`
   * is repo policy and `src/` contains no `return null`, so the original
   * signature could not be implemented without a suppression nobody may add.
   * Changed by 107 when the first rung was written; no other lane implements
   * or calls this.
   */
  extract(url: URL, html: string): ExtractedProduct | undefined;
}

/**
LLM rung behind an adapter; eval decides the implementation (D-32).
*/
export interface ExtractionModel {
  extract(pageText: string, hint: { url: string }): Promise<ExtractedProduct>;
}
