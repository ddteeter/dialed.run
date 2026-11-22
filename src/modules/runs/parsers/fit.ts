/**
 * FIT parser (102 §3): `@garmin/fitsdk` is pure JS and Workers-compatible
 * (verified by test/runs/parsers.test.ts running it in the workers pool).
 * The session message carries duration/distance independent of GPS, so a
 * treadmill FIT file (no start position) naturally parses as `indoor` with
 * real duration/distance — no separate code path needed.
 */
import { Decoder, Profile, Stream, Utils } from "@garmin/fitsdk";
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

/**
 * The most the decoder may keep of a file, counted as it reads: each
 * message the profile names is kept with a value for each of its fields,
 * until the read ends. A message counts `FIT_MESSAGE_WEIGHT` and each
 * field one. A thirty-hour run recorded every second, with a watch's
 * usual fields, is about two million.
 */
export const MAX_FIT_KEPT_VALUES = 3_000_000;

/**
What one kept message counts towards `MAX_FIT_KEPT_VALUES`, before its fields.
*/
export const FIT_MESSAGE_WEIGHT = 4;

const FIELD_DESCRIPTION = 206;

/**
 * Whether the profile names a message type. The decoder reads a type it
 * does not name and keeps nothing of it, so such a message never reaches
 * `mesgListener`.
 */
function isProfileMessage(globalMessageNumber: number): boolean {
  return Object.hasOwn(Profile.messages, globalMessageNumber);
}

/**
 * The decoder's listeners that keep a file inside its budgets. A throw in
 * either lands in `read()`'s `errors`, which the parse turns into a
 * refusal. A definition may not declare a developer field of size zero,
 * so every developer field a message carries costs it at least a byte,
 * nor put developer fields on a type the profile does not name, since
 * only a named type's messages are counted.
 *
 * A message does not say which of its type's definitions it was written
 * under, so it is counted at the most fields and developer fields any
 * definition of its type has declared: the count errs towards refusing.
 */
export function fitReadLimits(
  lookupBudget = MAX_DEVELOPER_FIELD_LOOKUPS,
  keptBudget = MAX_FIT_KEPT_VALUES,
): {
  mesgListener: (mesgNum: number) => void;
  mesgDefinitionListener: (definition: MesgDefinition) => void;
} {
  let descriptions = 0;
  let lookups = 0;
  let kept = 0;
  const developerFieldsOf = new Map<number, number>();
  const fieldsOf = new Map<number, number>();
  const widest = (of: Map<number, number>, type: number, count: number) => {
    of.set(type, Math.max(of.get(type) ?? 0, count));
  };
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
      kept += FIT_MESSAGE_WEIGHT + (fieldsOf.get(mesgNum) ?? 0);
      if (kept > keptBudget) {
        throw new Error("fit: too many messages and fields");
      }
    },
    mesgDefinitionListener: (definition) => {
      const developerFields = definition.developerFieldDefinitions;
      if (developerFields.some((field) => field.size === 0)) {
        throw new Error("fit: a developer field of size zero");
      }
      const type = definition.globalMessageNumber;
      if (developerFields.length > 0 && !isProfileMessage(type)) {
        throw new Error("fit: developer fields on an unknown message type");
      }
      widest(developerFieldsOf, type, developerFields.length);
      widest(
        fieldsOf,
        type,
        definition.fieldDefinitions.length + developerFields.length,
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
