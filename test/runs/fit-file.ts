/**
 * FIT files built to order with the SDK's own encoder, for the parser's
 * tests and the import consumer's. Synthetic on purpose: no real watch's
 * file is ever committed (plan 152).
 */
import { Encoder } from "@garmin/fitsdk";
import type {
  ActivityMesg,
  Encodable,
  FileIdMesg,
  SessionMesg,
} from "@garmin/fitsdk";

const MESG_NUM = { FILE_ID: 0, SESSION: 18, ACTIVITY: 34 } as const;
export const START = new Date("2026-08-15T12:00:00Z");

/**
A FIT activity file with one session, built to order. `omit` leaves a
required session field out altogether — `exactOptionalPropertyTypes` means
a key set to `undefined` is not the same thing as an absent one, and the
SDK is being asked about the absent one.
*/
type OmittableSessionField = "startTime" | "totalElapsedTime" | "totalDistance";

export function fitFile(
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
export function fitFileWithoutSession(): ArrayBuffer {
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
