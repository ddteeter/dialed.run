/**
 * What a removal request's link names (design 136), when that takes more
 * than its path: a public photo's URL (`https://photos.dialed.run/<key>`,
 * design 160 step 8) names the photo its copy is of, which only
 * `public_photos` knows.
 *
 * **Resolved once, at filing, and recorded.** Holding the photo deletes
 * its copy and the row naming it, so the key names nothing by the time an
 * operator decides. Every later reading — the confirm, Review, the
 * decision, a Decline's give-back, block-and-decline — takes the link's
 * path first, as before, and otherwise the subject filing recorded on the
 * request. An unknown key names nothing, as an unknown path does.
 */
import { eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  publicPhotos,
  type takedownRequests,
} from "../../db/schema-core";
import {
  takedownSubjectOf,
  type TakedownSubject,
} from "../../lib/contracts/takedown";
import { publicPhotoKeyOf } from "../../lib/public-photos";
import { readInChunks } from "../../lib/chunked";
import { firstRowWhere } from "../../lib/sql/keyed-read";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

/**
 * What a link names as it is filed: one of the app's paths, else a public
 * copy's URL through the copy's row, else nothing.
 */
export async function filedSubjectOf(
  db: Db,
  location: string,
): Promise<TakedownSubject | undefined> {
  const fromPath = takedownSubjectOf(location);
  if (fromPath !== undefined) return fromPath;
  const key = publicPhotoKeyOf(location);
  return key === undefined ? undefined : copySubjectOf(db, key);
}

/**
The photo a public copy is of, by its key; nothing for a key no row names.
*/
async function copySubjectOf(
  db: Db,
  key: string,
): Promise<TakedownSubject | undefined> {
  const copy = await firstRowWhere(db, publicPhotos, eq(publicPhotos.key, key));
  return copy === undefined
    ? undefined
    : { subjectType: "photo", subjectId: copy.photoId, entryId: copy.entryId };
}

/**
What a filed request carries that names its subject.
*/
export type FiledRequest = Pick<
  typeof takedownRequests.$inferSelect,
  "location" | "subjectType" | "subjectId"
>;

/**
 * Each request's subject, in order: its link's path, else the photo filing
 * recorded (a public copy's URL is the only link resolved by more than its
 * path), with their kits read an `IN` list at a time. A recorded subject
 * that is no photo, or a photo gone since, names nothing.
 */
export async function requestSubjectsOf(
  db: Db,
  requests: readonly FiledRequest[],
): Promise<(TakedownSubject | undefined)[]> {
  const recorded = await photosNamed(
    db,
    requests.flatMap((request) => request.subjectId ?? []),
  );
  return requests.map(
    (request) =>
      takedownSubjectOf(request.location) ??
      recorded.find((photo) => photo.subjectId === request.subjectId),
  );
}

/**
The photos among these ids, each as a subject with its kit.
*/
async function photosNamed(
  db: Db,
  ids: readonly string[],
): Promise<TakedownSubject[]> {
  const rows = await readInChunks(ids, (chunk) =>
    db.select().from(entryPhotos).where(inArray(entryPhotos.id, chunk)),
  );
  return rows.map((row) => ({
    subjectType: "photo",
    subjectId: row.id,
    entryId: row.entryId,
  }));
}

/**
One request's subject, as `requestSubjectsOf` reads it.
*/
export async function requestSubjectOf(
  db: Db,
  request: FiledRequest,
): Promise<TakedownSubject | undefined> {
  const [subject] = await requestSubjectsOf(db, [request]);
  return subject;
}
