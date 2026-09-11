/**
 * GPX parser (102 §3), XXE-safe: `processEntities: false` disables
 * DOCTYPE/entity expansion entirely so a hostile upload can't smuggle an
 * external-entity or billion-laughs payload through the parser.
 *
 * GPX has no lap-level distance/duration total — every value is derived
 * from trackpoints — so unlike FIT/TCX there is no meaningful "no GPS
 * track" case here (a real treadmill export is GPX only if the device
 * fakes points, which we treat as malformed rather than guess at intent).
 */
import { runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import {
  RunParseError,
  parseXmlDocument,
  haversineMeters,
  isRecord,
  readDate,
  readNumber,
  toArray,
} from "./shared";

interface TrackPoint {
  lat: number;
  lon: number;
  time: Date;
}

function parseTrackPoint(node: unknown): TrackPoint | undefined {
  // Equivalent mutant on this guard alone: a non-record node has no
  // attributes to read, so every field below comes back undefined and the
  // point is dropped anyway. The guard is what narrows `unknown`.
  // Stryker disable next-line ConditionalExpression
  if (!isRecord(node)) return undefined;
  const lat = readNumber(node["@_lat"]);
  const lon = readNumber(node["@_lon"]);
  const time = readDate(node.time);
  if (lat === undefined || lon === undefined || time === undefined) {
    return undefined;
  }
  return { lat, lon, time };
}

function pointsInSegment(seg: unknown): TrackPoint[] {
  // Same shape as above: a non-record segment has no `trkpt` to read.
  // Stryker disable next-line ArrayDeclaration,ConditionalExpression
  if (!isRecord(seg)) return [];
  const points: TrackPoint[] = [];
  for (const pt of toArray(seg.trkpt)) {
    const point = parseTrackPoint(pt);
    if (point !== undefined) points.push(point);
  }
  return points;
}

function pointsInTrack(trk: unknown): TrackPoint[] {
  // Same shape again: a non-record track has no `trkseg` to read.
  // Stryker disable next-line ArrayDeclaration,ConditionalExpression
  if (!isRecord(trk)) return [];
  return toArray(trk.trkseg).flatMap((seg: unknown) => pointsInSegment(seg));
}

function extractTrackPoints(doc: unknown): TrackPoint[] {
  // Stryker disable next-line ArrayDeclaration
  if (!isRecord(doc) || !isRecord(doc.gpx)) return [];
  return toArray(doc.gpx.trk).flatMap((trk: unknown) => pointsInTrack(trk));
}

function totalDistanceMeters(points: readonly TrackPoint[]): number {
  let distanceM = 0;
  // The bound and the two undefined checks are the same fact said twice:
  // the loop only visits indexes that exist, so neither element can be
  // missing. They are here because `noUncheckedIndexedAccess` types every
  // array access as possibly absent.
  // Stryker disable next-line EqualityOperator
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    // Stryker disable next-line ConditionalExpression,LogicalOperator
    if (previous !== undefined && current !== undefined) {
      distanceM += haversineMeters(
        previous.lat,
        previous.lon,
        current.lat,
        current.lon,
      );
    }
  }
  return distanceM;
}

// fallow-ignore-next-line code-duplication -- the RunSource preamble both XML parsers share; what follows it -- track points versus laps -- is entirely different
export const gpxSource: RunSource = {
  kind: "gpx",
  async parse(bytes: ArrayBuffer): Promise<RunDraft> {
    // fast-xml-parser is synchronous; the await keeps this a genuine
    // async fn matching the RunSource contract shared with FIT (which does
    // await internally) rather than a sync function wearing a Promise.
    await Promise.resolve();
    const doc = parseXmlDocument(bytes, "gpx");

    const points = extractTrackPoints(doc);
    if (points.length < 2) throw new RunParseError("gpx: fewer than 2 track points with time");

    const first = points[0];
    const last = points.at(-1);
    // Unreachable: the length check above already refused anything under
    // two points. It is here because indexing an array is typed as
    // possibly absent, and the message names that impossibility.
    // Stryker disable next-line ConditionalExpression,LogicalOperator,StringLiteral,CallExpression
    if (first === undefined || last === undefined) throw new RunParseError("gpx: track point list was unexpectedly empty");

    const durationS = Math.round(
      (last.time.getTime() - first.time.getTime()) / 1000,
    );
    const distanceM = totalDistanceMeters(points);
    if (durationS <= 0 || distanceM <= 0) throw new RunParseError("gpx: non-positive duration or distance");

    const parsed = runDraftSchema.safeParse({
      startedAt: Math.floor(first.time.getTime() / 1000),
      durationS,
      distanceM,
      lat: first.lat,
      lng: first.lon,
      indoor: false,
      title: "Imported run",
    });
    if (!parsed.success) throw new RunParseError("gpx: assembled draft failed runDraftSchema", { cause: parsed.error });
    return parsed.data;
  },
};
