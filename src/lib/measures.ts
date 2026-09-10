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
