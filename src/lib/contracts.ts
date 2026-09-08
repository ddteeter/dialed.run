/**
 * Shared contracts between lanes — the code form of docs/contracts.md.
 * Changing anything here follows the schema-change protocol in CLAUDE.md.
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
    "must be an https:// URL",
  );

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
/**
 * The specific thing a garment *is*, within its category. A `top` is a
 * singlet or a tee or a half-zip; the category alone cannot tell you, and
 * anything that has to show a garment — an icon, a recommendation, a
 * consensus bucket — needs to know which.
 *
 * The vocabulary is not invented here. It is the design's own: the P2
 * tap-list is a list of these ("SINGLET · SHORT-SLEEVE TEE · MERINO BASE
 * L/S · HALF-ZIP · 5\u2033 SHORTS · TIGHTS · WIND SHELL · BEANIE · BUFF"),
 * and the Icon Pack draws one glyph per entry to render it. So the values
 * are named for the glyphs and a garment's icon *is* its type — an identity
 * function rather than a mapping table anyone could get wrong. A test in
 * `test/garment-fields.test.ts` fails if the two ever drift apart.
 *
 * Display labels stay free text on `name`. "Wind shell" and "Rain jacket"
 * are both `jacket`, told apart by `windResistant`/`waterResistant`;
 * "Mittens" is `gloves`; "Trail shoes" is `shoes`; "Buff" is `neckGaiter`.
 * The type says what shape a thing is, not what it is for.
 *
 * Optional everywhere, because it has to be: every garment written before
 * this column existed has none, and CLAUDE.md law 8 is expand-then-contract.
 * Treat `undefined` as "not known yet", never as a category default.
 */
/**
 * A WGS84 coordinate pair, bounded. Written out four times before this —
 * twice here and twice in `modules/feed/functions.ts` — which is four
 * places to get a sign or a bound wrong, and no way for them to disagree
 * loudly.
 */
/**
 * Sign-in and sign-up, the two forms with no server function of their own —
 * Better Auth owns the endpoints, so this schema is the *only* validation
 * before the request goes out.
 *
 * Error copy lives here, in zod's `message`, and nowhere else (§Forms &
 * failure, "Error copy lives in the schema"). A component authoring its own
 * sentence is the four-lanes problem in miniature: same rule, four
 * wordings. The copy rules are binding — one sentence, under ten words,
 * sentence case, ends in a period, and it names the fix rather than the
 * rule ("Use at least 8 characters", not "Value too short").
 *
 * Lives in contracts rather than the design's suggested `lib/schemas/`
 * because this file already *is* that module: importable by both sides,
 * importing nothing from a server.
 */
const emailField = z
  .string()
  .min(1, "Enter your email address.")
  .check(z.email("That does not look like an email address."));

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  name: z.string().min(1, "Tell us what to call you.").max(60),
  email: emailField,
  // Better Auth's own floor is 8; stating it here is what lets the form say
  // so before the round trip rather than after it.
  password: z.string().min(8, "Use at least 8 characters."),
});

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const garmentTypesByCategory = {
  // `sportsBra` and `armSleeves` arrived with the Icon Pack marked
  // provisional. They are real tap-list rows on P2 (ARM WARMERS is on the
  // screen), so they ship.
  top: [
    "singlet",
    "tee",
    "longSleeve",
    "halfZip",
    "jacket",
    "vest",
    "sportsBra",
  ],
  bottom: ["shorts", "halfTights", "tights"],
  headwear: ["cap", "beanie", "headband"],
  neckwear: ["neckGaiter"],
  gloves: ["gloves"],
  socks: ["socks"],
  shoes: ["shoes"],
  accessory: ["sunglasses", "armSleeves"],
} as const;

export const garmentSchema = z.discriminatedUnion("category", [
  layered.extend({
    category: z.literal("top"),
    type: z.enum(garmentTypesByCategory.top).optional(),
  }),
  layered.extend({
    category: z.literal("bottom"),
    type: z.enum(garmentTypesByCategory.bottom).optional(),
  }),
  garmentBase.extend({
    category: z.literal("headwear"),
    type: z.enum(garmentTypesByCategory.headwear).optional(),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
    windResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("neckwear"),
    type: z.enum(garmentTypesByCategory.neckwear).optional(),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
  }),
  garmentBase.extend({
    category: z.literal("gloves"),
    type: z.enum(garmentTypesByCategory.gloves).optional(),
    weight: weightSchema.optional(),
    windResistant: z.boolean().optional(),
    waterResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("socks"),
    type: z.enum(garmentTypesByCategory.socks).optional(),
    weight: weightSchema.optional(),
    fabric: fabricSchema.optional(),
  }),
  garmentBase.extend({
    category: z.literal("shoes"),
    type: z.enum(garmentTypesByCategory.shoes).optional(),
    waterResistant: z.boolean().optional(),
  }),
  garmentBase.extend({
    category: z.literal("accessory"),
    type: z.enum(garmentTypesByCategory.accessory).optional(),
  }),
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
 * Group headings, as they appear on screen C. Here rather than in a lane
 * because the closet renders them and the feed's kit picker renders the
 * same headings over the same rows — a second copy would let one screen
 * rename a group and the other not.
 */
export const uiGroupLabels: Record<UiGroup, string> = {
  tops: "Tops",
  bottoms: "Bottoms",
  outer: "Outer",
  hands_head: "Hands / head",
  shoes: "Shoes",
  socks_extras: "Socks / extras",
};

/**
 * Which group an item falls in. A product judgement keyed by category, not
 * a restatement of the garment schema — headwear, neckwear and gloves
 * share a group because that is how the screen is laid out, and nothing in
 * the union says so. So this is a table, deliberately, and the
 * derive-don't-mirror rule does not apply to it.
 */
export function uiGroupFor(
  category: Garment["category"],
  // `null` because a drizzle row gives null for an unset column, and
  // `undefined` because a parsed `Garment` gives that for the same fact.
  // Both mean "no layer" and the function does not care which.
  layer: z.infer<typeof layerSchema> | null | undefined,
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
  // Messages are here, not in the form (§Forms & failure, "Error copy lives
  // in the schema"). They name the fix, not the rule: the manual-entry form
  // is the only place a human types these, and "Value out of range" tells
  // them nothing about what to do next. A parser filling this in gets the
  // same sentences, which is fine — nothing shows them to anyone.
  startedAt: z.number().int().positive("Pick when the run started."),
  durationS: z.number().int().positive("How many minutes did it take?"),
  distanceM: z.number().positive("How far did you go?"),
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
  indoor: z.boolean().default(false),
  effort: effortSchema.optional(),
  title: z.string().min(1, "Give the run a name.").max(120),
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
