import { defaultUnits } from "../../lib/contracts";
import type { Units } from "../../lib/contracts";

/**
 * The units to *offer* at O1, guessed from the browser's `Accept-Language`.
 *
 * **A guess, and the form shows it as an editable answer** — requirement 1
 * says units come from locale and stay editable, and both halves matter: a
 * guess presented as settled is how a Canadian ends up reading miles for a
 * year without noticing there was a choice.
 *
 * **Read server-side, from the header, rather than client-side from
 * `navigator.language`.** O1 renders on the server first, and a default
 * computed after hydration is either a flash of the wrong unit or a
 * hydration mismatch. The header is available where the page is built.
 *
 * The two lists are separate because they disagree, and the case that
 * proves it is the UK: Britain buys petrol in litres and reads temperature
 * in Celsius, but every road sign and every race is in miles. One
 * `isMetric` flag would get that wrong in one direction or the other.
 */

/**
 * **The US and its territories, and nothing else — which is a decision, not
 * an oversight.** A handful of small Caribbean and Pacific states also read
 * Fahrenheit (the Bahamas, Belize, the Caymans, Palau, Micronesia, the
 * Marshall Islands). They were in this list for one revision and came out:
 * each was an unverified claim about a place this app has no user in, and
 * every one of them was a string no test could honestly assert. A guess
 * costs one tap to correct; a list of guesses costs the reader's trust in
 * the ones that are real.
 *
 * The territories stay because they report as their own region, they are
 * unambiguous, and a US-based product plausibly has someone in them.
 */
const FAHRENHEIT_REGIONS = new Set(["US", "PR", "GU", "VI", "AS"]);

/**
 * Miles, and Britain is the reason this is not the same list.
 *
 * Myanmar and Liberia are the other two non-metric road systems.
 */
const MILES_REGIONS = new Set([
  "US",
  "PR",
  "GU",
  "VI",
  "AS",
  "GB",
  "MM",
  "LR",
]);

export function unitsFromLocale(
  acceptLanguage: string | null | undefined,
): Units {
  const region = regionOf(acceptLanguage);
  if (region === undefined) return defaultUnits;
  return {
    temp: FAHRENHEIT_REGIONS.has(region) ? "f" : "c",
    distance: MILES_REGIONS.has(region) ? "mi" : "km",
  };
}

/**
 * Everything in `text` before the first `separator`, or all of it when
 * there is none.
 *
 * Exists so `regionOf` below never indexes an array. `split(…)[0]` is
 * always defined — `"".split(",")` is `[""]` — but `noUncheckedIndexedAccess`
 * types it as possibly undefined, so the `?.` that satisfies the compiler
 * is a branch no input can take and no test can kill. Both branches here
 * are reachable: a header with a comma and one without.
 */
function upTo(text: string, separator: string): string {
  const at = text.indexOf(separator);
  return at === -1 ? text : text.slice(0, at);
}

/**
 * The region subtag of the first language offered, upper-cased.
 *
 * Only the first: an `Accept-Language` is a preference list, and the
 * fallbacks in it are languages this person *also* reads, not places they
 * also live. `en-GB,en;q=0.9,fr;q=0.8` is a Briton, and taking the last
 * entry would make them French.
 *
 * A bare `en` has no region and yields nothing, which lands on
 * `defaultUnits` rather than on a guess about which English.
 */
function regionOf(acceptLanguage: string | null | undefined): string | undefined {
  // An explicit guard rather than `acceptLanguage ?? ""`, because the
  // empty string in that fallback is a literal no test can pin: any
  // nonsense substituted for it still has no region subtag, so it still
  // lands on the defaults. A branch says the same thing and both sides of
  // it are reachable — absent header, and present one.
  if (typeof acceptLanguage !== "string") return undefined;
  const tag = upTo(upTo(acceptLanguage, ",").trim(), ";");

  // **Anchored at both ends, and each anchor earns its place.** The parts
  // after the language are a script (`Latn`, `Hans` — four letters), a
  // region (two) or a variant. Drop `^` or `$` and `/[A-Za-z]{2}/` matches
  // *inside* a four-letter script, so `en-Latn-US` reads its region as
  // "Latn" and an American gets Celsius. `units-from-locale.test.ts` uses
  // exactly that tag.
  //
  // `find` returns nothing for a tag with no region — a bare `en` — so
  // this `?.` is a branch a real input takes, unlike the one indexing
  // would have needed.
  const region = tag
    .split("-")
    .slice(1)
    .find((part) => /^[A-Za-z]{2}$/.test(part));
  return region?.toUpperCase();
}
