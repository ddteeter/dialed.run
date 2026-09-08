/**
 * Entry photos in R2 (design doc "Photos"): ≤4/entry, jpeg/png/webp
 * ≤10MB, key convention `entries/{userId}/{entryId}/{photoId}` — copies
 * lane 101's convention, doesn't import it (that module doesn't exist on
 * this branch yet). Originals only for now; derived sizes follow 101's
 * photon-wasm benchmark rather than duplicating a wasm pipeline here.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { entryPhotos, outfitEntries } from "../../db/schema-core";
import { env } from "../../env";
import { newUlid } from "../../lib/ids";
import { ForbiddenError, NotFoundError } from "./entries";

export const MAX_PHOTOS_PER_ENTRY = 4;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const allowedContentTypeSet: ReadonlySet<string> = new Set(ALLOWED_CONTENT_TYPES);

function db() {
  return drizzle(env.DIALED_CORE);
}

export function photoKeyFor(userId: string, entryId: string, photoId: string): string {
  return `entries/${userId}/${entryId}/${photoId}`;
}

export class InvalidPhotoError extends Error {}

export interface UploadPhotoInput {
  userId: string;
  entryId: string;
  contentType: string;
  bytes: ArrayBuffer;
}

export async function uploadPhoto(input: UploadPhotoInput): Promise<string> {
  if (!allowedContentTypeSet.has(input.contentType)) {
    throw new InvalidPhotoError("unsupported photo type");
  }
  if (input.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new InvalidPhotoError("photo too large");
  }

  const database = db();
  const [entry] = await database
    .select({ userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, input.entryId))
    .limit(1);
  if (!entry) throw new NotFoundError("entry not found");
  if (entry.userId !== input.userId) {
    throw new ForbiddenError("cannot add photos to another user's entry");
  }

  const existing = await database
    .select({ id: entryPhotos.id })
    .from(entryPhotos)
    .where(eq(entryPhotos.entryId, input.entryId));
  if (existing.length >= MAX_PHOTOS_PER_ENTRY) {
    throw new InvalidPhotoError(`at most ${String(MAX_PHOTOS_PER_ENTRY)} photos per entry`);
  }

  // R2 then the row, which cannot be atomic (law 8c). Deliberately left as
  // two writes: a failure between them is visible — the upload errors and
  // the user retries — and the only residue is an orphaned object under a
  // random key. Recorded as D-27 rather than swept, because MEDIA has no
  // expiry so orphans are permanent, but the failure needs D1 to fail
  // between two calls and the cost is storage, not correctness.
  const photoId = newUlid();
  const key = photoKeyFor(input.userId, input.entryId, photoId);
  await env.MEDIA.put(key, input.bytes, {
    httpMetadata: { contentType: input.contentType },
  });
  await database.insert(entryPhotos).values({
    id: photoId,
    entryId: input.entryId,
    photoKey: key,
    position: existing.length,
  });
  return key;
}

/**
 * Visibility check for the GET route: a photo is servable to `viewerId`
 * only if its entry is public or owned by the viewer — same rule as entry
 * detail (law: private entries never appear anywhere but the owner's own
 * views).
 */
export async function isPhotoVisible(
  photoKey: string,
  viewerId: string | undefined,
): Promise<boolean> {
  const database = db();
  const [photo] = await database
    .select({ entryId: entryPhotos.entryId })
    .from(entryPhotos)
    .where(eq(entryPhotos.photoKey, photoKey))
    .limit(1);
  if (!photo) return false;
  const [entry] = await database
    .select({ userId: outfitEntries.userId, isPublic: outfitEntries.isPublic })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, photo.entryId))
    .limit(1);
  if (!entry) return false;
  return entry.isPublic || entry.userId === viewerId;
}

export async function getPhotoObject(photoKey: string): Promise<R2ObjectBody | null> {
  return env.MEDIA.get(photoKey);
}
