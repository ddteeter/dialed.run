/**
 * FIT parser (102 §3): `@garmin/fitsdk` is pure JS and Workers-compatible
 * (verified by test/runs/parsers.test.ts running it in the workers pool).
 * The session message carries duration/distance independent of GPS, so a
 * treadmill FIT file (no start position) naturally parses as `indoor` with
 * real duration/distance — no separate code path needed.
 */
import { Decoder, Stream, Utils } from "@garmin/fitsdk";

import { runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import { RunParseError } from "./shared";

// FIT positions are stored as semicircles (int32 covering ±180°).
const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31;

// The SDK's DateTime fields are declared loosely across message types and
// don't narrow to a single runtime shape at the type level, so this takes
// `unknown` and handles every shape decoder.read() can actually produce
// (Date by default; a raw FIT-epoch number with convertDateTimesToDates
// off) rather than fighting the declared union.
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return Utils.convertDateTimeToDate(value);
  throw new RunParseError("fit: timestamp field was neither Date nor number");
}

export const fitSource: RunSource = {
  kind: "fit",
  async parse(bytes: ArrayBuffer): Promise<RunDraft> {
    // The FIT SDK decodes synchronously; the await keeps this a genuine
    // async fn matching the RunSource contract shared with GPX/TCX.
    await Promise.resolve();
    let stream: Stream;
    try {
      stream = Stream.fromArrayBuffer(bytes);
    } catch (error) {
      throw new RunParseError("fit: bytes are not a readable stream", { cause: error });
    }
    if (!Decoder.isFIT(stream)) {
      throw new RunParseError("fit: stream failed the FIT magic-byte check");
    }

    const decoder = new Decoder(stream);
    let result: ReturnType<typeof decoder.read>;
    try {
      result = decoder.read();
    } catch (error) {
      throw new RunParseError("fit: decoder threw while reading", { cause: error });
    }
    const { messages, errors } = result;
    if (errors.length > 0) {
      throw new RunParseError(`fit: decoder reported ${String(errors.length)} error(s)`, { cause: errors[0] });
    }

    const session = messages.sessionMesgs?.[0];
    if (
      session?.startTime === undefined ||
      session.totalElapsedTime === undefined ||
      session.totalDistance === undefined ||
      session.totalDistance <= 0
    ) {
      throw new RunParseError("fit: session message missing startTime/elapsed/distance");
    }

    const { startPositionLat, startPositionLong } = session;
    const startPosition =
      typeof startPositionLat === "number" &&
      typeof startPositionLong === "number"
        ? {
            lat: startPositionLat * SEMICIRCLE_TO_DEGREES,
            lng: startPositionLong * SEMICIRCLE_TO_DEGREES,
          }
        : undefined;

    const parsed = runDraftSchema.safeParse({
      startedAt: Math.floor(toDate(session.startTime).getTime() / 1000),
      durationS: Math.round(session.totalElapsedTime),
      distanceM: session.totalDistance,
      indoor: startPosition === undefined,
      title: "Imported run",
      ...startPosition,
    });
    if (!parsed.success) {
      throw new RunParseError("fit: assembled draft failed runDraftSchema", { cause: parsed.error });
    }
    return parsed.data;
  },
};
