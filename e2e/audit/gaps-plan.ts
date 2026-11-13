/**
 * The rows for the states the dense seed does not reach (design 205):
 * blocked runners, a held photo with many near copies, takedown requests,
 * copyright holds and quarantined content.
 *
 * Pure: `gaps-db.ts` reads what the dense seed left in the database (its
 * shared photos, their owners' handles, Maya's runs) and passes it in,
 * then writes what comes back. Every id here starts `audit-g`, or hangs
 * off Maya or a blocked runner, so `cleanGaps` can find it.
 */

import type { weatherObservations } from "../../src/db/schema-weather";
import { DAY, HOUR, MAYA_ID } from "./dense-seed";
import { gaps, NOWHERE } from "./gaps-data";
import type { RowsOf, gapTables } from "./tables";

export {
  BLOCKED,
  EMPTY_HANDLE,
  EMPTY_ID,
  NOWHERE,
  ONBOARD_HANDLE,
  ONBOARD_ID,
} from "./gaps-data";

/**
A shared photo the dense seed left on another runner's entry.
*/
export interface PhotoOnFile {
  id: string;
  entryId: string;
  photoKey: string;
  ownerId: string;
}

export interface GapsInput {
  now: number;
  photos: readonly PhotoOnFile[];
  /**
  Handles by user id, for the takedown's "posted by".
  */
  usernames: ReadonlyMap<string, string>;
  /**
  Maya's runs and their weather status, as the dense seed left them.
  */
  mayaRuns: readonly { id: string; weatherStatus: string }[];
}

export interface GapSeed {
  failedRunId: string;
  pendingRunId: string;
  matchPhotoId: string;
  takedownEntryId: string;
}

export type GapsRows = RowsOf<typeof gapTables>;

/**
The dense seed's photo at `index`: missing means it was never seeded.
*/
export function photoAt(
  photos: readonly PhotoOnFile[],
  index: number,
): PhotoOnFile {
  const photo = photos[index];
  if (photo === undefined) {
    throw new Error("the dense seed is not in this database");
  }
  return photo;
}

/**
Blocked runners, a long handle among them.
*/
function blockedRows(now: number, rows: GapsRows): void {
  for (const [index, row] of gaps.blocked.entries()) {
    const joined = new Date((now - (40 + index) * DAY) * 1000);
    rows.user.push({
      id: row.id,
      name: row.handle,
      email: `${row.handle}@example.com`,
      emailVerified: true,
      createdAt: joined,
      updatedAt: joined,
    });
    rows.userProfiles.push({
      userId: row.id,
      username: row.handle,
      cityLabel: row.city,
      onboardingComplete: true,
      usernameScreen: "clear",
    });
    rows.blocks.push({
      blockerId: MAYA_ID,
      blockedId: row.id,
      createdAt: now - (1 + index * 9) * DAY,
    });
  }
}

/**
A held photo with more copies elsewhere than the match grid shows.
*/
function matchRows(input: GapsInput, rows: GapsRows): string {
  const { now, photos } = input;
  const heldPhoto = photoAt(photos, 0);
  const matchPhotoId = "audit-gph00";
  rows.entryPhotos.push({
    id: matchPhotoId,
    entryId: heldPhoto.entryId,
    photoKey: heldPhoto.photoKey,
    position: 6,
    fingerprint: gaps.match.fingerprint,
    screenStatus: "hidden_pending_review",
  });
  rows.reviewQueue.push({
    id: "audit-gq-match",
    subjectType: "photo",
    subjectId: matchPhotoId,
    source: "fingerprint",
    status: "pending",
    createdAt: now - 20 * 60,
    openedAt: now - 20 * 60,
  });
  // Near copies, a bit or two apart, on other runners' kits.
  const { near, copies } = gaps.match;
  for (let index = 0; index < copies; index += 1) {
    rows.entryPhotos.push({
      id: `audit-gm${String(index).padStart(2, "0")}`,
      entryId: photoAt(photos, 3 + index * 2).entryId,
      photoKey: heldPhoto.photoKey,
      position: 7,
      fingerprint: near[index % near.length],
      screenStatus: "pass",
    });
  }
  return matchPhotoId;
}

/**
Removal requests waiting: about a real photo, a stray link, a kit.
*/
function takedownRows(input: GapsInput, rows: GapsRows): string {
  const { now, photos } = input;
  const asked = photoAt(photos, 40);
  const kit = photoAt(photos, 44);
  const base = (n: number) => ({
    id: `audit-gtd${String(n)}`,
    status: "pending" as const,
    dueAt: now + (2 - n) * DAY,
    createdAt: now - n * 7 * HOUR,
    idempotencyKey: `audit-gtd${String(n)}`,
    requesterKey: `audit-gkey${String(n)}`,
  });
  const {
    held: heldAsk,
    confirm: confirmAsk,
    valve: valveAsk,
  } = gaps.takedowns;
  rows.takedownRequests.push(
    {
      ...base(1),
      ...heldAsk,
      location: `${gaps.origin}/kit/${asked.entryId}`,
      subjectType: "photo",
      subjectId: asked.id,
      holdState: "held",
      heldAt: now - 6 * HOUR,
      confirmedAt: now - 6 * HOUR,
      posterUsername: input.usernames.get(asked.ownerId),
    },
    { ...base(2), ...confirmAsk, holdState: "confirm" },
    {
      ...base(3),
      ...valveAsk,
      location: `${gaps.origin}/kit/${kit.entryId}`,
      subjectType: "entry",
      subjectId: kit.entryId,
      holdState: "valve",
      confirmedAt: now - 20 * HOUR,
    },
  );
  return asked.entryId;
}

/**
Copyright holds, at three points of the thirty days.
*/
function holdRows(input: GapsInput, rows: GapsRows): void {
  const { now, photos } = input;
  const { operator } = gaps;
  const stages = [
    {},
    {
      counterNoticeAt: now - 3 * DAY,
      counterNoticeBy: operator,
      restoreAt: now + 11 * DAY,
    },
    {
      counterNoticeAt: now - 9 * DAY,
      counterNoticeBy: operator,
      restoreAt: now + 5 * DAY,
      courtActionAt: now - 2 * DAY,
      courtActionBy: operator,
    },
  ];
  for (const [n, stage] of stages.entries()) {
    const subject = photoAt(photos, 50 + n);
    const hiddenAt = now - (2 + n * 5) * DAY;
    const actionId = `audit-ghold${String(n)}`;
    const subjectId = `audit-gheld${String(n)}`;
    rows.moderationActions.push({
      id: actionId,
      actorId: operator,
      action: "takedown",
      subjectType: "photo",
      subjectId,
      subjectOwnerId: subject.ownerId,
      reason: gaps.holdReason,
      createdAt: hiddenAt,
    });
    rows.copyrightHolds.push({
      id: `audit-gch${String(n)}`,
      moderationActionId: actionId,
      subjectType: "photo",
      subjectId,
      ownerId: subject.ownerId,
      entryId: subject.entryId,
      status: "hidden",
      hiddenAt,
      purgeAt: now + (28 - n * 5) * DAY,
      ...stage,
    });
  }
}

/**
Quarantined content: one reported to NCMEC, one not yet.
*/
function quarantineRows(now: number, rows: GapsRows): void {
  const base = (n: number) => ({
    id: `audit-gqc${String(n)}`,
    moderationActionId: `audit-gqact${String(n)}`,
    subjectId: `audit-gqsub${String(n)}`,
    uploaderId: `audit-b0${String(n + 1)}`,
    entryId: `audit-gqent${String(n)}`,
    entrySnapshot: "{}",
    photosSnapshot: "[]",
    quarantinedAt: now - (1 + n * 4) * DAY,
  });
  rows.quarantinedContent.push(
    { ...base(0), subjectType: "entry", retainUntil: now + 365 * DAY },
    {
      ...base(1),
      subjectType: "photo",
      retainUntil: now + 361 * DAY,
      ncmecReportedAt: now - 4 * DAY,
      ncmecReportId: gaps.ncmecReportId,
    },
  );
}

/**
The id of Maya's first run in `status`, or "" when there is none.
*/
export function runIn(runs: GapsInput["mayaRuns"], status: string): string {
  return runs.find((run) => run.weatherStatus === status)?.id ?? "";
}

/**
Every row the gaps seed writes, from what the dense seed left.
*/
export function planGaps(input: GapsInput): { rows: GapsRows; seed: GapSeed } {
  const rows: GapsRows = {
    user: [],
    userProfiles: [],
    blocks: [],
    entryPhotos: [],
    reviewQueue: [],
    takedownRequests: [],
    moderationActions: [],
    copyrightHolds: [],
    quarantinedContent: [],
  };
  blockedRows(input.now, rows);
  const matchPhotoId = matchRows(input, rows);
  const takedownEntryId = takedownRows(input, rows);
  holdRows(input, rows);
  quarantineRows(input.now, rows);
  return {
    rows,
    seed: {
      failedRunId: runIn(input.mayaRuns, "failed"),
      pendingRunId: runIn(input.mayaRuns, "pending"),
      matchPhotoId,
      takedownEntryId,
    },
  };
}

/**
Readings at the brand-new runner's place, an hour either side of now.
*/
export function nowhereObservations(
  now: number,
  feelsLikeC: number,
): (typeof weatherObservations.$inferInsert)[] {
  return [-1, 0, 1, 2].map((hour) => ({
    id: `audit-gobs${String(hour + 1)}`,
    latR: NOWHERE.lat,
    lngR: NOWHERE.lng,
    hourBucket: Math.floor(now / HOUR) + hour,
    tempC: feelsLikeC + 1,
    feelsLikeC,
    humidity: 60,
    windKph: 10,
    precipMm: 0,
    condition: "clear",
    source: "visualcrossing",
    fetchedAt: now,
  }));
}
