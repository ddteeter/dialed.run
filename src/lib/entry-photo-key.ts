/**
 * Where an entry photo lives in R2: `entries/{userId}/{entryId}/{photoId}`.
 *
 * In `lib/` for the reason `garment-photo-key.ts` is: the upload path
 * (`modules/feed`) writes these keys and the outbox drainer
 * (`modules/ops`) reconciles them, and ops may not import feed — feed
 * already imports ops, so the other direction is a cycle. One spelling of
 * the convention, read by both.
 */

/**
The prefix every photo of one entry sits under — or, with no entry, every
entry photo a runner has.
*/
export function entryPhotoPrefix(userId: string, entryId?: string): string {
  return entryId === undefined
    ? `entries/${userId}/`
    : `entries/${userId}/${entryId}/`;
}

export function entryPhotoKeyFor(
  userId: string,
  entryId: string,
  photoId: string,
): string {
  return `${entryPhotoPrefix(userId, entryId)}${photoId}`;
}

/**
 * The photo's id, which the key carries last. `entry_photos` has no index
 * on `photo_key`, so a read that starts from a key finds the row by this
 * instead — a primary-key lookup rather than a scan.
 */
export function entryPhotoIdOf(photoKey: string): string {
  return photoKey.slice(photoKey.lastIndexOf("/") + 1);
}
