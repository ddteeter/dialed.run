/**
 * TCX parser (102 §3), XXE-safe and read as a stream (see gpx.ts and
 * `xml-events.ts`): only each lap's totals, first position and altitudes
 * are kept (design 246).
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
 * running through a pause: from the first lap's start to the latest lap
 * end — a lap's own `StartTime` plus its timer time — and never less than
 * the laps' sum. See `elapsedSeconds` for why trackpoint times are not
 * read for it.
 */
import { runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import {
  RunParseError,
  child,
  elevationGainMeters,
  fileMetrics,
  isRecord,
  present,
  readDate,
  readNumber,
  sum,
} from "./shared";
import { isAt, readXml } from "./xml-events";

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
  // The lap's own StartTime, in epoch milliseconds, where it is readable.
  startMs: number | undefined;
  // Every trackpoint's altitude, in order, where it has one.
  altitudes: number[];
}

/**
 * A lap as the file gave it, before its totals are judged.
 */
interface LapFound {
  // The lap's `StartTime` attribute.
  startTime: string | undefined;
  // Every `TotalTimeSeconds` and `DistanceMeters` directly under the lap.
  // One of each is a total; none, or more than one, is not.
  seconds: unknown[];
  metres: unknown[];
  // The first trackpoint position in the lap, and every altitude.
  position: Position | undefined;
  altitudes: number[];
}

const ACTIVITY = ["TrainingCenterDatabase", "Activities", "Activity"] as const;
const LAP = [...ACTIVITY, "Lap"] as const;
const LAP_SECONDS = [...LAP, "TotalTimeSeconds"] as const;
const LAP_METRES = [...LAP, "DistanceMeters"] as const;
const TRACKPOINT = [...LAP, "Track", "Trackpoint"] as const;

/**
 * The laps of the file's first activity, in order. Only the first
 * activity is read: v1 imports one run per file, and a multi-activity
 * export (a multisport session, say) is out of scope rather than summed.
 *
 * A lap's two totals and each of its trackpoints are built whole, read,
 * and let go; nothing else in the file is kept.
 */
function lapsIn(bytes: ArrayBuffer): LapFound[] {
  const laps: LapFound[] = [];
  let activities = 0;
  // The lap being read. A total's path and a trackpoint's run through
  // their lap's, so one is always open by the time either arrives.
  let lap: LapFound;
  readXml(bytes, "tcx", {
    open(path, attributes) {
      if (isAt(path, ACTIVITY)) activities += 1;
      if (activities !== 1) return false;
      if (isAt(path, LAP)) {
        lap = {
          startTime: attributes.StartTime,
          seconds: [],
          metres: [],
          position: undefined,
          altitudes: [],
        };
        laps.push(lap);
      }
      return (
        isAt(path, TRACKPOINT) ||
        isAt(path, LAP_SECONDS) ||
        isAt(path, LAP_METRES)
      );
    },
    value(path, node) {
      if (isAt(path, LAP_SECONDS)) lap.seconds.push(node);
      else if (isAt(path, LAP_METRES)) lap.metres.push(node);
      else {
        lap.position ??= positionOf(node);
        const altitude = readNumber(child(node, "AltitudeMeters"));
        lap.altitudes.push(...present(altitude));
      }
    },
  });
  return laps;
}

/**
 * The one value of a list, or nothing when it holds none or several.
 */
function only(values: readonly unknown[]): unknown {
  return values.length === 1 ? values[0] : undefined;
}

function readLap(lap: LapFound): LapReading {
  return {
    seconds: lapTotal(only(lap.seconds)),
    metres: lapTotal(only(lap.metres)),
    position: lap.position,
    startMs: readDate(lap.startTime)?.getTime(),
    altitudes: lap.altitudes,
  };
}

/**
 * Elapsed seconds from the run's start to the latest lap end, never less
 * than the laps' timer time. A lap ends at its own `StartTime` plus its
 * timer time; a lap whose start is unreadable adds no end of its own.
 *
 * Read off the laps, not the trackpoints. The latest trackpoint time was
 * the first answer, and one bad fix set the whole duration: a point dated
 * a year ahead (a GPS week rollover, a clock that never synced) made a
 * half-hour run 31,537,800 seconds long. A cap on how far a trackpoint may
 * reach would only move the problem — an hour's timezone slip is as
 * corrupt as a year's and sits under any cap a real pause also fits. Lap
 * starts are different in kind: one per lap, written by the watch's own
 * lap logic off the same clock as the timer, rather than one per GPS fix.
 *
 * A pause between laps is in it, because the next lap starts after it. A
 * pause inside the last lap is not — the lap's timer stopped for it — so a
 * single-lap file paused mid-run reads as its timer time. That under-reads
 * elapsed rather than inventing it, and it is the trade this makes.
 */
function elapsedSeconds(
  readings: readonly LapReading[],
  startMs: number,
  lapSeconds: number,
): number {
  let elapsedS = lapSeconds;
  for (const reading of readings) {
    if (reading.startMs === undefined) continue;
    const lapEndS = (reading.startMs - startMs) / 1000 + reading.seconds;
    elapsedS = Math.max(elapsedS, lapEndS);
  }
  return elapsedS;
}

export const tcxSource: RunSource = {
  kind: "tcx",
  async parse(bytes: ArrayBuffer): Promise<RunDraft> {
    // The reader is synchronous; see gpx.ts for why this stays async.
    await Promise.resolve();
    const laps = lapsIn(bytes);
    const firstLap = laps[0];
    if (firstLap === undefined) {
      throw new RunParseError("tcx: no Lap element found", {
        problem: "no-track",
      });
    }

    // Every refusal below names the lap, or the laps, it found wrong: the
    // reason is how a maintainer tells one bad file from another.
    const count = String(laps.length);
    const startedAtDate = readDate(firstLap.startTime);
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

    const startMs = startedAtDate.getTime();
    const elapsedS = elapsedSeconds(readings, startMs, lapSeconds);

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
