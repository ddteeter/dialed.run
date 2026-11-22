/**
 * FIT files built to order with the SDK's own encoder, for the parser's
 * tests and the import consumer's. Synthetic on purpose: no real watch's
 * file is ever committed (plan 160).
 */
import { CrcCalculator, Encoder } from "@garmin/fitsdk";
import type {
  ActivityMesg,
  DeveloperDataIdMesg,
  Encodable,
  FieldDescriptionMesg,
  FileIdMesg,
  SessionMesg,
} from "@garmin/fitsdk";

const MESG_NUM = {
  FILE_ID: 0,
  SESSION: 18,
  ACTIVITY: 34,
  FIELD_DESCRIPTION: 206,
  DEVELOPER_DATA_ID: 207,
} as const;
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

/**
A good activity file that registers `count` developer field descriptions
before its session, as a watch's data-field apps do (a handful each).
*/
export function fitFileWithFieldDescriptions(count: number): ArrayBuffer {
  const encoder = new Encoder();
  const fileId: Encodable<FileIdMesg> = {
    mesgNum: MESG_NUM.FILE_ID,
    type: "activity",
    manufacturer: "garmin",
    product: 1,
    timeCreated: START,
  };
  encoder.writeMesg(fileId);
  const developer: Encodable<DeveloperDataIdMesg> = {
    mesgNum: MESG_NUM.DEVELOPER_DATA_ID,
    developerDataIndex: 0,
    applicationVersion: 1,
  };
  encoder.writeMesg(developer);
  for (let index = 0; index < count; index += 1) {
    const description: Encodable<FieldDescriptionMesg> = {
      mesgNum: MESG_NUM.FIELD_DESCRIPTION,
      developerDataIndex: 0,
      fieldDefinitionNumber: index % 256,
      fitBaseTypeId: "uint8",
      fieldName: "Field",
    };
    encoder.writeMesg(description);
  }
  const session: Encodable<SessionMesg> = {
    mesgNum: MESG_NUM.SESSION,
    timestamp: START,
    startTime: START,
    totalElapsedTime: 1800,
    totalTimerTime: 1800,
    totalDistance: 5000,
    sport: "running",
  };
  encoder.writeMesg(session);
  return new Uint8Array(encoder.close()).buffer;
}

const FIT_EPOCH_S = 631_065_600;
const UINT8 = 0x02;
const UINT32 = 0x86;

/**
 * A FIT activity file around `body`, the bytes between the file header
 * and a session of thirty minutes and five kilometres: the session's
 * definition and data, the header and both CRCs are written here.
 */
function fitFileAround(body: Uint8Array): ArrayBuffer {
  const startS = Math.floor(START.getTime() / 1000) - FIT_EPOCH_S;
  // session (18), local type 3: start_time, total_elapsed_time,
  // total_timer_time, total_distance.
  const session = [
    0x43,
    0,
    0,
    18,
    0,
    4,
    2,
    4,
    UINT32,
    7,
    4,
    UINT32,
    8,
    4,
    UINT32,
    9,
    4,
    UINT32,
  ];
  const sessionData = new Uint8Array(1 + 16);
  sessionData[0] = 0x03;
  const sessionView = new DataView(sessionData.buffer);
  sessionView.setUint32(1, startS, true);
  sessionView.setUint32(5, 1800 * 1000, true);
  sessionView.setUint32(9, 1800 * 1000, true);
  sessionView.setUint32(13, 5000 * 100, true);

  const dataSize = body.length + session.length + sessionData.length;
  const out = new Uint8Array(14 + dataSize + 2);
  const view = new DataView(out.buffer);
  out.set([14, 0x20], 0);
  view.setUint16(2, 21_218, true);
  view.setUint32(4, dataSize, true);
  out.set([0x2e, 0x46, 0x49, 0x54], 8);
  view.setUint16(12, CrcCalculator.calculateCRC(out, 0, 12), true);
  out.set(body, 14);
  out.set(session, 14 + body.length);
  out.set(sessionData, 14 + body.length + session.length);
  const end = 14 + dataSize;
  view.setUint16(end, CrcCalculator.calculateCRC(out, 0, end), true);
  return out.buffer;
}

/**
 * A FIT activity file written byte by byte, for what the SDK's encoder
 * does not write: `descriptions` developer field descriptions, then
 * `messages` records that each carry `fields` one-byte developer fields,
 * then a session. A record costs the decoder a description lookup for each
 * of its developer fields. `type` is the records' global message number:
 * `record` (20) unless a test names another.
 */
export function fitFileOfDeveloperFields(shape: {
  descriptions: number;
  fields: number;
  messages: number;
  type?: number;
}): ArrayBuffer {
  const type = shape.type ?? 20;
  const head: number[] = [
    // developer_data_id (207), local type 0: developer_data_index.
    0x40,
    0,
    0,
    207,
    0,
    1,
    3,
    1,
    UINT8,
    0x00,
    0,
    // field_description (206), local type 1: index, number, base type.
    0x41,
    0,
    0,
    206,
    0,
    3,
    0,
    1,
    UINT8,
    1,
    1,
    UINT8,
    2,
    1,
    UINT8,
  ];
  for (let index = 0; index < shape.descriptions; index += 1) {
    head.push(0x01, 0, index % 256, UINT8);
  }
  // `type`, local type 2, developer data flagged: no fields of its own,
  // `fields` developer fields of one byte each.
  head.push(0x62, 0, 0, type & 0xff, type >> 8, 0, shape.fields);
  for (let index = 0; index < shape.fields; index += 1) head.push(index, 1, 0);

  const recordSize = 1 + shape.fields;
  const body = new Uint8Array(head.length + shape.messages * recordSize);
  body.set(head, 0);
  for (let index = 0; index < shape.messages; index += 1) {
    body[head.length + index * recordSize] = 0x02;
  }
  return fitFileAround(body);
}

/**
 * A FIT activity file whose definition of `type` (local type 2) declares
 * one field of its own of size zero, followed by one message under it,
 * which is its header byte alone.
 */
export function fitFileWithEmptyField(type: number): ArrayBuffer {
  return fitFileAround(
    new Uint8Array([0x42, 0, 0, type & 0xff, type >> 8, 1, 0, 0, UINT8, 0x02]),
  );
}
