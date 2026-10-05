/**
 * Shared parser plumbing (102 §3). Every format-specific parser throws one
 * of two user-facing messages on a file it cannot use — never a thrown
 * 500, per the packet — so the queue consumer can surface it verbatim on
 * the import row, and A1 can say which of round 22's sentences applies.
 */
import { XMLParser } from "fast-xml-parser";

import type { RunDraft } from "../../../lib/contracts";
import { NO_TRACK_MESSAGE, PARSE_FAILURE_MESSAGE } from "../upload-limits";

/**
 * Re-exported from the client-safe sibling that owns the words, so the
 * parsers' callers keep importing it from here.
 */
export { NO_TRACK_MESSAGE, PARSE_FAILURE_MESSAGE } from "../upload-limits";

/**
 * Which of round 22's two parse sentences a failure earns: a file that
 * read and held no run is **no track** ("Export the run again"); anything
 * the decoder could not read at all is **unreadable** ("Export it again").
 */
type ParseProblem = "no-track" | "unreadable";

const MESSAGES: Readonly<Record<ParseProblem, string>> = {
  "no-track": NO_TRACK_MESSAGE,
  unreadable: PARSE_FAILURE_MESSAGE,
};

/**
 * `message` is the user-facing copy, one of two sentences. `reason` is the
 * diagnostic — which of the ~19 ways a file can fail to parse this was —
 * and `cause` carries the underlying library error where there was one.
 *
 * Both exist because the maintainer-facing half used to be thrown away:
 * every site threw the same argument-less error, so Sentry recorded "That
 * file didn't parse" nineteen different times with nothing to tell them
 * apart, and no way to see whether real users were hitting a decoder bug
 * or just uploading the wrong file. Never surface `reason` to a user.
 */
export class RunParseError extends Error {
  readonly reason: string;

  constructor(
    reason: string,
    options?: { cause?: unknown; problem?: ParseProblem },
  ) {
    super(MESSAGES[options?.problem ?? "unreadable"], options);
    this.name = "RunParseError";
    this.reason = reason;
  }
}

/**
 * The one XXE-safe XML parser, shared by GPX and TCX.
 *
 * `processEntities: false` disables DOCTYPE and entity expansion entirely,
 * so a hostile upload cannot smuggle an external-entity or billion-laughs
 * payload through. It was configured identically in both parsers — which
 * is one place for that decision to be changed and another to be forgotten.
 *
 * **Built per call, not at module scope, and that is a bundle decision
 * rather than a performance one (R-50).** `new XMLParser(…)` is a call
 * rollup cannot prove pure, so a module-scope one is a side effect it must
 * keep — and keeping it kept `fast-xml-parser` and its four dependencies,
 * ~63 kB, in the *client* entry chunk that every visitor downloads.
 * Nothing else in this file survived tree-shaking; that one constant did.
 *
 * Per call rather than memoised because the constructor only stores
 * options — the work is all in `parse` — and the caller is a queue
 * consumer handling one file per message. A cache here would buy nothing
 * and would mean assigning to a module binding from inside a function,
 * which is its own small trap.
 */
function xmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
  });
}

/**
 * Decodes and parses an uploaded XML document, or fails with the reason it
 * could not. `kind` names the format in the maintainer-facing reason; the
 * user reads the same sentence either way.
 */
export function parseXmlDocument(bytes: ArrayBuffer, kind: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new RunParseError(`${kind}: bytes are not valid UTF-8`, {
      cause: error,
    });
  }
  try {
    return xmlParser().parse(text);
  } catch (error) {
    throw new RunParseError(`${kind}: XML parser threw`, { cause: error });
  }
}

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
Type guard, not a cast: GPX/TCX are parsed to `unknown` (trust boundary —
CLAUDE.md), and every field access below narrows through this rather than
an `as` assertion.
*/
export function isRecord(value: unknown): value is Record<string, unknown> {
  // Equivalent mutant on the null check alone: `typeof null` is "object",
  // so dropping it lets null through — but every caller then reads a
  // property off it and throws, and no XML document this parser accepts
  // produces a bare null where an element is expected. The check is what
  // makes the guard a guard rather than a typeof.
  // Stryker disable next-line ConditionalExpression
  return typeof value === "object" && value !== null;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function readDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
Great-circle distance between two lat/lng points, in meters.
*/
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const earthRadiusM = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinLon * sinLon;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(a));
}

/**
 * One child of an XML element, or undefined when the value is not an
 * element at all. The guard lives here once, so a parser reading a field
 * off a node it has not narrowed does not repeat it at every read.
 */
export function child(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * A value as a list of zero or one, for `flatMap`: a reading the file did
 * not carry adds nothing rather than an `undefined`.
 */
export function present<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

/**
 * How far the altitude must turn before the turn counts (D-111, design
 * 132; ten metres is the owner's ruling, 2026-10-04). It runs after the
 * median, which takes out the per-point noise; what is left is GPS
 * altitude's slower wander, several metres over minutes, and a sum of
 * every rise would read that as a climb. Ten is Strava's published
 * threshold for elevation without a barometer (it uses two for barometric
 * data), so a runner comparing the two sees the same kind of number. GPX
 * and TCX altitudes are treated as GPS-derived because neither format says
 * which they are; FIT reads the watch's own `totalAscent` and never comes
 * here. The cost is a climb under ten metres, which goes uncounted.
 */
export const ELEVATION_HYSTERESIS_M = 10;

/**
 * How many points the altitude median is taken over before the hysteresis
 * reads it (design 132). The hysteresis alone is not enough: GPS altitude
 * is noisy *per point*, and a noisy fix in the tail clears any threshold
 * against its neighbour. At the 5 m hysteresis first built, a flat hour at
 * one point a second with ±3 m of noise read 790 m (review of #152); at
 * 10 m, a flat hour of Gaussian noise reads 170–230 m at σ = 2 m and
 * 1,600–1,750 m at σ = 3 m.
 *
 * A median of eleven points drops any burst of up to five consecutive bad
 * fixes — multipath and a lost lock come in bursts of seconds, not single
 * points — and measured, takes the σ = 2 m hour to 0 and the σ = 3 m hour
 * to between 0 and 11 m, depending on the seed. A median rather than a mean because a
 * median keeps a steady climb exactly as it was — the middle of a rising
 * window is its middle point — and throws a wild fix away instead of
 * spreading it over its neighbours. The cost is a crest shorter than about
 * half the window: a bump of under six points (six seconds at 1 Hz, half a
 * minute with smart recording) is shaved, and no hill a runner would call
 * one is that short.
 */
export const ELEVATION_MEDIAN_WINDOW = 11;

/**
 * Each altitude replaced by the median of the window centred on it. The
 * window shrinks symmetrically towards the ends, so the first and last
 * altitudes are kept as they are and a short file is not averaged into
 * one value.
 */
export function smoothedAltitudes(altitudes: readonly number[]): number[] {
  const radius = (ELEVATION_MEDIAN_WINDOW - 1) / 2;
  return altitudes.map((altitude, index) => {
    const reach = Math.min(radius, index, altitudes.length - 1 - index);
    const window = altitudes
      .slice(index - reach, index + reach + 1)
      .toSorted((a, b) => a - b);
    return window[reach] ?? altitude;
  });
}

/**
 * Metres climbed over a run of altitudes, in order, with hysteresis: the
 * reference follows the altitude freely in the direction it is already
 * going, and a turn only counts once it exceeds `ELEVATION_HYSTERESIS_M`.
 * A climb that has started is counted in full, every metre of it. The
 * first rise has to clear the threshold like any other turn.
 *
 * Undefined with fewer than two altitudes: a file that carries none has
 * not said the run was flat.
 */
export function hysteresisGainMeters(
  altitudes: readonly number[],
): number | undefined {
  let gain = 0;
  let isClimbing = false;
  let reference: number | undefined;
  for (const altitude of altitudes) {
    if (reference === undefined) {
      reference = altitude;
    } else if (isClimbing) {
      const peak = Math.max(reference, altitude);
      gain += peak - reference;
      reference = peak;
      if (peak - altitude > ELEVATION_HYSTERESIS_M) {
        isClimbing = false;
        reference = altitude;
      }
    } else {
      reference = Math.min(reference, altitude);
      if (altitude - reference > ELEVATION_HYSTERESIS_M) {
        isClimbing = true;
        gain += altitude - reference;
        reference = altitude;
      }
    }
  }
  return altitudes.length < 2 ? undefined : gain;
}

/**
 * The climb a file's altitudes describe: the per-point noise taken out by
 * the median, then the slower wander by the hysteresis.
 */
export function elevationGainMeters(
  altitudes: readonly number[],
): number | undefined {
  return hysteresisGainMeters(smoothedAltitudes(altitudes));
}

/**
 * The two readings D-111 adds, as a draft carries them. An indoor run
 * carries neither — a treadmill's moving time and climb are not the
 * runner's (D-111) — and a moving time that rounds to nothing is left out
 * rather than stored as a zero nobody measured.
 */
export function fileMetrics(
  isIndoor: boolean,
  movingSeconds: number | undefined,
  elevationGainM: number | undefined,
): Pick<RunDraft, "movingS" | "elevationGainM"> {
  if (isIndoor) return {};
  const movingS = Math.round(movingSeconds ?? 0);
  return { movingS: movingS > 0 ? movingS : undefined, elevationGainM };
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
