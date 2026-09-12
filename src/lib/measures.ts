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
import type { DistanceUnit, TempUnit } from "./contracts";
import { formatTemp } from "./temperature";

const METRES_PER_MILE = 1609.34;
const METRES_PER_KM = 1000;

export function formatDistance(
  distanceM: number,
  unit: DistanceUnit,
): string {
  return unit === "km"
    ? `${(distanceM / METRES_PER_KM).toFixed(1)}km`
    : `${(distanceM / METRES_PER_MILE).toFixed(1)}mi`;
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
 * The temperature a run actually covered: `[4°]` when it fits one hour,
 * `[4–12°]` when it does not.
 *
 * The en dash, and no space around it, is what `bandLabel` already renders
 * for a band ("38–46°"), so a range of conditions and a range of bands read
 * as the same kind of thing.
 *
 * Collapsing when the ends agree is not cosmetic: most runs are inside one
 * hour, and `[4–4°]` would read as a measurement error rather than a short
 * run. Rounding happens before the comparison — in the reader's own unit,
 * which is why the unit is an argument rather than applied afterwards: two
 * temperatures a degree apart in Celsius can round to the same Fahrenheit
 * value, and the range should collapse when the numbers a person sees are
 * the same.
 */
export const formatTempRange = (
  minC: number,
  maxC: number,
  unit: TempUnit,
): string => {
  const low = formatTemp(minC, unit);
  const high = formatTemp(maxC, unit);
  return low === high ? low : `${low.replace("°", "")}–${high}`;
};
