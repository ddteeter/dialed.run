/**
 * FIT parser (102 §3): `@garmin/fitsdk` is pure JS and Workers-compatible
 * (verified by test/runs/parsers.test.ts running it in the workers pool).
 * The session message carries duration/distance independent of GPS, so a
 * treadmill FIT file (no start position) naturally parses as `indoor` with
 * real duration/distance — no separate code path needed.
 */
import { Decoder, Stream, Utils } from "@garmin/fitsdk";
import type { MesgDefinition } from "@garmin/fitsdk";

import { rpeSchema, runDraftSchema } from "../../../lib/contracts";
import type { RunDraft, RunSource } from "../../../lib/contracts";
import { RunParseError, fileMetrics } from "./shared";

// FIT positions are stored as semicircles (int32 covering ±180°).
const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31;

// The SDK's DateTime fields are declared loosely across message types and
// don't narrow to a single runtime shape at the type level, so this takes
// `unknown` and handles every shape decoder.read() can actually produce
// (Date by default; a raw FIT-epoch number with convertDateTimesToDates
// off) rather than fighting the declared union.
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return Utils.convertDateTimeToDate(value);
  throw new RunParseError("fit: timestamp field was neither Date nor number");
}

/**
The runner's own perceived-effort rating, 1–10, from the session's
`workout_rpe`, which the watch stores ×10 (plan 160). A watch that did not
ask leaves the field out; a value off the scale is dropped rather than
failing a file that is otherwise a good run.
*/
export function rpeFrom(workoutRpe: unknown): number | undefined {
  if (typeof workoutRpe !== "number") return undefined;
  const rating = rpeSchema.safeParse(Math.round(workoutRpe / 10));
  return rating.success ? rating.data : undefined;
}

/**
 * The most developer field descriptions a FIT file may register (SA-M29).
 * A watch's own file registers a handful, one per app data field; each
 * one is searched for every developer field of every message after it.
 */
export const MAX_FIELD_DESCRIPTIONS = 256;

/**
 * The most description lookups a file's developer fields may cost
 * (SA-L23). The decoder looks each developer field of each message up
 * among the descriptions registered so far, so a file's cost is its
 * messages times their developer fields times its descriptions, and no
 * one of the three bounds the product. A watch's file with a few apps'
 * fields on every record of a days-long run stays several times under.
 */
export const MAX_DEVELOPER_FIELD_LOOKUPS = 500_000_000;

const FIELD_DESCRIPTION = 206;

/**
 * The decoder's listeners that keep a file inside its budgets. A throw in
 * either lands in `read()`'s `errors`, which the parse turns into a
 * refusal. A definition may not declare a developer field of size zero,
 * so every developer field a message carries costs it at least a byte.
 *
 * A message does not say which of its type's definitions it was written
 * under, so it is counted at the most developer fields any definition of
 * its type has declared: the count errs towards refusing.
 */
export function fitReadLimits(lookupBudget = MAX_DEVELOPER_FIELD_LOOKUPS): {
  mesgListener: (mesgNum: number) => void;
  mesgDefinitionListener: (definition: MesgDefinition) => void;
} {
  let descriptions = 0;
  let lookups = 0;
  const developerFieldsOf = new Map<number, number>();
  return {
    mesgListener: (mesgNum) => {
      if (mesgNum === FIELD_DESCRIPTION) {
        descriptions += 1;
        if (descriptions > MAX_FIELD_DESCRIPTIONS) {
          throw new Error("fit: too many field descriptions");
        }
      }
      lookups += (developerFieldsOf.get(mesgNum) ?? 0) * descriptions;
      if (lookups > lookupBudget) {
        throw new Error("fit: too many developer field lookups");
      }
    },
    mesgDefinitionListener: (definition) => {
      const fields = definition.developerFieldDefinitions;
      if (fields.some((field) => field.size === 0)) {
        throw new Error("fit: a developer field of size zero");
      }
      const type = definition.globalMessageNumber;
      developerFieldsOf.set(
        type,
        Math.max(developerFieldsOf.get(type) ?? 0, fields.length),
      );
    },
  };
}

/**
 * What the decoder is asked to leave undone (SA-L23). The parser reads the
 * session's own numbers and nothing else, so the conversions the decoder
 * would make on every message of the file (sub-fields and components
 * expanded, types named, timestamps made into `Date`s, heart rates merged
 * into records) are work and memory nothing reads. `toDate` takes the raw
 * timestamp this leaves. Exported so a test pins it: a parse of an
 * ordinary file cannot show an option's effect.
 */
export const FIT_READ_OPTIONS = {
  expandSubFields: false,
  expandComponents: false,
  convertTypesToStrings: false,
  convertDateTimesToDates: false,
  mergeHeartRates: false,
} as const;

export const fitSource: RunSource = {
  kind: "fit",
  async parse(bytes: ArrayBuffer): Promise<RunDraft> {
    // The FIT SDK decodes synchronously; the await keeps this a genuine
    // async fn matching the RunSource contract shared with GPX/TCX.
    await Promise.resolve();
    // A detached buffer — one already transferred elsewhere — makes the
    // SDK's DataView constructor throw before any FIT parsing happens, so
    // this is a real refusal and not a defensive shell.
    let stream: Stream;
    try {
      stream = Stream.fromArrayBuffer(bytes);
    } catch (error) {
      throw new RunParseError("fit: bytes are not a readable stream", {
        cause: error,
      });
    }
    if (!Decoder.isFIT(stream)) {
      throw new RunParseError("fit: stream failed the FIT magic-byte check");
    }

    // `read()` cannot throw: the SDK wraps its whole body in a try/catch
    // that pushes to `errors` and returns from a `finally`, which swallows
    // even a rethrow (decoder.js ~L167-201). Every decode problem arrives
    // as an entry in `errors`, so that is the only branch to handle — a
    // try/catch here would be a guard against something structurally
    // impossible, and a mutant in it could never be killed.
    const { messages, errors } = new Decoder(stream).read({
      ...FIT_READ_OPTIONS,
      ...fitReadLimits(),
    });
    if (errors.length > 0) {
      throw new RunParseError(
        `fit: decoder reported ${String(errors.length)} error(s)`,
        { cause: errors[0] },
      );
    }

    const session = messages.sessionMesgs?.[0];
    if (
      session?.startTime === undefined ||
      session.totalElapsedTime === undefined ||
      session.totalDistance === undefined ||
      session.totalDistance <= 0
    ) {
      throw new RunParseError(
        "fit: session message missing startTime/elapsed/distance",
        { problem: "no-track" },
      );
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

    const isIndoor = startPosition === undefined;
    const parsed = runDraftSchema.safeParse({
      startedAt: Math.floor(toDate(session.startTime).getTime() / 1000),
      // Elapsed: it keeps running through a pause (D-111).
      durationS: Math.round(session.totalElapsedTime),
      distanceM: session.totalDistance,
      indoor: isIndoor,
      title: "Imported run",
      rpe: rpeFrom(session.workoutRpe),
      ...startPosition,
      // The watch's own moving time where it writes a real one; otherwise
      // its timer time, which stops when the runner pauses it. A zero or
      // negative moving time is a field the watch wrote and did not fill,
      // not a run without moving. The climb is the watch's own total,
      // barometric on most that write it.
      ...fileMetrics(
        isIndoor,
        (session.totalMovingTime ?? 0) > 0
          ? session.totalMovingTime
          : session.totalTimerTime,
        session.totalAscent,
      ),
    });
    if (!parsed.success) {
      throw new RunParseError("fit: assembled draft failed runDraftSchema", {
        cause: parsed.error,
      });
    }
    return parsed.data;
  },
};
