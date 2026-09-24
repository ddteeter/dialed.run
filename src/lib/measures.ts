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

export function formatDistance(distanceM: number, unit: DistanceUnit): string {
  return unit === "km"
    ? `${(distanceM / METRES_PER_KM).toFixed(1)}km`
    : `${(distanceM / METRES_PER_MILE).toFixed(1)}mi`;
}

/**
 * Wind speed in the runner's own units — `6mph` or `9km/h`.
 *
 * Styled like `formatDistance` beside it (`8.1mi`, no space), and keyed on
 * the *distance* unit, since a runner who counts miles counts miles an
 * hour. The conversion is derived from the two constants above rather
 * than a third copy of what a mile is.
 *
 * **The backlog wrote `WIND ${Math.round(windKph)}` — kph for everybody**,
 * so a runner set to miles read 15 where the air was doing 9. Found by the
 * 2026-09-22 reconciliation sweep.
 */
export function formatWind(windKph: number, unit: DistanceUnit): string {
  return unit === "km"
    ? `${String(Math.round(windKph))}km/h`
    : `${String(Math.round((windKph * METRES_PER_KM) / METRES_PER_MILE))}mph`;
}

/**
 * `m:ss` under an hour, `h:mm:ss` from one — padded everywhere except the
 * leading field, since "07:05" reads like a clock time rather than a
 * duration.
 *
 * **It never produced hours**, and nothing noticed: a run is usually
 * under an hour, and every test here was. So a 1h 03m 41s run read
 * `63:41` on the post detail and the backlog, where the boards draw
 * `1:03:41`. Found by the 2026-09-22 reconciliation sweep, which seeded an
 * 8.1-mile run because that is what board D draws.
 */
export function formatDuration(durationS: number): string {
  const hours = Math.floor(durationS / 3600);
  const minutes = Math.floor((durationS % 3600) / 60);
  const seconds = (durationS % 60).toString().padStart(2, "0");
  return hours === 0
    ? `${String(minutes)}:${seconds}`
    : `${String(hours)}:${minutes.toString().padStart(2, "0")}:${seconds}`;
}

/**
 * Pace in the runner's own unit — `8:40 /mi`, `5:23 /km` — as D's run
 * strip draws it (round 22).
 *
 * Nothing when the run has no distance: a treadmill session logged by
 * time alone has no pace, and `Infinity:NaN /mi` is not one.
 */
export function formatPace(
  durationS: number,
  distanceM: number,
  unit: DistanceUnit,
): string | undefined {
  if (distanceM <= 0) return undefined;
  const metres = unit === "km" ? METRES_PER_KM : METRES_PER_MILE;
  const perUnit = Math.round((durationS * metres) / distanceM);
  const seconds = (perUnit % 60).toString().padStart(2, "0");
  return `${String(Math.floor(perUnit / 60))}:${seconds} /${unit}`;
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
