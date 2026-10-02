import { z } from "zod";

import type { ResolvedPlace } from "./weather";

/**
 * The typed city's contract (round 26 #12), shared by the field that asks
 * (`ui/CityFinder`, on O1 and on Your conditions) and the server function
 * that answers (onboarding's `lookUpCityFn`). In `lib/` because `ui/`
 * imports `lib/` and never a module.
 */

/**
 * What Find came to. Three answers, because the field does three different
 * things with them:
 *
 * - `found` — "Weather for {address}", with Use this;
 * - `not-found` — a field message: the fix is in the field;
 * - `unavailable` — the lookup itself failed, the `NOT FOUND YET` band.
 */
export type CityLookup =
  | ({ kind: "found" } & ResolvedPlace)
  | { kind: "not-found" }
  | { kind: "unavailable" };

/**
 * What Find sends, and the one field message it can fail with before it
 * asks. Error copy lives in the schema (§Forms & failure), so the field
 * and the server read the same sentence.
 */
export const cityLookupInput = z.object({
  label: z
    .string()
    .trim()
    .min(1, { message: "Type the city you run in." })
    .max(120),
});

/**
 * The field message for a place the provider cannot find, quoting what
 * was typed so the runner can see the typo.
 */
export function cityNotFound(label: string): string {
  return `We couldn't find "${label}". Check the spelling, or try a nearby city.`;
}
