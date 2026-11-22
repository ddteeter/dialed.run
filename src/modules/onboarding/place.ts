import type { CityLookup } from "../../lib/contracts/city-lookup";
import type { ResolvedPlace } from "../../lib/contracts";
import { roundCoordinate } from "../../lib/coords";
import { isWeatherBudgetSpent } from "../weather";

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
  stamp,
  report,
  userId,
}: Readonly<{
  label: string;
  resolver: PlaceResolver;
  stamp: (place: ResolvedPlace) => Promise<string>;
  report: (error: unknown, context: Record<string, string>) => void;
  userId: string;
}>): Promise<CityLookup> {
  try {
    const found = await resolver(label);
    if (found === undefined) return { kind: "not-found" };
    // Rounded as a profile's coordinates are, so the stamp names the
    // place exactly as the writers will parse it.
    const place = {
      address: found.address,
      lat: roundCoordinate(found.lat),
      lng: roundCoordinate(found.lng),
    };
    return { kind: "found", ...place, stamp: await stamp(place) };
  } catch (error: unknown) {
    // Context to act on, never the label: a typed place is the runner's
    // own words about where they live. A spent budget (SA-M13) is the
    // limit working, not a failure to hear about.
    if (!isWeatherBudgetSpent(error)) {
      report(error, { surface: "onboarding.lookUpCity", userId });
    }
    return { kind: "unavailable" };
  }
}

/**
 * The most parts of the provider's address a saved place keeps: city,
 * region and country, the last three.
 */
const PLACE_PARTS = 3;

/**
 * The provider's address as a place name: its last three comma parts,
 * each without the words that hold a digit (a house number, a postcode),
 * so a street address the provider resolved keeps only where it is.
 * `undefined` when nothing is left, as for an answer that is only
 * coordinates.
 */
export function placeNameOf(address: string): string | undefined {
  const parts = address
    .split(",")
    .map((part) =>
      part
        .split(/\s+/u)
        .filter((word) => word !== "" && !/\d/u.test(word))
        .join(" "),
    )
    .filter((part) => part !== "");
  return parts.length === 0 ? undefined : parts.slice(-PLACE_PARTS).join(", ");
}
