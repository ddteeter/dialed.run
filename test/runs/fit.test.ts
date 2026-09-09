import { Encoder, Utils } from "@garmin/fitsdk";
import type {
  ActivityMesg,
  Encodable,
  FileIdMesg,
  SessionMesg,
} from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";

import { fitSource, toDate } from "../../src/modules/runs/parsers/fit";
import {
  PARSE_FAILURE_MESSAGE,
  RunParseError,
} from "../../src/modules/runs/parsers/shared";

/**
 * The FIT decoder's refusals, and the one conversion nobody was checking.
 *
 * `parsers.test.ts` walks one good file each way and one that is not FIT
 * at all, which leaves forty-one mutants alive — including every failure
 * reason and the semicircle conversion, where a wrong constant puts a run
 * on the other side of the planet without failing anything.
 */

const MESG_NUM = { FILE_ID: 0, SESSION: 18, ACTIVITY: 34 } as const;
const START = new Date("2026-08-15T12:00:00Z");

/**
A FIT activity file with one session, built to order. `omit` leaves a
required session field out altogether — `exactOptionalPropertyTypes` means
a key set to `undefined` is not the same thing as an absent one, and the
SDK is being asked about the absent one.
*/
type OmittableSessionField =
  | "startTime"
  | "totalElapsedTime"
  | "totalDistance";

function fitFile(
  session: Partial<Encodable<SessionMesg>> = {},
  omit?: OmittableSessionField,
): ArrayBuffer {
  const encoder = new Encoder();
  const fileId: Encodable<FileIdMesg> = {
    mesgNum: MESG_NUM.FILE_ID,
    type: "activity",
    manufacturer: "garmin",
    product: 1,
    timeCreated: START,
  };
  encoder.writeMesg(fileId);
  encoder.writeMesg({
    mesgNum: MESG_NUM.SESSION,
    timestamp: START,
    ...(omit !== "startTime" && { startTime: START }),
    ...(omit !== "totalElapsedTime" && { totalElapsedTime: 1800 }),
    totalTimerTime: 1800,
    ...(omit !== "totalDistance" && { totalDistance: 5000 }),
    sport: "running",
    ...session,
  });
  const activity: Encodable<ActivityMesg> = {
    mesgNum: MESG_NUM.ACTIVITY,
    timestamp: START,
    numSessions: 1,
    type: "manual",
  };
  encoder.writeMesg(activity);
  return new Uint8Array(encoder.close()).buffer;
}

/**
A FIT file with no session message in it at all.
*/
function fitFileWithoutSession(): ArrayBuffer {
  const encoder = new Encoder();
  const fileId: Encodable<FileIdMesg> = {
    mesgNum: MESG_NUM.FILE_ID,
    type: "activity",
    manufacturer: "garmin",
    product: 1,
    timeCreated: START,
  };
  encoder.writeMesg(fileId);
  return new Uint8Array(encoder.close()).buffer;
}

async function failureFrom(bytes: ArrayBuffer): Promise<RunParseError> {
  try {
    await fitSource.parse(bytes);
  } catch (error) {
    if (error instanceof RunParseError) return error;
    throw error;
  }
  throw new Error("expected the parse to fail");
}

function failedToDate(value: unknown): RunParseError {
  try {
    toDate(value);
  } catch (error) {
    if (error instanceof RunParseError) return error;
    throw error;
  }
  throw new Error("expected toDate to refuse the value");
}

describe("fit: the position conversion", () => {
  it("reads semicircles as degrees", async () => {
    // FIT stores position as a signed 32-bit count of semicircles, so the
    // scale is 180 / 2^31. A wrong constant here does not fail anything —
    // it puts the run somewhere else on Earth.
    const draft = await fitSource.parse(
      fitFile({
        // 2^29 semicircles is 45°; 2^31 covers the whole 360.
        startPositionLat: 2 ** 29,
        startPositionLong: -(2 ** 30),
      }),
    );

    expect(draft.lat).toBeCloseTo(45, 6);
    expect(draft.lng).toBeCloseTo(-90, 6);
  });

  it("reads a position at the origin as a position", async () => {
    // Zero is a real coordinate, and `indoor` is decided by whether a
    // position was recorded at all — not by whether it is truthy.
    const draft = await fitSource.parse(
      fitFile({ startPositionLat: 0, startPositionLong: 0 }),
    );

    expect(draft.indoor).toBe(false);
    expect(draft.lat).toBe(0);
    expect(draft.lng).toBe(0);
  });

  it("treats half a position as no position", async () => {
    const draft = await fitSource.parse(
      fitFile({ startPositionLat: 2 ** 29 }),
    );

    expect(draft.indoor).toBe(true);
    expect(draft.lat).toBeUndefined();
  });
});

describe("fit: every way it refuses", () => {
  it("says when the bytes are not a FIT file", async () => {
    const notFit = new TextEncoder().encode("not a fit file").buffer;
    const failure = await failureFrom(notFit);

    expect(failure.message).toBe(PARSE_FAILURE_MESSAGE);
    expect(failure.reason).toContain("magic-byte check");
  });

  it("says when the file carries no session", async () => {
    const failure = await failureFrom(fitFileWithoutSession());
    expect(failure.reason).toContain("missing startTime/elapsed/distance");
  });

  it.each([
    ["no start time", "startTime"],
    ["no elapsed time", "totalElapsedTime"],
    ["no distance at all", "totalDistance"],
  ] as const)("says when the session has %s", async (_label, omitted) => {
    // Each field in the guard is checked separately: a session can arrive
    // with any one of the three missing, and none of the three alone makes
    // a run.
    const failure = await failureFrom(fitFile({}, omitted));
    expect(failure.reason).toContain("missing startTime/elapsed/distance");
  });

  it("says when the session has no distance to speak of", async () => {
    // Zero distance is not a run. The check is `<= 0`, because a device
    // that recorded nothing writes zero rather than omitting the field.
    const failure = await failureFrom(fitFile({ totalDistance: 0 }));
    expect(failure.reason).toContain("missing startTime/elapsed/distance");
  });

  it("refuses bytes it cannot even read", async () => {
    // A transferred ArrayBuffer is detached: the SDK's DataView
    // constructor throws on it before any FIT parsing happens.
    const detached = new ArrayBuffer(64);
    structuredClone(detached, { transfer: [detached] });

    const failure = await failureFrom(detached);

    expect(failure.reason).toContain("not a readable stream");
    expect(failure.cause).toBeInstanceOf(TypeError);
  });

  it("reports a file that decodes with errors", async () => {
    // A file that passes the magic-byte check and then does not decode:
    // the body is corrupted, the header is not. Either the decoder throws
    // or it reports errors, and both are refusals rather than a run.
    const corrupted = new Uint8Array(fitFile());
    for (let index = 14; index < corrupted.length - 2; index += 1) {
      corrupted[index] = 0xff;
    }

    const failure = await failureFrom(corrupted.buffer);

    expect(failure.reason).toMatch(/decoder/);
    expect(failure.cause).toBeDefined();
  });

  it("names the format in every reason", async () => {
    const notFit = new TextEncoder().encode("not a fit file").buffer;
    const failure = await failureFrom(notFit);
    expect(failure.reason.startsWith("fit:")).toBe(true);
  });
});

describe("fit: the timestamp shapes the SDK can hand back", () => {
  it("takes a Date as it is", () => {
    // The default: `convertDateTimesToDates` is on, so the SDK hands back
    // Dates and this is the identity.
    expect(toDate(START)).toBe(START);
  });

  it("converts a raw FIT-epoch number", () => {
    // The SDK returns numbers when date conversion is off, and the fields
    // are declared loosely enough that either shape can arrive. FIT's
    // epoch is 1989-12-31, so reading one as a Unix timestamp would be off
    // by twenty years.
    expect(toDate(0)).toStrictEqual(Utils.convertDateTimeToDate(0));
    expect(toDate(0).getUTCFullYear()).toBe(1989);
  });

  it("refuses a timestamp that is neither, and says so", () => {
    // The message is the user-facing copy either way; the diagnostic is on
    // `reason`, which is what a maintainer reads in Sentry.
    expect(() => toDate("2026-08-15T12:00:00Z")).toThrow(RunParseError);
    const thrown = failedToDate(undefined);
    expect(thrown.reason).toContain("neither Date nor number");
    expect(thrown.message).toBe(PARSE_FAILURE_MESSAGE);
  });

  it("reads the start time off the session", async () => {
    const draft = await fitSource.parse(fitFile());
    expect(draft.startedAt).toBe(Math.floor(START.getTime() / 1000));
  });
});

describe("fit: half a position is no position", () => {
  it.each([
    ["only a latitude", { startPositionLat: 2 ** 29 }],
    ["only a longitude", { startPositionLong: 2 ** 29 }],
  ])("treats a session with %s as indoor", async (_label, session) => {
    // Both halves are checked, because half a coordinate placed on the map
    // is a point in the Gulf of Guinea rather than a missing position.
    const draft = await fitSource.parse(fitFile(session));

    expect(draft.indoor).toBe(true);
    expect(draft.lat).toBeUndefined();
    expect(draft.lng).toBeUndefined();
  });
});

describe("fit: the contract has the last word", () => {
  it("refuses an assembled run the contract will not accept", async () => {
    // 100 degrees of latitude is a real semicircle value and not a real
    // place. Nothing in this file range-checks it; the schema does.
    const hundredDegrees = Math.round((100 / 180) * 2 ** 31);
    const failure = await failureFrom(
      fitFile({
        startPositionLat: hundredDegrees,
        startPositionLong: 0,
      }),
    );

    expect(failure.reason).toContain("runDraftSchema");
    expect(failure.cause).toBeDefined();
  });
});
