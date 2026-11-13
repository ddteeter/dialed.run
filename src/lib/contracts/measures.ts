/**
 * How a measured value reads on a screen.
 *
 * These were duplicated as local helpers inside route files, where nothing
 * could test them — and a distance formatter that is wrong is wrong on
 * every entry in the app at once. They live in `lib` because the feed and
 * the runs lane both show the same numbers.
 *
 * Unit choice is display-only and stays here: R-6 will make it a user
 * preference, and the contract keeps storing SI either way.
 */
import type { DistanceUnit, TempUnit, Units } from "./profile";
import { formatTemp, tempInUnit } from "./temperature";

const METRES_PER_MILE = 1609.34;
const METRES_PER_KM = 1000;

export function formatDistance(distanceM: number, unit: DistanceUnit): string {
  return `${distanceNumber(distanceM, unit)}${unit}`;
}

/**
 * Metres in one of the runner's distance units.
 */
function metresPer(unit: DistanceUnit): number {
  return unit === "km" ? METRES_PER_KM : METRES_PER_MILE;
}

/**
 * The distance alone, at one decimal, in the runner's unit — "6.2".
 *
 * For the lines that set the number apart from its unit: A3's header
 * reads "6.2 AT 41°" and A2's "6.2 MI · 41°F DAMP", where the unit is a
 * word of its own or not there at all. `formatDistance` is this with the
 * unit glued on, so the two cannot round differently.
 */
export function distanceNumber(distanceM: number, unit: DistanceUnit): string {
  return (distanceM / metresPer(unit)).toFixed(1);
}

/**
 * A distance to the whole unit, in the runner's unit — "412" — for a
 * running total, where a tenth is noise: a shoe's mileage on the public
 * profile's rotation (round 41 #86d, "412 MI").
 */
export function wholeDistanceNumber(
  distanceM: number,
  unit: DistanceUnit,
): string {
  return String(Math.round(distanceM / metresPer(unit)));
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
  return `${String(windNumber(windKph, unit))}${unit === "km" ? "km/h" : "mph"}`;
}

/**
 * The wind's speed alone, whole, in the runner's unit an hour: what
 * `formatWind` shows and `measuredLine` says.
 */
function windNumber(windKph: number, unit: DistanceUnit): number {
  return Math.round((windKph * METRES_PER_KM) / metresPer(unit));
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
  const { hours, minutes, seconds } = clockParts(durationS);
  const ss = seconds.toString().padStart(2, "0");
  return hours === 0
    ? `${String(minutes)}:${ss}`
    : `${String(hours)}:${minutes.toString().padStart(2, "0")}:${ss}`;
}

/**
 * A duration's hours, minutes and seconds, the one split both the shown
 * and the spoken form read, so the two cannot disagree.
 */
function clockParts(durationS: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  return {
    hours: Math.floor(durationS / 3600),
    minutes: Math.floor((durationS % 3600) / 60),
    seconds: durationS % 60,
  };
}

/**
 * "51 minutes 38 seconds" — `formatDuration` as a screen reader should say
 * it. "51:38" is read as a time of day, and "1:03:41" as a clock. A part
 * that is zero is left out ("8 minutes", "1 hour 5 seconds"); a duration
 * of nothing at all is "0 seconds".
 */
export function spokenDuration(durationS: number): string {
  const { hours, minutes, seconds } = clockParts(durationS);
  const parts = [
    counted(hours, "hour"),
    counted(minutes, "minute"),
    counted(seconds, "second"),
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? "0 seconds" : parts.join(" ");
}

/**
 * "1 minute", "2 minutes"; nothing for none.
 */
function counted(count: number, word: string): string | undefined {
  if (count === 0) return undefined;
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Pace — time per mile or kilometre — in the runner's own unit: `8:40 /mi`,
 * `5:23 /km`, as A1's parsed card and D's run strip draw it (round 22). The
 * time is `formatDuration`'s rather than a second copy of it, so a slow
 * hour-long mile reads "1:02:10 /mi" and not "62:10 /mi" — see
 * `formatDuration`'s own note on why that bug mattered.
 *
 * Nothing when the run has no distance: a treadmill session logged by
 * time alone has no pace, and `Infinity:NaN /mi` is not one.
 */
export function formatPace(
  durationS: number,
  distanceM: number,
  unit: DistanceUnit,
): string | undefined {
  return paceForms(durationS, distanceM, unit)?.shown;
}

const UNIT_WORD: Record<DistanceUnit, string> = {
  mi: "mile",
  km: "kilometre",
};

/**
 * The pace alone, "8:25" shown and "8 minutes 25 seconds" said, for the
 * lines that set the number apart from its unit — the public kit's stats
 * (round 41 #86c) draw the unit as a word of its own under it (`paceUnit`).
 * `paceForms` is this with the unit glued on, so the two cannot round
 * differently. Nothing with no distance.
 */
export function paceNumber(
  durationS: number,
  distanceM: number,
  unit: DistanceUnit,
): { shown: string; said: string } | undefined {
  const seconds = paceSeconds(durationS, distanceM, unit);
  return seconds === undefined
    ? undefined
    : { shown: formatDuration(seconds), said: spokenDuration(seconds) };
}

/**
A pace's unit: "/mi" shown, "per mile" said.
*/
export function paceUnit(unit: DistanceUnit): { shown: string; said: string } {
  return { shown: `/${unit}`, said: `per ${UNIT_WORD[unit]}` };
}

/**
 * Whole seconds per unit — what `paceNumber` shows and `spokenPace` says.
 * Nothing with no distance.
 */
function paceSeconds(
  durationS: number,
  distanceM: number,
  unit: DistanceUnit,
): number | undefined {
  return distanceM <= 0
    ? undefined
    : Math.round((durationS * metresPer(unit)) / distanceM);
}

/**
 * `formatPace` as a screen reader should say it: "8 minutes 15 seconds
 * per mile". "8:15 /mi" is read as "eight fifteen slash m i". Nothing with
 * no distance, as `formatPace`.
 */
export function spokenPace(
  durationS: number,
  distanceM: number,
  unit: DistanceUnit,
): string | undefined {
  return paceForms(durationS, distanceM, unit)?.said;
}

/**
 * A pace both ways at once — `formatPace`'s and `spokenPace`'s — for a
 * screen that shows one and says the other, and must have both or
 * neither. Nothing with no distance.
 */
export function paceForms(
  durationS: number,
  distanceM: number,
  unit: DistanceUnit,
): { shown: string; said: string } | undefined {
  const pace = paceNumber(durationS, distanceM, unit);
  if (pace === undefined) return undefined;
  const per = paceUnit(unit);
  return {
    shown: `${pace.shown} ${per.shown}`,
    said: `${pace.said} ${per.said}`,
  };
}

const FEET_PER_METRE = 3.28084;

/**
 * Elevation gain in the runner's own unit, and the unit's word: feet for a
 * runner who counts miles, metres for one who counts kilometres — round
 * 41's "210 FT GAIN". Whole numbers; nobody climbs a tenth of a foot.
 */
export function gainNumber(
  elevationGainM: number,
  unit: DistanceUnit,
): { value: string; unit: "ft" | "m" } {
  return unit === "km"
    ? { value: String(Math.round(elevationGainM)), unit: "m" }
    : {
        value: String(Math.round(elevationGainM * FEET_PER_METRE)),
        unit: "ft",
      };
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

/**
 * One measure in a line of them, as `measuredLine` draws and says it.
 *
 * - `temp`: "33°", or "41°F" `withLetter`, or "Feels 33°" with `feels`
 *   (its case is the line's: A1 starts with it, the receipt does not).
 * - `range`: `formatTempRange`'s "38–46°", collapsed as it collapses,
 *   "feels" as a temperature's.
 * - `humidity`: "80% hum". `wind`: `formatWind`'s "6mph".
 * - `distance`: "8.2mi", or "6.2 mi" `spaced`, as A2's header sets it.
 * - `duration`: `formatDuration`'s "51:38", said by `spokenDuration`.
 * - `word`: anything already in words (a sky, a precip class, a
 *   condition, a day or a time), drawn and said as it is.
 */
type MeasuredPart =
  | Readonly<{
      kind: "temp";
      tempC: number;
      withLetter?: boolean;
      feels?: "Feels" | "feels";
    }>
  | Readonly<{
      kind: "range";
      minC: number;
      maxC: number;
      feels?: "Feels" | "feels";
    }>
  | Readonly<{ kind: "humidity"; percent: number }>
  | Readonly<{ kind: "wind"; windKph: number }>
  | Readonly<{ kind: "distance"; distanceM: number; spaced?: boolean }>
  | Readonly<{ kind: "duration"; durationS: number }>
  | Readonly<{ kind: "word"; word: string }>;

/**
 * A line of measures: groups joined by " · ", and within a group parts
 * joined by a space ("41°F damp · feels 36°" is two groups).
 */
export type MeasuredLine = readonly (readonly MeasuredPart[])[];

/**
 * A line of abbreviated measures as it is drawn, and as a screen reader
 * should say it: the Accessibility Contract's "Measured lines" row (round
 * 52 #158). Full words, a comma between every part, units spelled out,
 * in the viewer's own units: "Feels 33° · 80% hum · 6mph · overcast" is
 * said "Feels like 33 degrees, 80 percent humidity, wind 6 miles per
 * hour, overcast".
 *
 * **Both halves come from one list of parts**, through the same
 * converters, so a part added to the drawn line is said too and the two
 * cannot round apart. `ui/Spoken` renders them: the drawn half
 * `aria-hidden`, the said half visually hidden.
 */
export function measuredLine(
  line: MeasuredLine,
  units: Units,
): { shown: string; said: string } {
  const shown = line
    .map((group) => group.map((part) => shownPart(part, units)).join(" "))
    .join(" · ");
  const said = line
    .flat()
    .map((part) => saidPart(part, units))
    .join(", ");
  return { shown, said: `${said.charAt(0).toUpperCase()}${said.slice(1)}` };
}

function shownPart(part: MeasuredPart, units: Units): string {
  switch (part.kind) {
    case "temp": {
      const feels = part.feels === undefined ? "" : `${part.feels} `;
      const letter = part.withLetter === true ? units.temp.toUpperCase() : "";
      return `${feels}${formatTemp(part.tempC, units.temp)}${letter}`;
    }
    case "range": {
      const feels = part.feels === undefined ? "" : `${part.feels} `;
      return `${feels}${formatTempRange(part.minC, part.maxC, units.temp)}`;
    }
    case "humidity": {
      return `${String(Math.round(part.percent))}% hum`;
    }
    case "wind": {
      return formatWind(part.windKph, units.distance);
    }
    case "distance": {
      return part.spaced === true
        ? `${distanceNumber(part.distanceM, units.distance)} ${units.distance}`
        : formatDistance(part.distanceM, units.distance);
    }
    case "duration": {
      return formatDuration(part.durationS);
    }
    case "word": {
      return part.word;
    }
  }
}

function saidPart(part: MeasuredPart, units: Units): string {
  switch (part.kind) {
    case "temp": {
      const feels = part.feels === undefined ? "" : "feels like ";
      const letter =
        part.withLetter === true ? ` ${TEMP_UNIT_WORD[units.temp]}` : "";
      return `${feels}${degrees(tempInUnit(part.tempC, units.temp))}${letter}`;
    }
    case "range": {
      const feels = part.feels === undefined ? "" : "feels like ";
      const low = tempInUnit(part.minC, units.temp);
      const high = tempInUnit(part.maxC, units.temp);
      const span =
        low === high ? degrees(low) : `${signed(low)} to ${degrees(high)}`;
      return `${feels}${span}`;
    }
    case "humidity": {
      return `${String(Math.round(part.percent))} percent humidity`;
    }
    case "wind": {
      const speed = windNumber(part.windKph, units.distance);
      const word = UNIT_WORD[units.distance];
      return `wind ${String(speed)} ${word}${speed === 1 ? "" : "s"} per hour`;
    }
    case "distance": {
      return `${distanceNumber(part.distanceM, units.distance)} ${UNIT_WORD[units.distance]}s`;
    }
    case "duration": {
      return spokenDuration(part.durationS);
    }
    case "word": {
      return part.word;
    }
  }
}

/**
"Fahrenheit" for the "F" after a temperature.
*/
const TEMP_UNIT_WORD: Record<TempUnit, string> = {
  f: "Fahrenheit",
  c: "Celsius",
};

/**
"Minus 3" for -3: a screen reader may say a hyphen as "dash".
*/
function signed(value: number): string {
  return value < 0 ? `minus ${String(-value)}` : String(value);
}

/**
"33 degrees", "1 degree", "minus 1 degree".
*/
function degrees(value: number): string {
  return `${signed(value)} ${Math.abs(value) === 1 ? "degree" : "degrees"}`;
}
