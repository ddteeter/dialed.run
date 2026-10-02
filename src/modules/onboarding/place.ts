import type { CityLookup } from "../../lib/contracts/city-lookup";
import type { ResolvedPlace } from "../../lib/contracts";

/**
 * The typed city, found before it is used (round 26 #12).
 *
 * The provider resolves one place from a typed label — it does not suggest
 * as you type — so the runner presses **Find**, reads the place that came
 * back, and presses **Use this**. Nothing is saved on Find. The resolver
 * is `modules/weather`'s `resolvePlace` (Visual Crossing); it is handed in
 * rather than imported so this decision is testable without the network.
 *
 * One lookup for both places that ask — O1's city step and Your
 * conditions — because they are the same field (round 26 draws it once).
 */

/**
The shape of `modules/weather`'s `resolvePlace`.
*/
export type PlaceResolver = (
  label: string,
) => Promise<ResolvedPlace | undefined>;

/**
 * Asks the provider once, and reports a provider failure rather than
 * swallowing it (laws 6 and 7): the runner sees the `NOT FOUND YET` band
 * and can try again, and Sentry hears why.
 *
 * `found` carries the provider's own name for the place — the answer to
 * "which Portland?" that the runner confirms, and what is saved.
 */
export async function lookUpCity({
  label,
  resolver,
  report,
  userId,
}: Readonly<{
  label: string;
  resolver: PlaceResolver;
  report: (error: unknown, context: Record<string, string>) => void;
  userId: string;
}>): Promise<CityLookup> {
  try {
    const place = await resolver(label);
    return place === undefined
      ? { kind: "not-found" }
      : {
          kind: "found",
          address: place.address,
          lat: place.lat,
          lng: place.lng,
        };
  } catch (error: unknown) {
    // Context to act on, never the label: a typed place is the runner's
    // own words about where they live.
    report(error, { surface: "onboarding.lookUpCity", userId });
    return { kind: "unavailable" };
  }
}
