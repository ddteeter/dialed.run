# Dialed — Contracts

Frozen interfaces between lanes. Phase 0 turns this document into code; after
that, **changing anything here requires the schema-change protocol in
CLAUDE.md** (stop, propose in design doc, human review).

## Entity model (dialed-core)

```mermaid
erDiagram
    users ||--o{ wardrobe_items : owns
    users ||--o{ runs : records
    users ||--o{ follows : follows
    users ||--o{ notifications : receives
    runs ||--o| outfit_entries : "has at most one"
    outfit_entries ||--{ outfit_entry_items : contains
    wardrobe_items ||--o{ outfit_entry_items : "worn in"
    outfit_entries ||--o{ entry_photos : shows
    outfit_entries ||--o{ likes : gets
    runs ||--o| weather_observations : "occurred during"

    wardrobe_items {
        text id PK
        text user_id FK
        text brand
        text name
        text size
        text color
        text body_part "enum: head neck torso_base torso_mid torso_outer hands legs socks shoes accessory"
        text photo_key "R2 key, nullable"
        text product_url "nullable, user-entered"
        int retired "0/1"
    }
    runs {
        text id PK
        text user_id FK
        text source "enum: manual | file"
        int started_at "epoch s"
        int duration_s
        real distance_m
        real lat "nullable"
        real lng "nullable"
        text title
    }
    outfit_entries {
        text id PK
        text run_id FK "unique"
        text user_id FK "denormalized for feed index"
        text caption
        int created_at
    }
    outfit_entry_items {
        text entry_id FK
        text item_id FK
        text verdict "enum: too_warm | too_cold | just_right | null"
        text note "nullable"
    }
```

Notes locked in:

- IDs are ULIDs (sortable, string). Timestamps are epoch seconds (integer).
- A run appears in the feed **only when it has an outfit_entry** (product
  rule from day one).
- `outfit_entries.user_id` is denormalized deliberately — it backs the feed
  covering index `(user_id, created_at DESC)`.
- `runs.source` is `manual | file` at MVP. Strava is **not** a run source —
  it is only a notification trigger.
- Auth tables (`users`, `sessions`, `accounts`, `verifications`) are owned by
  Better Auth's Drizzle adapter; lanes read `users.id` and nothing else.
- `strava_connections` (user_id, athlete_id, tokens) exists solely for the
  webhook reminder flow. **No other module may import it.**

## dialed-weather database

```
weather_observations: id, run_id (nullable), lat_r, lng_r, hour_bucket,
  temp_c, feels_like_c, humidity, wind_kph, precip_mm, condition, source,
  fetched_at
UNIQUE(lat_r, lng_r, hour_bucket)   -- the cache key: lat/lng rounded to 2dp
```

## Shared TypeScript contracts (become `src/lib/contracts.ts` in Phase 0)

```ts
import { z } from "zod";

export const bodyParts = [
  "head",
  "neck",
  "torso_base",
  "torso_mid",
  "torso_outer",
  "hands",
  "legs",
  "socks",
  "shoes",
  "accessory",
] as const;
export const bodyPartSchema = z.enum(bodyParts);

export const verdictSchema = z.enum(["too_warm", "too_cold", "just_right"]);

export const runDraftSchema = z.object({
  startedAt: z.number().int().positive(),
  durationS: z.number().int().positive(),
  distanceM: z.number().positive(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  title: z.string().min(1).max(120),
});
export type RunDraft = z.infer<typeof runDraftSchema>;

/** Every import path (file parser now; Polar/Fitbit later) produces this. */
export interface RunSource {
  readonly kind: "fit" | "gpx" | "tcx";
  parse(bytes: ArrayBuffer): Promise<RunDraft>;
}

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
  /** Historical/near-past conditions at a time+place (for imports). */
  observation(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
  /** Forecast at a future time+place (for Pick-My-Outfit, post-MVP). */
  forecast(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
}
```

## Route manifest convention

One file per lane in `src/routes/manifest/`; the barrel merges them. Path
builders only — no handlers here.

```ts
// src/routes/manifest/wardrobe.ts
import type { Ulid } from "@/lib/ids";

export const wardrobe = {
  list: () => "/wardrobe" as const,
  newItem: () => "/wardrobe/new" as const,
  item: (id: Ulid) => `/wardrobe/${id}` as const,
  deleteItem: (id: Ulid) => `/wardrobe/${id}/delete` as const,
} as const;
```

Namespaces reserved: `auth.*`, `wardrobe.*`, `runs.*` (incl. import +
notifications), `feed.*`, `weather.*` (internal only). Lanes own their
namespace file exclusively — this is what keeps manifest merges conflict-free.

## Fragment convention (htmx)

- Fragment components live in `modules/<lane>/fragments/`, named
  `<Thing>Fragment`, and are the **only** thing htmx endpoints return.
- Full pages import fragments and wrap them in `ui/Layout`.
- Any mutating endpoint returns the updated fragment (or 204 + `HX-Trigger`).
