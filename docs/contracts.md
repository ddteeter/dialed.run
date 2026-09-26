# dialed.run — Contracts

Frozen interfaces between lanes. Phase 0 turns this document into code; after
that, **changing anything here requires the schema-change protocol in
CLAUDE.md** (stop, propose in design doc, human review).

Supersedes `plan/docs/contracts.md`. Key changes from that archive: the garment
model is category × layer with typed attributes (not `body_part`); verdicts are
per-run 5-state (not per-item 3-state); likes are `reactions` (kind `useful`);
entries carry `is_public`; users carry onboarding fields; garments link to
canonical `products` with an enrichment pipeline behind them (D-26/D-31).
Rationale: `docs/decisions.md`.

## Entity model (dialed-core)

```mermaid
erDiagram
    users ||--o{ wardrobe_items : owns
    users ||--o{ runs : records
    users ||--o{ follows : follows
    users ||--o{ notifications : receives
    runs ||--o| outfit_entries : "has at most one"
    outfit_entries ||--{ outfit_entry_items : contains
    outfit_entries ||--{ entry_tags : tagged
    wardrobe_items ||--o{ outfit_entry_items : "worn in"
    outfit_entries ||--o{ entry_photos : shows
    outfit_entries ||--o{ reactions : gets
    runs ||--o| weather_observations : "occurred during"
```

### users (Better Auth tables + app columns)

Auth tables (`users`, `sessions`, `accounts`, `verifications`) are owned by
Better Auth's Drizzle adapter. App-owned columns added to `users` (or a 1:1
`user_profiles` table if the adapter fights column additions — Phase 0 decides,
documents, and the choice is invisible behind `modules/auth`):

```
display_name     text
city_label       text     -- "Minneapolis, MN"; user-editable
lat, lng         real     -- geocoded home location, nullable
thermal_level    int      -- -2..+2 from onboarding O1 (-2 = runs warm,
                          --  +2 = always freezing); °C mapping lives in code
temp_unit        text     -- 'f' | 'c'; distance_unit 'mi' | 'km'; from locale
share_default    int      -- 1 = new entries public (default), 0 = private
```

### wardrobe_items

```
id               text PK  -- ULID
user_id          text FK
category         text     -- enum: top | bottom | headwear | neckwear | gloves
                          --       | socks | shoes | accessory
type             text     -- CACHE of products.type, NULLABLE. Written on
                          -- match and by enrichment, never by a user and
                          -- never parsed from a name (design screen Z).
                          -- A garment with no product has none.
                          -- top: singlet|tee|longSleeve|halfZip|jacket|vest
                          --      |sportsBra
                          -- bottom: shorts|halfTights|tights
                          -- headwear: cap|beanie|headband
                          -- neckwear: neckGaiter    gloves: gloves
                          -- socks: socks            shoes: shoes
                          -- accessory: sunglasses|armSleeves
                          -- Not a column enum: the legal values depend on
                          -- the category, which a CHECK cannot express.
                          -- garmentSchema is the gate. Named for the Icon
                          -- Pack's glyphs, so a garment's icon IS its type.
layer            text     -- enum: base | mid | outer, NULLABLE
                          -- (meaningful for top/bottom; a jacket = top+outer)
weight           text     -- enum: light | mid | heavy, NULLABLE
fabric           text     -- enum: synthetic | merino | cotton | blend | down, NULLABLE
wind_resistant   int      -- 0/1, NULLABLE
water_resistant  int      -- 0/1, NULLABLE
est_temp_low_c   real     -- attribute-derived guess, NULLABLE
est_temp_high_c  real     -- NULLABLE
brand            text     -- NULLABLE
name             text     -- required; the only required descriptive field
size, color      text     -- NULLABLE. `color` is the COLOURWAY the runner
                          -- typed ("Obsidian"), free text, never parsed.
color_name       text     -- NULLABLE enum, 13 locked names in two classes
                          -- (AH): black white grey navy brown beige |
                          -- red orange yellow green blue purple pink.
                          -- No "multi", no "other", and hi-viz is NOT one
                          -- of them — it is a reason, not a colour.
color_hex        text     -- NULLABLE '#rrggbb', lowercase. Level 2 of AH;
                          -- optional beside an optional name. Enrichment
                          -- may propose the NAME, never a hex.
visibility_level text     -- NULLABLE enum: plain | reflective | hi_viz.
                          -- **Not `visibility` below.** This is the
                          -- garment property (AH); that one is the
                          -- moderation state. Only hi_viz exempts a
                          -- garment from the colour tiebreak; reflective
                          -- does not, because the base colour still shows.
photo_key        text     -- R2 key, NULLABLE
product_url      text     -- NULLABLE, https-only, user-entered
product_id       text     -- NULLABLE FK -> products; links this garment to a
                          -- canonical product (D-26). Product attributes act
                          -- as defaults; the garment's own columns override.
origin           text     -- enum: manual | taplist  (taplist rows are
                          -- [GENERIC] placeholders until upgraded — D-27)
retired          int      -- 0/1
visibility       text     -- enum: ok | pending | pass | flagged |
                          -- hidden_pending_review (106). 'ok' means never
                          -- screened, which is NOT 'pass'. Same vocabulary
                          -- as entry_photos.screen_status on purpose.
created_at       int
```

**Which attributes apply is enforced by the contract layer, not the table**
(D1 can't do unions): the zod garment schema is a discriminated union on
`category`, and per-category variants admit only their attributes. The table
stays flat/nullable so closet filters (wind, water, temp range) are plain
indexed SQL. Closet UI groups are derived, not stored:

| UI group (design C) | Predicate                                                   |
| ------------------- | ----------------------------------------------------------- |
| Tops                | `category='top' AND (layer IS NULL OR layer != 'outer')`    |
| Bottoms             | `category='bottom' AND (layer IS NULL OR layer != 'outer')` |
| Outer               | `layer='outer'`                                             |
| Hands / head        | `category IN ('headwear','neckwear','gloves')`              |
| Shoes               | `category='shoes'`                                          |
| Socks / extras      | `category IN ('socks','accessory')`                         |

### brands (curated seed + user additions — lane 101)

```
id          text PK
name        text          -- display form ("Janji")
normalized  text UNIQUE   -- casefold/punctuation-fold, autocomplete key
seeded      int           -- 1 = from the curated running-brand seed list
```

### products (canonical product identity — CRUD in 101, enrichment in 107)

```
id                 text PK
brand_id           text FK -> brands
name               text          -- model name ("Rover Half-Zip")
normalized_name    text          -- UNIQUE(brand_id, normalized_name);
                                 -- create-if-missing dedup key (D-30)
source_url         text          -- NULLABLE; first pasted product URL
image_key          text          -- NULLABLE; primary image copied to R2
category_hint      text          -- NULLABLE garment category enum value
type               text          -- NULLABLE garment type; the source of
                                 -- wardrobe_items.type, filled by enrichment
fabric_composition text          -- NULLABLE; verbatim as published
                                 -- ("Body: 100% recycled polyester;
                                 --   Liner: 88% polyester, 12% spandex")
fabric_parts       text          -- NULLABLE JSON (fabricCompositionSchema.parts):
                                 -- parsed per-part breakdown; garments can be
                                 -- multi-composition (two-layer shorts, lined
                                 -- tights) so composition is a LIST of labeled
                                 -- parts, never a single pair (D-34)
weight             text          -- NULLABLE enum: light | mid | heavy
fabric             text          -- NULLABLE enum (same as garments)
wind_resistant     int           -- NULLABLE 0/1
water_resistant    int           -- NULLABLE 0/1
extracted          text          -- NULLABLE JSON, written only by 107's
                                 -- applyExtraction: { rung, found, written }.
                                 -- `found` is everything the ladder found
                                 -- (D-31 "raw extras"); `written` is what it
                                 -- last put in each typed column, which is
                                 -- how "never overwrite a human edit" is
                                 -- decided without a per-column flag
extraction_status  text          -- enum: none | pending | done | failed
status             text          -- 'active' | 'hidden' (106 moderation —
                                 -- product names are UGC, D-26)
created_by         text FK -> users
created_at         int
```

Rules: product rows are shared; a user "creating" an existing normalized
brand+name gets the existing row. Garments inherit product attributes as
defaults where their own columns are NULL (application logic, not triggers).
Social-proof counts ("worn by N runners") derive **only from public
outfit_entries** — never from closet linkage (D-29).

### product_snapshots (retention — lane 107)

```
id          text PK
product_id  text FK -> products
url         text
r2_key      text     -- raw fetched HTML under products/{productId}/
rung        text     -- the deepest ladder rung that contributed, re-recorded
                     -- on every reextract: jsonld | shopify | og | text | llm | none
fetched_at  int
```

Snapshots exist so extraction can re-run and improve later; never delete them
to save space (they are the un-refetchable archive — D-31).

### runs

```
id           text PK   -- ULID
user_id      text FK
source       text      -- enum: manual | file   (Strava is NOT a source)
started_at   int       -- epoch seconds
duration_s   int
distance_m   real
lat, lng     real      -- NULLABLE
indoor       int       -- 0/1; indoor runs skip conditions entirely
effort       text      -- enum: easy | steady | workout | race, NULLABLE
                       -- (unused by v1 logic; accrues for the call)
title        text
weather_status text    -- enum: none | pending | attached | manual | failed
```

### outfit_entries

```
id           text PK
run_id       text FK   -- UNIQUE (at most one entry per run)
user_id      text FK   -- denormalized deliberately: backs the feed index
verdict      int       -- -2..+2, NULLABLE until the user answers
                       -- -2 way_cold, -1 bit_cold, 0 dialed, +1 bit_warm, +2 way_warm
is_public    int       -- snapshot of share choice at log time (user toggleable)
caption      text      -- NULLABLE
created_at   int
```

- A run appears in the feed **only when it has a public outfit_entry**.
- The shared post shows the 5-state verdict label. What is never public:
  aggregate verdict history, coverage charts, per-item flags/notes, thermal level.

### outfit_entry_items

```
entry_id   text FK
item_id    text FK
flag       text   -- enum: too_much | not_enough, NULLABLE
note       text   -- NULLABLE, private to the owner
PK (entry_id, item_id)
```

There is **no per-item verdict** — comfort is judged per-run; `flag` carries
the item-level exception ("gloves too much").

### entry_tags

```
entry_id   text FK
tag        text   -- from the curated list in contracts.ts (cold_first_mile,
                  -- chafed, perfect_warmup, sleeves_damp, ...); no free text
PK (entry_id, tag)
```

### Social + system tables

```
follows:        follower_id, followee_id, created_at; PK (follower_id, followee_id)
reactions:      entry_id, user_id, kind ('useful'), created_at; PK (entry_id, user_id)
entry_photos:   id, entry_id, photo_key, position (max 4 per entry)
notifications:  id, user_id, kind, subject_id, body, read, created_at,
                UNIQUE(user_id, kind, subject_id)  -- dedupe key
strava_connections:  user_id PK, athlete_id, tokens, status ('ok'|'broken')
                     -- webhook reminder flow ONLY; no other module may import it
processed_webhook_events: UNIQUE(object_id, aspect_type, event_time)
cron_checkpoints: cron_name PK, last_run_at
imports:        id, user_id, r2_key, status ('pending'|'processing'|'done'|'failed'),
                failure_reason, run_id NULLABLE, created_at
```

Task 106 added (migration `0015_trust_and_safety_floor`):

```
reports:         id, reporter_id, subject_type ('entry'|'photo'|'profile'|
                 'product'), subject_id, reason, note NULLABLE, created_at
                 UNIQUE(reporter_id, subject_type, subject_id)
                   -- NOT a dedupe convenience. "N reports from DISTINCT
                   -- users" is only true under retries if a second report
                   -- cannot become a second row; this is what makes
                   -- COUNT(*) a count of people.
review_queue:    id, subject_type, subject_id, source ('reports'|
                 'classifier'), status ('pending'|'reviewing'|'approved'|
                 'removed'), resolved_by NULLABLE, resolved_at NULLABLE,
                 created_at; UNIQUE(subject_type, subject_id)
                   -- one row per subject, not per report: three reports
                   -- about one entry are one decision. `status` is the
                   -- claim column (law 2).
domain_denylist: domain PK (bare registrable host, lowercased, no 'www.'),
                 added_by, reason NULLABLE, created_at. Seeded empty.
photo_screenings: id, photo_scope ('entry'|'garment'), photo_id, model,
                 scores (raw per-category JSON), decision ('pass'|'flag'),
                 created_at -- kept so a threshold can be re-tuned against
                 real scores without re-classifying anything.
blocks:          blocker_id, blocked_id, created_at;
                 UNIQUE(blocker_id, blocked_id) + INDEX(blocked_id)
                   -- read from both ends: W2 promises blocking works in
                   -- both directions. Deliberately NOT read by the
                   -- consensus aggregate — a blocked runner's verdicts
                   -- still count in numbers that name nobody.
user_profiles:   + banned_at NULLABLE, ban_reason NULLABLE
                   -- `banned_at IS NOT NULL` IS the ban: one fact, not a
                   -- boolean and a date that can disagree.
outfit_entries:  + moderation_status ('ok'|'hidden_pending_review'|'removed')
                   -- SEPARATE from is_public, which is the runner's own
                   -- sharing choice. A moderator writing is_public would
                   -- silently rewrite a preference they set, and approving
                   -- could never restore it correctly.
entry_photos:    + screen_status ('pending'|'pass'|'flagged'|
                 'hidden_pending_review'), default 'pending'
                   -- the durable "not finished" marker that lets screening
                   -- retry be a cron rather than a queue (law 8c).
```

**One rule for "visible to a stranger".** `is_public = 1 AND
moderation_status = 'ok'`, expressed once as `publiclyVisibleEntry()` in
`modules/safety` and imported by every read that shows entries to someone
other than their author. Five call sites wrote the first half by hand
before 106; a second condition would have made five copies of a rule, and
the dangerous one is the consensus aggregate, where a missed clause hides
nothing visibly and only skews the numbers.

### Covering indexes (minimum set; lanes add their own with EXPLAIN proof)

```
outfit_entries(user_id, created_at DESC)           -- feed + profile
outfit_entries(is_public, created_at DESC)         -- consensus scan window
follows(follower_id, followee_id)
wardrobe_items(user_id, category)
wardrobe_items(product_id)                         -- worn-by counts via entries
products(brand_id, normalized_name)                -- UNIQUE + autocomplete
brands(normalized)                                 -- UNIQUE
runs(user_id, started_at DESC)
notifications(user_id, read)
```

## dialed-weather database

```
weather_observations: id, run_id (nullable), lat_r, lng_r, hour_bucket,
  temp_c, feels_like_c, humidity, wind_kph, precip_mm, condition,
  source ('visualcrossing' | 'manual' — 'manual' being dropped, see below), fetched_at
UNIQUE(lat_r, lng_r, hour_bucket)   -- the cache key: lat/lng rounded to 2dp

manual_conditions: run_id (PK), temp_c, set_at   -- R2b's band, one run's own
```

`weather_observations` is a shared cache and holds real observations only.
A band a runner sets in R2b belongs to that run and lives in
`manual_conditions`, keyed by the run — never in a cache cell, where it would
answer for every other runner at that place and hour (PR #103, B1). No
`source='manual'` cache row has ever been deployed, and nothing writes one:
the cache's readers no longer step around them (task 125, OPS-14), and the
owner has approved dropping `'manual'` from the column's enum (2026-09-26),
which lands once feed's two `ne(source, 'manual')` filters are gone (task
129). A band reads back tagged `source='manual'` — a label on the reading,
not a cache row — and is excluded from consensus aggregates and future
training queries. Every stored value is metric; display
units convert at render from user prefs.

## Shared TypeScript contracts (become `src/lib/contracts.ts` in Phase 0)

```ts
import { z } from "zod";

// ---- Garments: discriminated union on category ----------------------------
export const layerSchema = z.enum(["base", "mid", "outer"]);
export const weightSchema = z.enum(["light", "mid", "heavy"]);
export const fabricSchema = z.enum([
  "synthetic",
  "merino",
  "cotton",
  "blend",
  "down",
]);

const garmentBase = z.object({
  name: z.string().min(1).max(80),
  brand: z.string().max(60).optional(),
  size: z.string().max(20).optional(),
  color: z.string().max(30).optional(),
  // AH, additive 2026-09-19. The classes are the source and the enum is
  // derived from them — `colorClass()` reads them rather than restating
  // the split, because the Call's tiebreak keys off the class.
  colorName: colorNameSchema.optional(),
  colorHex: colorHexSchema.optional(),
  visibilityLevel: garmentVisibilitySchema.optional(),
  productUrl: z.string().url().startsWith("https://").optional(),
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

// ---- Products (D-26/D-31) ---------------------------------------------------
export const productDraftSchema = z.object({
  brand: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  sourceUrl: z.string().url().startsWith("https://").optional(),
});

/** Fabric composition: multi-part by design (D-34) — two-layer shorts,
 *  lined tights, insulated jackets carry per-part compositions. `verbatim`
 *  is always kept exactly as published; `parts` is best-effort parse. */
export const fabricPartSchema = z.object({
  part: z.string().optional(), // "body" | "liner" | "shell" | "panels" ... ; absent when unlabeled
  materials: z
    .array(
      z.object({
        material: z.string(), // "polyester", "merino wool", "elastane"
        pct: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1),
});
export const fabricCompositionSchema = z.object({
  verbatim: z.string(),
  parts: z.array(fabricPartSchema).optional(),
});

/** What the extraction ladder emits; every field independently optional. */
export const extractedProductSchema = z.object({
  name: z.string().optional(),
  brand: z.string().optional(),
  categoryHint: z.string().optional(),
  fabricComposition: fabricCompositionSchema.optional(),
  weight: weightSchema.optional(),
  fabric: fabricSchema.optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
  imageUrl: z.string().url().optional(),
  extras: z.record(z.string(), z.unknown()).optional(), // preserved verbatim in products.extracted
});
export type ExtractedProduct = z.infer<typeof extractedProductSchema>;

/** Deterministic rungs (JSON-LD, Shopify JSON, OG) implement this per source. */
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

/** LLM rung behind an adapter; eval decides the implementation (D-32). */
export interface ExtractionModel {
  extract(pageText: string, hint: { url: string }): Promise<ExtractedProduct>;
}

// ---- Verdicts -------------------------------------------------------------
export const verdictSchema = z.number().int().min(-2).max(2);
export const verdictLabels = {
  "-2": "way_cold",
  "-1": "bit_cold",
  "0": "dialed",
  "1": "bit_warm",
  "2": "way_warm",
} as const;
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

/** Every import path (file parser now; Polar/Fitbit later) produces this. */
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
  // D-96: the IANA zone of the place observed. Optional and additive —
  // manual observations and rows cached before the column have none.
  // Refined by `isTimeZone`, because an invalid zone throws inside `Intl`
  // at render time rather than failing here.
  timeZone: z.string().refine(isTimeZone).optional(),
});
export type WeatherObservation = z.infer<typeof weatherObservationSchema>;

export interface WeatherProvider {
  /** Historical/near-past conditions at a time+place (for imports). */
  observation(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
  /** Forecast at a future time+place (for the call, post-MVP). */
  forecast(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
}

// ---- Onboarding / profile -------------------------------------------------
export const thermalLevelSchema = z.number().int().min(-2).max(2);
/** UI copy maps: +2 "always freezing" ... -2 "sweating in a t-shirt at 40°".
 *  Degree offset mapping (code, not DB): level * 2.2°C. */
```

## Route conventions (TanStack Start)

File-based routes under `src/routes/`, one directory per lane — ownership is
the directory, so route merges are append-only:

```
src/routes/
  __root.tsx            # Phase 0: shell, tab bar, auth context
  index.tsx             # Phase 0: redirects to feed
  auth/                 # Phase 0 (Better Auth pages)
  closet/               # lane 101
  runs/                 # lane 102 (log flow, imports, notifications)
  feed/                 # lane 104 (feed tabs, entry detail, profiles, search)
  products/             # lane 101 (autocomplete endpoints); 107 adds none
  onboarding/           # lane 105
  call/                 # lane 105 (teaser tab only, until the call epic)
  api/                  # webhook + queue-facing HTTP endpoints, per-lane files
```

- Navigation uses typed `Link to` / `navigate` only — string URLs are linted.
- Mutations and loads are **server functions** exported from
  `modules/<lane>/index.ts`; route files stay thin (parse params → call module
  → render module components).
- Reserved server-function namespaces mirror modules: `auth.*`, `closet.*`,
  `runs.*`, `weather.*` (internal only), `feed.*`, `onboarding.*`, `products.*`
  (101: CRUD/autocomplete) and `enrichment.*` (107: internal only).

## Component convention

- Shared primitives live in `src/ui/` (Layout, tab bar, sheet, `Mono`,
  `Bracketed`, verdict badge, garment chip — see `docs/product.md`).
- Lane components live in `modules/<lane>/components/`, exported via
  `index.ts` only where another lane genuinely consumes them (e.g. weather's
  `WeatherAttribution`, runs' notification bell slot).
