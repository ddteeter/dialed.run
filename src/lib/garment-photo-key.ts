/**
 * The garment's own prefix in R2. Every version of every photo the garment
 * has ever had sits under it, so it is the unit a cleanup works on.
 *
 * In lib because two modules build it and neither may import the other:
 * closet writes under it, and ops drains the outbox that clears it (closet
 * already imports ops, so the reverse would be a cycle).
 *
 * Built from the signed-in runner's own id, never from a stored row, so a
 * cleanup can only ever reach that runner's objects.
 */
export function photoKeyFor(userId: string, itemId: string): string {
  return `${garmentPhotoPrefix(userId)}${itemId}`;
}

/**
 * Every garment photo a runner has, under one prefix — what the data
 * export lists (task 126, ACC-10).
 */
export function garmentPhotoPrefix(userId: string): string {
  return `items/${userId}/`;
}

/**
 * The re-encoded original under one version of a garment's photo.
 *
 * `wardrobe_items.photo_key` names a VERSION — a prefix with the original
 * and every size beneath it — not an object, unlike `entry_photos.photo_key`.
 * Anything that reads the bytes the runner sent goes through this: the
 * upload writes here, the screening sweep reads here, and the data export
 * hands it over. The sweep once fetched the prefix itself, found nothing,
 * and left every garment photo whose first screening failed hidden for
 * good.
 */
export function garmentOriginalKey(versionKey: string): string {
  return `${versionKey}/original.jpg`;
}
