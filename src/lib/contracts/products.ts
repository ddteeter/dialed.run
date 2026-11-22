/**
 * Products — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

import {
  httpsUrlSchema,
  MAX_PRODUCT_LINK_LENGTH,
  productLinkSchema,
} from "./common";
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
  sourceUrl: productLinkSchema.optional(),
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
 * How much of a fabric composition is kept (owner, 2026-11-21): about three
 * times the longest the eval corpus holds, 160 characters in a few parts.
 */
export const COMPOSITION_LIMITS = {
  verbatim: 500,
  parts: 10,
  materials: 10,
  name: 60,
} as const;

/**
The composition schemas above, each string and list held to its limit.
*/
const storedMaterialSchema = fabricMaterialSchema.extend({
  material: fabricMaterialSchema.shape.material.max(COMPOSITION_LIMITS.name),
});
const storedPartSchema = fabricPartSchema.extend({
  part: fabricPartSchema.shape.part
    .unwrap()
    .max(COMPOSITION_LIMITS.name)
    .optional(),
  materials: z
    .array(storedMaterialSchema)
    .min(1)
    .max(COMPOSITION_LIMITS.materials),
});
const storedCompositionSchema = fabricCompositionSchema.extend({
  verbatim: fabricCompositionSchema.shape.verbatim.max(
    COMPOSITION_LIMITS.verbatim,
  ),
  parts: z.array(storedPartSchema).max(COMPOSITION_LIMITS.parts).optional(),
});

/**
 * Each field as it may be stored: its own member of the schema above, and
 * a name and brand no longer than a product's own (SA-L17). A category
 * hint gets a brand's bound, being a word or two; an image's address is
 * no longer than a product link; a composition is held to
 * `COMPOSITION_LIMITS`.
 */
const storedFieldSchemas: Readonly<Record<string, z.ZodType>> = {
  ...extractedProductSchema.shape,
  name: productNameSchema,
  brand: brandNameSchema,
  categoryHint: brandNameSchema,
  imageUrl: z.string().max(MAX_PRODUCT_LINK_LENGTH).pipe(httpsUrlSchema),
  fabricComposition: storedCompositionSchema,
};

/**
 * What a page gave, keeping only the fields that pass their own schema
 * (SA-L17): a bad image costs the image, not the name beside it. Every
 * rung's answer passes through here, and so does the ledger a product
 * stores, so nothing is stored that its reader would refuse.
 */
export function validExtracted(
  candidate: Readonly<Partial<Record<keyof ExtractedProduct, unknown>>>,
): ExtractedProduct {
  const valid: ExtractedProduct = {};
  for (const [key, schema] of Object.entries(storedFieldSchemas)) {
    const value: unknown = Reflect.get(candidate, key);
    if (value !== undefined && schema.safeParse(value).success) {
      Reflect.set(valid, key, value);
    }
  }
  return valid;
}

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
