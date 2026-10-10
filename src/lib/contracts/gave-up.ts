/**
 * The jobs the system can give up on (Operator Screens D6; register R-119),
 * as `gave_up.kind` stores them. Here rather than in `lib/sql`, because the
 * Desk's Today renders a row per kind and a component may not import
 * server-only code.
 *
 * - `enrichment` — reading a product page (`subject_id` is the product).
 * - `weather` — fetching a run's conditions (the run).
 * - `import` — reading an uploaded run file (the import).
 * - `reminder` — the S1 row a run landing on Strava leaves (the queue job
 *   itself, which is the only record of it).
 *
 * Photo screening is not here on purpose: it never gives up. A photo it
 * cannot finish stays `pending`, the `screening-retry` sweep asks again
 * every firing, and Today already counts what it sent a person.
 */
export const GAVE_UP_KINDS = [
  "enrichment",
  "weather",
  "import",
  "reminder",
] as const;

export type GaveUpKind = (typeof GAVE_UP_KINDS)[number];
