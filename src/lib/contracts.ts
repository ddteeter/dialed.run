/**
 * Shared contracts between lanes — the code form of docs/contracts.md.
 * Changing anything here follows the schema-change protocol in CLAUDE.md.
 */
import { z } from "zod";

// ---- Common ---------------------------------------------------------------

export const httpsUrlSchema = z.string().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "must be an https:// URL");

// ---- Garments: discriminated union on category ----------------------------

export const garmentCategories = [
  "top",
  "bottom",
  "headwear",
  "neckwear",
  "gloves",
  "socks",
  "shoes",
  "accessory",
] as const;
export const layerSchema = z.enum(["base", "mid", "outer"]);
export const weightSchema = z.enum(["light", "mid", "heavy"]);
export const fabricSchema = z.enum([
  "synthetic",
  "merino",
  "cotton",
  "blend",
  "down",
]);

const garmentBase = z.strictObject({
  name: z.string().min(1).max(80),
  brand: z.string().max(60).optional(),
  size: z.string().max(20).optional(),
  color: z.string().max(30).optional(),
  productUrl: httpsUrlSchema.optional(),
  productId: z.string().optional(),
  estTempLowC: z.number().optional(),
  estTempHighC: z.number().optional(),
});
const layered = garmentBase.extend({
  layer: layerSchema.optional(),
  weight: weightSchema.optional(),
  fabric: fabricSchema.optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
});
export const garmentSchema = z.discriminatedUnion("category", [
  layered.extend({ category: z.literal("top") }),
  layered.extend({ category: z.literal("bottom") }),
  garmentBase.extend({
    category: z.literal("headwear"),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
    windResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("neckwear"),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
  }),
  garmentBase.extend({
    category: z.literal("gloves"),
    weight: weightSchema.optional(),
    windResistant: z.boolean().optional(),
    waterResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("socks"),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
  }),
  garmentBase.extend({
    category: z.literal("shoes"),
    waterResistant: z.boolean().optional(),
  }),
  garmentBase.extend({ category: z.literal("accessory") }),
]);
export type Garment = z.infer<typeof garmentSchema>;

/**
 * Closet UI groups — the code form of docs/contracts.md's derived-group
 * table (design screen C). Derived from category x layer, never stored.
 *
 * Here rather than in modules/closet because it is a shared contract with
 * two consumers: the closet renders it and the feed's kit picker groups by
 * it. Lane 104 wrote its own copy for exactly that reason, with a comment
 * saying the predicate table was the shared thing and the code was not —
 * which is how two implementations of one table start.
 */
export const uiGroups = [
  "tops",
  "bottoms",
  "outer",
  "hands_head",
  "shoes",
  "socks_extras",
] as const;
export type UiGroup = (typeof uiGroups)[number];

/**
 * Which group an item falls in. A product judgement keyed by category, not
 * a restatement of the garment schema — headwear, neckwear and gloves
 * share a group because that is how the screen is laid out, and nothing in
 * the union says so. So this is a table, deliberately, and the
 * derive-don't-mirror rule does not apply to it.
 */
export function uiGroupFor(
  category: Garment["category"],
  layer: z.infer<typeof layerSchema> | null,
): UiGroup {
  if (layer === "outer") return "outer";
  switch (category) {
    case "top": {
      return "tops";
    }
    case "bottom": {
      return "bottoms";
    }
    case "headwear":
    case "neckwear":
    case "gloves": {
      return "hands_head";
    }
    case "shoes": {
      return "shoes";
    }
    case "socks":
    case "accessory": {
      return "socks_extras";
    }
  }
}

/**
 * Performance buckets (D-27): how an item is doing, derived from verdict
 * history. Shared so the zod filter enum and the TypeScript type cannot
 * drift — they were two independent lists before.
 */
export const performanceBuckets = [
  "most_dialed",
  "never_worked",
  "untested",
  "retire_candidate",
] as const;
export const performanceBucketSchema = z.enum(performanceBuckets);
export type PerformanceBucket = (typeof performanceBuckets)[number];

// ---- Products (D-26/D-31/D-34) --------------------------------------------

export const productDraftSchema = z.object({
  brand: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
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
  extract(url: URL, html: string): ExtractedProduct | null;
}

/**
LLM rung behind an adapter; eval decides the implementation (D-32).
*/
export interface ExtractionModel {
  extract(pageText: string, hint: { url: string }): Promise<ExtractedProduct>;
}

// ---- Verdicts (D-05/D-12) -------------------------------------------------

export const verdictSchema = z.number().int().min(-2).max(2);

/**
 * The verdict scale, once. Coldest to warmest — the order the A3 choices
 * render in, so no screen keeps its own array.
 *
 * `token` is the stored/analytics form and `label` is the only user-facing
 * wording (UI lexicon, docs/product.md §Brand). Both live on the same row
 * because they were previously three tables: a token map here that nothing
 * ever imported, plus display labels open-coded twice over in
 * feed/entry.$entryId.tsx and feed/verdict.$entryId.tsx — free to disagree
 * about what "0" is called, and in practice already drifting.
 */
export const verdictScale = [
  { value: -2, token: "way_cold", label: "Way cold" },
  { value: -1, token: "bit_cold", label: "A bit cold" },
  { value: 0, token: "dialed", label: "Dialed" },
  { value: 1, token: "bit_warm", label: "A bit warm" },
  { value: 2, token: "way_warm", label: "Way warm" },
] as const;
export type VerdictValue = (typeof verdictScale)[number]["value"];

/**
User-facing wording for a stored verdict; `undefined` if out of range.
*/
export function verdictLabel(value: number): string | undefined {
  return verdictScale.find((entry) => entry.value === value)?.label;
}
export const itemFlagSchema = z.enum(["too_much", "not_enough"]);
export const entryTags = [
  "cold_first_mile",
  "cold_throughout",
  "overheated_late",
  "sleeves_damp",
  "chafed",
  "perfect_warmup",
  "wind_cut_through",
  "hands_cold",
  "hands_sweaty",
] as const;
export const entryTagSchema = z.enum(entryTags);

// ---- Runs -----------------------------------------------------------------

export const runSources = ["manual", "file"] as const;
export const effortSchema = z.enum(["easy", "steady", "workout", "race"]);
export const runDraftSchema = z.object({
  startedAt: z.number().int().positive(),
  durationS: z.number().int().positive(),
  distanceM: z.number().positive(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  indoor: z.boolean().default(false),
  effort: effortSchema.optional(),
  title: z.string().min(1).max(120),
});
export type RunDraft = z.infer<typeof runDraftSchema>;

/**
Every import path (file parser now; Polar/Fitbit later) produces this.
*/
export interface RunSource {
  readonly kind: "fit" | "gpx" | "tcx";
  parse(bytes: ArrayBuffer): Promise<RunDraft>;
}

// ---- Weather --------------------------------------------------------------

export const weatherObservationSchema = z.object({
  tempC: z.number(),
  feelsLikeC: z.number(),
  humidity: z.number().min(0).max(100),
  windKph: z.number().min(0),
  precipMm: z.number().min(0),
  condition: z.string(),
});
export type WeatherObservation = z.infer<typeof weatherObservationSchema>;

export interface WeatherProvider {
  /**
  Historical/near-past conditions at a time+place (for imports).
  */
  observation(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
  /**
  Forecast at a future time+place (for the call, post-MVP).
  */
  forecast(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
}

// ---- Onboarding / profile -------------------------------------------------

/** UI: +2 "always freezing" … −2 "sweating in a t-shirt at 40°".
 *  Degree mapping (code, not DB): level × 2.2 °C. */
export const thermalLevelSchema = z.number().int().min(-2).max(2);
export const CALL_VERDICT_THRESHOLD = 15;
