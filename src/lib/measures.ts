/**
 * How a measured value reads on a screen.
 *
 * These were duplicated as local helpers inside route files, where nothing
 * could test them — and a distance formatter that is wrong is wrong on
 * every entry in the app at once. They live in `lib` because the feed and
 * the runs lane both show the same numbers.
 *
 * Unit choice is display-only and stays here: D-6 will make it a user
 * preference, and the contract keeps storing SI either way.
 */
import { formatTemp } from "./temperature";

const METRES_PER_MILE = 1609.34;

export function formatDistance(distanceM: number): string {
  return `${(distanceM / METRES_PER_MILE).toFixed(1)}mi`;
}

/**
 * `m:ss`, zero-padded on the seconds only — a run is minutes long, and
 * "07:05" reads like a clock time rather than a duration.
 */
export function formatDuration(durationS: number): string {
  const minutes = Math.floor(durationS / 60);
  const seconds = durationS % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * A temperature as the app shows it today.
 *
 * Equivalent mutant on the unit inside: `formatTemp` branches only on
 * "c", so anything else takes the same Fahrenheit path and no test can
 * tell the two apart. D-6 turns this into a user preference, and then it
 * becomes a real choice — in one place rather than at every call site,
 * which is why this exists.
 */
// Stryker disable next-line StringLiteral
export const inFahrenheit = (tempC: number): string => formatTemp(tempC, "f");

/**
 * The temperature a run actually covered: `[4°]` when it fits one hour,
 * `[4–12°]` when it does not.
 *
 * The en dash, and no space around it, is what `bandLabel` already renders
 * for a band ("38–46°"), so a range of conditions and a range of bands read
 * as the same kind of thing. That is the whole reason this reuses the
 * existing device instead of inventing one (CLAUDE.md, undesigned
 * surfaces).
 *
 * Collapsing when the ends agree is not cosmetic: most runs are inside one
 * hour, and `[4–4°]` would read as a measurement error rather than a short
 * run. Rounding happens before the comparison, so 4.2° and 4.4° collapse
 * too — they render identically, and a range whose ends print the same is
 * the thing this exists to avoid.
 */
export const inFahrenheitRange = (minC: number, maxC: number): string => {
  const low = inFahrenheit(minC);
  const high = inFahrenheit(maxC);
  return low === high ? low : `${low.replace("°", "")}–${high}`;
};
