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
  takedownRequests as requests,
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
  typeof requests.$inferSelect,
  "id" | "location"
>;

/**
 * Each request's subject, in order: its link's path, else the photo filing
 * recorded on it (a public copy's URL is the only link resolved by more
 * than its path), read with its kit by the requests' own ids, an `IN` list
 * at a time. A recorded subject that is no photo, or a photo gone since,
 * joins no row and names nothing.
 */
export async function requestSubjectsOf(
  db: Db,
  filed: readonly FiledRequest[],
): Promise<(TakedownSubject | undefined)[]> {
  const recorded = await recordedPhotos(
    db,
    filed.map((request) => request.id),
  );
  return filed.map(
    (request) =>
      takedownSubjectOf(request.location) ?? recorded.get(request.id),
  );
}

/**
The photo each of these requests recorded, with its kit, by request id.
*/
async function recordedPhotos(
  db: Db,
  requestIds: readonly string[],
): Promise<Map<string, TakedownSubject>> {
  const columns = {
    requestId: requests.id,
    photoId: entryPhotos.id,
    entryId: entryPhotos.entryId,
  };
  const rows = await readInChunks(requestIds, (chunk) =>
    db
      .select(columns)
      .from(requests)
      .innerJoin(entryPhotos, eq(entryPhotos.id, requests.subjectId))
      .where(inArray(requests.id, chunk)),
  );
  return new Map(
    rows.map((row) => [
      row.requestId,
      { subjectType: "photo", subjectId: row.photoId, entryId: row.entryId },
    ]),
  );
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
