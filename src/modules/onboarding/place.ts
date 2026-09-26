import { z } from "zod";

/**
 * O1's typed city, resolved to a place (owner, 2026-09-24).
 *
 * The provider resolves one place from a typed label — it does not suggest
 * as you type — so O1 asks once, when the runner confirms, and never per
 * keystroke. The resolver itself is lane 123's `resolvePlace` in
 * `modules/weather` (Visual Crossing); it is handed in rather than imported
 * so this decision is testable and so the wiring is one line in
 * `functions.ts` (`O1_PLACE_RESOLVER`).
 */

/**
The shape of `modules/weather`'s `resolvePlace`.
*/
export type PlaceResolver = (
  label: string,
) => Promise<{ lat: number; lng: number } | undefined>;

/**
 * What asking came to. Three answers, because the form does three different
 * things with them:
 *
 * - `found` — saved with its coordinates, and shown as the chip;
 * - `not-found` — a field message: the fix is in the field;
 * - `unavailable` — the provider failed or is not wired, so the city is
 *   saved as a label alone, which is what O1 did before it could resolve
 *   anything (law 5: a secondary lookup never fails the save).
 */
export type CityLookup =
  | { kind: "found"; lat: number; lng: number }
  | { kind: "not-found" }
  | { kind: "unavailable" };

export const cityLookupInput = z.object({
  label: z.string().trim().min(1).max(120),
});

/**
 * Resolves a typed city, and reports a provider failure rather than
 * swallowing it (laws 6 and 7): the runner's save goes on without
 * coordinates, and Sentry hears why.
 *
 * No resolver is not a failure — it is the build before `resolvePlace`
 * lands — so it answers `unavailable` without reporting anything.
 */
export async function lookUpCity({
  label,
  resolver,
  report,
  userId,
}: Readonly<{
  label: string;
  resolver: PlaceResolver | undefined;
  report: (error: unknown, context: Record<string, string>) => void;
  userId: string;
}>): Promise<CityLookup> {
  if (resolver === undefined) return { kind: "unavailable" };
  try {
    const place = await resolver(label);
    return place === undefined
      ? { kind: "not-found" }
      : { kind: "found", lat: place.lat, lng: place.lng };
  } catch (error: unknown) {
    // Context to act on, never the label: a typed place is the runner's
    // own words about where they live.
    report(error, { surface: "onboarding.lookUpCity", userId });
    return { kind: "unavailable" };
  }
}
