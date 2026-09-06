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
import { XMLParser } from "fast-xml-parser";

import { runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import {
  RunParseError,
  haversineMeters,
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

interface TrackPoint {
  lat: number;
  lon: number;
  time: Date;
}

function parseTrackPoint(node: unknown): TrackPoint | undefined {
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
  if (!isRecord(seg)) return [];
  const points: TrackPoint[] = [];
  for (const pt of toArray(seg.trkpt)) {
    const point = parseTrackPoint(pt);
    if (point !== undefined) points.push(point);
  }
  return points;
}

function pointsInTrack(trk: unknown): TrackPoint[] {
  if (!isRecord(trk)) return [];
  return toArray(trk.trkseg).flatMap((seg: unknown) => pointsInSegment(seg));
}

function extractTrackPoints(doc: unknown): TrackPoint[] {
  if (!isRecord(doc) || !isRecord(doc.gpx)) return [];
  return toArray(doc.gpx.trk).flatMap((trk: unknown) => pointsInTrack(trk));
}

function totalDistanceMeters(points: readonly TrackPoint[]): number {
  let distanceM = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
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

export const gpxSource: RunSource = {
  kind: "gpx",
  async parse(bytes: ArrayBuffer): Promise<RunDraft> {
    // fast-xml-parser is synchronous; the await keeps this a genuine
    // async fn matching the RunSource contract shared with FIT (which does
    // await internally) rather than a sync function wearing a Promise.
    await Promise.resolve();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new RunParseError();
    }

    let doc: unknown;
    try {
      doc = parser.parse(text);
    } catch {
      throw new RunParseError();
    }

    const points = extractTrackPoints(doc);
    if (points.length < 2) throw new RunParseError();

    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) throw new RunParseError();

    const durationS = Math.round(
      (last.time.getTime() - first.time.getTime()) / 1000,
    );
    const distanceM = totalDistanceMeters(points);
    if (durationS <= 0 || distanceM <= 0) throw new RunParseError();

    const parsed = runDraftSchema.safeParse({
      startedAt: Math.floor(first.time.getTime() / 1000),
      durationS,
      distanceM,
      lat: first.lat,
      lng: first.lon,
      indoor: false,
      title: "Imported run",
    });
    if (!parsed.success) throw new RunParseError();
    return parsed.data;
  },
};
