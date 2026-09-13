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
    "Product links need to start with https://",
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
/**
 * The words a category goes by on screen.
 *
 * Here rather than in `GarmentForm`, because it was there and P2.5 needs
 * the same words: design's Z ruling makes a generic garment's subtitle
 * `type ?? categoryLabel + " · GENERIC"`, so the naming screen and the add
 * form must agree on what a `neckwear` is called. A second copy is how one
 * screen ends up saying "Neck" and the other "Neckwear" — the same rival
 * truth `uiGroupLabels` below already exists to prevent.
 */
export const garmentCategoryLabels = {
  top: "Top",
  bottom: "Bottom",
  headwear: "Headwear",
  neckwear: "Neckwear",
  gloves: "Gloves",
  socks: "Socks",
  shoes: "Shoes",
  accessory: "Accessory",
} as const satisfies Record<(typeof garmentCategories)[number], string>;

export const layerSchema = z.enum(["base", "mid", "outer"]);
export const weightSchema = z.enum(["light", "mid", "heavy"]);
export const fabricSchema = z.enum([
  "synthetic",
  "merino",
  "cotton",
  "blend",
  "down",
]);

/**
 * The sentences are part of the schema, not of whatever renders it.
 *
 * `docs/product.md` §Forms & failure: "Error copy lives in the schema, in
 * zod's `message`. A component authoring its own sentence is the same
 * problem one layer down." Without them a user meets zod's default — the
 * closet form's real output was *"Too small: expected string to have >=1
 * characters"* — and every form that renders this schema would have had to
 * translate it, which is four translations of one rule.
 *
 * Second person, says what to do, no apology. `signUpSchema` below sets
 * the register.
 */
const garmentBase = z.strictObject({
  name: z.string().min(1, "Give it a name.").max(80, "Keep the name under 80 characters."),
  brand: z.string().max(60, "Keep the brand under 60 characters.").optional(),
  size: z.string().max(20, "Keep the size under 20 characters.").optional(),
  color: z.string().max(30, "Keep the color under 30 characters.").optional(),
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

/**
 * A WGS84 coordinate pair, bounded. Written out four times before this —
 * twice here and twice in `modules/feed/functions.ts` — which is four
 * places to get a sign or a bound wrong, and no way for them to disagree
 * loudly.
 */
export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

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

/**
 * The sentence is here because the screen used to enforce this with a
 * `disabled` submit button, which §5 bans: it drops focus, stops
 * announcing, and tells a user nothing about why nothing happened. The
 * schema refusing the submission with a reason is the contract's answer,
 * and the reason has to live where every renderer of it can find it.
 */
export const verdictSchema = z
  .number({ error: "Say how the kit felt." })
  .int()
  .min(-2)
  .max(2);

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

/**
 * What a place is like in a season, rather than on a day.
 *
 * Means over the provider's statistical period, not a single reading: a
 * mild January 15th in Minneapolis is weather, and choosing a starter
 * wardrobe from it would be choosing from noise.
 */
export interface ClimateNormals {
  /**
  Mean daily low across the coldest part of the year, °C.
  */
  winterLowC: number;
  /**
  Mean daily high across the warmest part of the year, °C.
  */
  summerHighC: number;
}

export interface WeatherProvider {
  /**
  Historical/near-past conditions at a time+place (for imports).
  */
  observation(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
  /**
  Seasonal normals at a place, for choosing a starter wardrobe (O3).
  */
  climateNormals(lat: number, lng: number): Promise<ClimateNormals>;
  /**
  Forecast at a future time+place (for the call, post-MVP).
  */
  forecast(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
}

// ---- Onboarding / profile -------------------------------------------------

/** UI: +2 "always freezing" … −2 "sweating in a t-shirt at 40°".
 *  Degree mapping (code, not DB): level × 2.2 °C. */
export const thermalLevelSchema = z
  .number({
    // Error copy lives in the schema (§Forms & failure), and this one is
    // load-bearing: O1 submits `Number(undefined)` when nobody has picked,
    // so without a message a runner who taps straight past the question is
    // told "expected number, received nan".
    message: "Pick the one that sounds most like you.",
  })
  .int()
  .min(-2)
  .max(2);

/**
 * The five answers to O1's one question, in the order they are shown.
 *
 * Shaped like `verdictScale` and here for the same reason: the mapping was
 * a *comment* on the schema above, so onboarding and settings-recalibrate
 * would each have restated it, and a comment cannot be pinned by a test.
 *
 * **Positive means runs cold.** +2 is "Always freezing" — someone who needs
 * more clothes than the table suggests — and −2 is the person sweating in a
 * t-shirt at 40°. That reads backwards to about half of people on first
 * encounter, which is exactly why it is written once.
 *
 * Copy is the design's own (`design/Onboarding.dc.html`, O1).
 */
/**
 * What one step of the thermal scale is worth, in °C.
 *
 * It was a *comment* on `thermalLevelSchema` — "Degree mapping (code, not
 * DB): level × 2.2 °C" — and nothing implemented it, so O1 could not show
 * the offset its own design copy promises ("The offset is visible on
 * purpose. You'll see it change as we learn."). A number described in prose
 * and used nowhere is the shape a wrong number hides in.
 */
export const THERMAL_LEVEL_C = 2.2;

/**
 * The offset a thermal level implies, in the unit asked for.
 *
 * **A temperature *difference*, so Fahrenheit is ×9/5 and never +32.** That
 * is the whole reason this is a function and not two call sites: converting
 * a delta with the absolute formula is a classic bug, and it would be an
 * invisible one here — +8° would read as +40°, which is not obviously
 * absurd on a screen that is talking about how warm someone runs.
 *
 * Rounded to whole degrees, which is what the artboard shows: +8°, +4°, 0°,
 * −4°, −8° in Fahrenheit. The precision is not real — 2.2°C per step is
 * itself a round number — and a runner is being told roughly how much more
 * clothing they need, not a measurement.
 */
export function thermalOffset(level: number, unit: TempUnit): number {
  const celsius = level * THERMAL_LEVEL_C;
  return Math.round(unit === "f" ? celsius * 1.8 : celsius);
}

/**
 * The offset as O1 and settings print it: `+8°`, `0°`, `−8°`.
 *
 * Here rather than in either screen because it was in *both* — O1 draws it
 * beside each answer and settings states the saved one, and the second
 * copy arrived four hours after the first. A formatter for a measured
 * value is exactly the "rival truth" §Derive, don't mirror is about: two
 * copies drift on the sign, the degree symbol, or the minus character, and
 * nothing makes them disagree loudly.
 *
 * **U+2212, not a hyphen.** These render in mono as a measured value, and
 * a hyphen sits at the wrong height and width there. No `+` on zero: `+0°`
 * reads as a direction when the answer is that there is none.
 */
export function thermalOffsetLabel(level: number, unit: TempUnit): string {
  const degrees = thermalOffset(level, unit);
  const sign = degrees > 0 ? "+" : "";
  return `${sign}${String(degrees).replace("-", "\u{2212}")}°`;
}

export const thermalScale = [
  { value: 2, token: "always_freezing", label: "Always freezing" },
  { value: 1, token: "little_cold", label: "Run a little cold" },
  { value: 0, token: "average", label: "About average" },
  { value: -1, token: "little_warm", label: "Run a little warm" },
  { value: -2, token: "sweating_at_40", label: "Sweating in a t-shirt at 40°" },
] as const;
export type ThermalLevel = (typeof thermalScale)[number]["value"];

/**
 * The units a person reads their own data in — display only. The contract
 * stores SI regardless: `temp_c`, `distance_m`.
 *
 * One `z.enum` each, because these were two independent lists: a bare
 * `"f" | "c"` union in `lib/temperature.ts` and a column enum in
 * `db/schema-core.ts`, with nothing making them agree (D-7). A validator, a
 * type and the stored vocabulary are one fact, so they get one statement —
 * the type comes off the schema via `z.infer`, and `unit-contract.test.ts`
 * pins both against the columns so a value added to one has to be added to
 * the other.
 */
export const tempUnitSchema = z.enum(["f", "c"]);
export type TempUnit = z.infer<typeof tempUnitSchema>;

export const distanceUnitSchema = z.enum(["mi", "km"]);
export type DistanceUnit = z.infer<typeof distanceUnitSchema>;

/**
 * What the app shows when a person has not chosen. Fahrenheit and miles
 * because the owner is US-based and the calibration tables are authored in
 * Fahrenheit (see `lib/thermal.ts`); 105 replaces this with a locale guess
 * at onboarding, and this stays the fallback for a profile that predates
 * the question.
 */
export interface Units {
  temp: TempUnit;
  distance: DistanceUnit;
}

export const defaultUnits: Readonly<Units> = { temp: "f", distance: "mi" };
export const CALL_VERDICT_THRESHOLD = 15;

/**
 * How many verdicts in one 5°C band before the ladder calls it covered.
 *
 * Derived from `CALL_VERDICT_THRESHOLD` rather than picked: 15 verdicts
 * spread across the five bands a runner's year typically spans is three
 * each, so three is what "covered" means for a band. Two or one is
 * partial; none is unknown (O6: "pink bands are covered, teal is partial,
 * grey is unknown").
 *
 * A threshold the owner may want to move — it decides how fast the ladder
 * looks finished, which is the screen's whole emotional job.
 */
export const BAND_COVERED_VERDICTS = 3;

/**
 * What O3 sends back: the keys a runner tapped.
 *
 * **Here rather than in `closet/tap-list.ts`, and that is the documented
 * escape hatch rather than a preference.** The form needs the *same schema
 * object* the server validates with — that is what "one schema, run twice"
 * means — and a component cannot import `modules/closet`'s barrel: the
 * barrel re-exports `./service`, which pulls `db/schema`, and a route that
 * imports it ships 23kB of drizzle to the browser without failing anything
 * (CLAUDE.md, the client-bundle rule). Deep-importing the one pure file is
 * a boundary violation. So the shared contract moves to `lib/`, which is
 * exactly what "move the shared constants to lib/ where both sides can
 * import them" says to do.
 *
 * No upper bound on the array. It used to carry `.max(TAP_LIST.length)`,
 * which looked like a guard and was not one: the length that matters is
 * the number of *distinct known* keys, and `addFromTapList` now dedupes and
 * skips unknowns, so a padded payload creates nothing either way. Keeping
 * the bound here would also have meant keeping this file's knowledge of how
 * long that table is, which is the coupling the move exists to remove.
 */
export const tapListSelectionSchema = z.object({
  // The message is what a zero-tap "Next" says, and it names the way out:
  // O3 is skippable, and design's rule is that Next is live from the first
  // tap. A `disabled` button is how that is usually drawn and is forbidden
  // by §Forms & failure — it drops focus and announces nothing — so the
  // sentence does the job the grey button was drawn to do, out loud.
  keys: z
    .array(z.string())
    .min(1, { message: "Tap what you own, or skip for now." }),
});
export type TapListSelection = z.infer<typeof tapListSelectionSchema>;
