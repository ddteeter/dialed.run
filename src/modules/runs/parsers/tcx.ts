/**
 * TCX parser (102 §3), XXE-safe (`processEntities: false`, see gpx.ts).
 * Unlike GPX, TCX carries lap-level `TotalTimeSeconds`/`DistanceMeters`
 * independent of GPS fix — a treadmill export naturally has laps with no
 * `<Position>` on any trackpoint, which is exactly the "no GPS track"
 * signal the packet asks for (imports as `indoor` with real duration and
 * distance from the lap totals, no separate code path).
 */
import { XMLParser } from "fast-xml-parser";

import { runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import {
  RunParseError,
  isRecord,
  readDate,
  readNumber,
  toArray,
} from "./shared";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
});

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
  if (!isRecord(doc)) return undefined;
  const root = doc.TrainingCenterDatabase;
  if (!isRecord(root)) return undefined;
  const activities = root.Activities;
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
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new RunParseError("tcx: bytes are not valid UTF-8", { cause: error });
    }

    let doc: unknown;
    try {
      doc = parser.parse(text);
    } catch (error) {
      throw new RunParseError("tcx: XML parser threw", { cause: error });
    }

    const lap = findLap(doc);
    if (lap === undefined) throw new RunParseError("tcx: no Lap element found");

    const startedAtDate = readDate(lap["@_StartTime"]);
    const durationS = readNumber(lap.TotalTimeSeconds);
    const distanceM = readNumber(lap.DistanceMeters);
    const hasRequiredTotals =
      startedAtDate !== undefined &&
      durationS !== undefined &&
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
