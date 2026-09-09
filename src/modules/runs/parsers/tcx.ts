/**
 * TCX parser (102 §3), XXE-safe (`processEntities: false`, see gpx.ts).
 * Unlike GPX, TCX carries lap-level `TotalTimeSeconds`/`DistanceMeters`
 * independent of GPS fix — a treadmill export naturally has laps with no
 * `<Position>` on any trackpoint, which is exactly the "no GPS track"
 * signal the packet asks for (imports as `indoor` with real duration and
 * distance from the lap totals, no separate code path).
 */
import { runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import {
  RunParseError,
  parseXmlDocument,
  isRecord,
  readDate,
  readNumber,
  toArray,
} from "./shared";

interface Position {
  lat: number;
  lon: number;
}

function positionOf(point: unknown): Position | undefined {
  if (!isRecord(point) || !isRecord(point.Position)) return undefined;
  const lat = readNumber(point.Position.LatitudeDegrees);
  const lon = readNumber(point.Position.LongitudeDegrees);
  return lat === undefined || lon === undefined ? undefined : { lat, lon };
}

function firstPositionInTrack(track: unknown): Position | undefined {
  // Equivalent mutant on this guard alone: a non-record track has no
  // `Trackpoint` to read, so the loop below finds nothing and the function
  // returns undefined anyway. The guard is what narrows `unknown`.
  // Stryker disable next-line ConditionalExpression
  if (!isRecord(track)) return undefined;
  for (const point of toArray(track.Trackpoint)) {
    const position = positionOf(point);
    if (position !== undefined) return position;
  }
  return undefined;
}

function firstPosition(lap: Record<string, unknown>): Position | undefined {
  for (const track of toArray(lap.Track)) {
    const position = firstPositionInTrack(track);
    if (position !== undefined) return position;
  }
  return undefined;
}

function firstOf(value: unknown): Record<string, unknown> | undefined {
  const first = toArray(value)[0];
  return isRecord(first) ? first : undefined;
}

/**
Navigates TrainingCenterDatabase > Activities > Activity[0] > Lap[0].
*/
function findLap(doc: unknown): Record<string, unknown> | undefined {
  // Equivalent: `parseXmlDocument` always hands back an object for a
  // document it accepted. The guard is what narrows `unknown`.
  // Stryker disable next-line ConditionalExpression
  if (!isRecord(doc)) return undefined;
  const root = doc.TrainingCenterDatabase;
  if (!isRecord(root)) return undefined;
  const activities = root.Activities;
  // Equivalent: a non-record `Activities` has no `Activity` to read, so
  // `firstOf` answers undefined and the lap is missing either way.
  // Stryker disable next-line ConditionalExpression
  if (!isRecord(activities)) return undefined;
  const activity = firstOf(activities.Activity);
  if (activity === undefined) return undefined;
  return firstOf(activity.Lap);
}

export const tcxSource: RunSource = {
  kind: "tcx",
  async parse(bytes: ArrayBuffer): Promise<RunDraft> {
    // fast-xml-parser is synchronous; see gpx.ts for why this stays async.
    await Promise.resolve();
    const doc = parseXmlDocument(bytes, "tcx");

    const lap = findLap(doc);
    if (lap === undefined) throw new RunParseError("tcx: no Lap element found");

    const startedAtDate = readDate(lap["@_StartTime"]);
    const durationS = readNumber(lap.TotalTimeSeconds);
    const distanceM = readNumber(lap.DistanceMeters);
    // The two `!== undefined` checks are equivalent on their own —
    // `undefined > 0` is already false — and are here so the comparison
    // below reads as a comparison between numbers.
    // Stryker disable next-line ConditionalExpression
    const hasRequiredTotals =
      startedAtDate !== undefined &&
      // Stryker disable next-line ConditionalExpression
      durationS !== undefined &&
      // Stryker disable next-line ConditionalExpression
      distanceM !== undefined &&
      durationS > 0 &&
      distanceM > 0;
    if (!hasRequiredTotals) throw new RunParseError("tcx: lap missing positive TotalTimeSeconds/DistanceMeters");

    const position = firstPosition(lap);

    const parsed = runDraftSchema.safeParse({
      startedAt: Math.floor(startedAtDate.getTime() / 1000),
      durationS: Math.round(durationS),
      distanceM,
      indoor: position === undefined,
      title: "Imported run",
      ...(position && { lat: position.lat, lng: position.lon }),
    });
    if (!parsed.success) throw new RunParseError("tcx: assembled draft failed runDraftSchema", { cause: parsed.error });
    return parsed.data;
  },
};
