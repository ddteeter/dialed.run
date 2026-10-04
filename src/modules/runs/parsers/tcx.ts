/**
 * TCX parser (102 §3), XXE-safe (`processEntities: false`, see gpx.ts).
 * Unlike GPX, TCX carries lap-level `TotalTimeSeconds`/`DistanceMeters`
 * independent of GPS fix — a treadmill export naturally has laps with no
 * `<Position>` on any trackpoint, which is exactly the "no GPS track"
 * signal the packet asks for (imports as `indoor` with real duration and
 * distance from the lap totals, no separate code path).
 *
 * A run is every lap, not the first one. A Garmin export writes one
 * `<Lap>` per auto-lap — often each mile — so a 6-mile run is six laps,
 * and reading only the first imported it as its first mile (R-130).
 * Distance is the sum of every lap's totals; the start time is the first
 * lap's.
 *
 * Time is read two ways (D-111, design 132). A lap's `TotalTimeSeconds` is
 * timer time — it stops when the watch is paused — so the laps' sum is the
 * run's moving time. The run's duration is elapsed time, which keeps
 * running through a pause: from the first lap's start to the last
 * trackpoint, and never less than the laps' sum, which is what a file with
 * no timed trackpoints falls back to.
 */
import { runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import {
  RunParseError,
  child,
  elevationGainMeters,
  fileMetrics,
  parseXmlDocument,
  isRecord,
  present,
  readDate,
  readNumber,
  sum,
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
Navigates TrainingCenterDatabase > Activities > Activity[0]. Only the first
activity is read: v1 imports one run per file, and a multi-activity export
(a multisport session, say) is out of scope rather than summed.
*/
function findActivity(doc: unknown): Record<string, unknown> | undefined {
  // Equivalent: `parseXmlDocument` always hands back an object for a
  // document it accepted. The guard is what narrows `unknown`.
  // Stryker disable next-line ConditionalExpression
  if (!isRecord(doc)) return undefined;
  const root = doc.TrainingCenterDatabase;
  if (!isRecord(root)) return undefined;
  const activities = root.Activities;
  // A course file has no `Activities` at all, and reading `.Activity` off
  // undefined would throw a TypeError instead of refusing the file.
  if (!isRecord(activities)) return undefined;
  return firstOf(activities.Activity);
}

/**
One lap total, or NaN when it is missing, unreadable or negative.

NaN marks the lap, and one marked lap refuses the whole file — the refusal
a single-lap file without a total has always earned — rather than dropping
that lap and importing a run shorter than the one that happened. Zero is a
real total (a lap button pressed twice, a lap spent stood at a crossing)
and adds nothing.
*/
function lapTotal(value: unknown): number {
  const total = readNumber(value) ?? NaN;
  return total >= 0 ? total : NaN;
}

interface LapReading {
  seconds: number;
  metres: number;
  position: Position | undefined;
  // Every trackpoint's altitude, in order, where it has one.
  altitudes: number[];
  // Every trackpoint's time, in epoch milliseconds, where it has one.
  times: number[];
}

function trackpointsOf(lap: Record<string, unknown>): unknown[] {
  return toArray(lap.Track).flatMap((track: unknown) =>
    toArray(child(track, "Trackpoint")),
  );
}

function readLap(lap: unknown): LapReading {
  // Equivalent: a non-record lap (`<Lap/>` parses to "") has no children,
  // so every read below answers undefined — NaN totals, no position —
  // whether or not it is swapped for an empty object. The guard is what
  // narrows `unknown`.
  // Stryker disable next-line ConditionalExpression
  const fields: Record<string, unknown> = isRecord(lap) ? lap : {};
  const points = trackpointsOf(fields);
  return {
    seconds: lapTotal(fields.TotalTimeSeconds),
    metres: lapTotal(fields.DistanceMeters),
    position: firstPosition(fields),
    altitudes: points.flatMap((point) =>
      present(readNumber(child(point, "AltitudeMeters"))),
    ),
    times: points.flatMap((point) =>
      present(readDate(child(point, "Time"))?.getTime()),
    ),
  };
}

export const tcxSource: RunSource = {
  kind: "tcx",
  async parse(bytes: ArrayBuffer): Promise<RunDraft> {
    // fast-xml-parser is synchronous; see gpx.ts for why this stays async.
    await Promise.resolve();
    const doc = parseXmlDocument(bytes, "tcx");

    const laps = toArray(findActivity(doc)?.Lap);
    const firstLap = laps[0];
    if (!isRecord(firstLap)) {
      throw new RunParseError("tcx: no Lap element found", {
        problem: "no-track",
      });
    }

    // Every refusal below names the lap, or the laps, it found wrong: the
    // reason is how a maintainer tells one bad file from another.
    const count = String(laps.length);
    const startedAtDate = readDate(firstLap["@_StartTime"]);
    if (startedAtDate === undefined)
      throw new RunParseError(
        `tcx: lap 1 of ${count} has no readable StartTime`,
        { problem: "no-track" },
      );

    const readings = laps.map((lap) => readLap(lap));
    const unusable = readings.findIndex(
      (reading) =>
        Number.isNaN(reading.seconds) || Number.isNaN(reading.metres),
    );
    if (unusable !== -1)
      throw new RunParseError(
        `tcx: lap ${String(unusable + 1)} of ${count} has no usable TotalTimeSeconds/DistanceMeters`,
        { problem: "no-track" },
      );

    const lapSeconds = sum(readings.map((reading) => reading.seconds));
    const distanceM = sum(readings.map((reading) => reading.metres));
    if (!(lapSeconds > 0 && distanceM > 0))
      throw new RunParseError(
        `tcx: ${count} lap(s) sum to zero TotalTimeSeconds or DistanceMeters`,
        { problem: "no-track" },
      );

    // Where the run started is the first fix in any lap: a watch still
    // acquiring through the whole first lap has not made the run indoor.
    const position = readings.find(
      (reading) => reading.position !== undefined,
    )?.position;

    // A loop, not `Math.max(...times)`: a long run at one point a second
    // is tens of thousands of arguments.
    const startMs = startedAtDate.getTime();
    const times = readings.flatMap((reading) => reading.times);
    let elapsedS = lapSeconds;
    for (const time of times) {
      elapsedS = Math.max(elapsedS, (time - startMs) / 1000);
    }

    const isIndoor = position === undefined;
    const altitudes = readings.flatMap((reading) => reading.altitudes);
    const parsed = runDraftSchema.safeParse({
      startedAt: Math.floor(startMs / 1000),
      // Rounded once, after summing: rounding each lap would drift by up
      // to half a second a lap.
      durationS: Math.round(elapsedS),
      distanceM,
      indoor: isIndoor,
      title: "Imported run",
      ...(position && { lat: position.lat, lng: position.lon }),
      ...fileMetrics(isIndoor, lapSeconds, elevationGainMeters(altitudes)),
    });
    if (!parsed.success)
      throw new RunParseError("tcx: assembled draft failed runDraftSchema", {
        cause: parsed.error,
      });
    return parsed.data;
  },
};
