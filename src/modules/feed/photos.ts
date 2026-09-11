/**
 * Entry photos in R2 (design doc "Photos"): ≤4/entry, jpeg/png/webp
 * ≤10MB, key convention `entries/{userId}/{entryId}/{photoId}` — copies
 * lane 101's convention, doesn't import it (that module doesn't exist on
 * this branch yet). Originals only for now; derived sizes follow 101's
 * photon-wasm benchmark rather than duplicating a wasm pipeline here.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { entryPhotos, outfitEntries } from "../../db/schema-core";
import { env } from "../../env";
import { firstColumnWhere } from "../../lib/keyed-read";
import { newUlid } from "../../lib/ids";
import { isAllowedPhotoType } from "../../lib/photo-constraints";
import type { z } from "zod";

import { uploadPhotoFields } from "./inputs";
import { requireOwned } from "../../lib/owned";

export const MAX_PHOTOS_PER_ENTRY = 4;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;


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
  idempotencyKey?: string | undefined;
}

export async function uploadPhoto(input: UploadPhotoInput): Promise<string> {
  if (!isAllowedPhotoType(input.contentType)) {
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
  requireOwned(entry, input.userId, {
    missing: "entry not found",
    forbidden: "cannot add photos to another user's entry",
  });

  // A repeat of a submission we already stored returns the key it made
  // (law 8b). Worth more here than on a plain row insert: without it a
  // double-submit costs an R2 put as well as a duplicate row, and burns
  // one of the four photo slots on the same image.
  //
  // Matched in SQL against the UNIQUE (entry_id, idempotency_key) index
  // rather than by scanning the rows fetched below — the index makes it a
  // seek, and an in-memory `.find` over a capped list is the habit that
  // breaks the moment the cap moves.
  if (input.idempotencyKey !== undefined) {
    const already = await firstColumnWhere(
      database,
      entryPhotos,
      entryPhotos.photoKey,
      and(
        eq(entryPhotos.entryId, input.entryId),
        eq(entryPhotos.idempotencyKey, input.idempotencyKey),
      ),
    );
    if (already !== undefined) return already;
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
    idempotencyKey: input.idempotencyKey,
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

/**
 * Pulls a photo upload out of a multipart body, refusing anything the
 * pipeline cannot store.
 *
 * The size is checked against the *declared* size, before the bytes are
 * read, so an oversized upload is refused without being allocated. All
 * three refusals are decisions, which is why they are here rather than in
 * the server function's validator (D-41).
 */
export function photoUploadFrom(
  input: unknown,
): z.infer<typeof uploadPhotoFields> & { file: File } {
  if (!(input instanceof FormData)) {
    throw new InvalidPhotoError("expected multipart form data");
  }
  const file = input.get("photo");
  if (!(file instanceof File)) {
    throw new InvalidPhotoError("no photo in upload");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new InvalidPhotoError("photo too large");
  }
  const fields = uploadPhotoFields.parse({
    entryId: input.get("entryId"),
    contentType: file.type,
    idempotencyKey: input.get("idempotencyKey") ?? undefined,
  });
  return { ...fields, file };
}

/**
 * The cached GET for an entry photo, as one function.
 *
 * It was the body of `routes/feed/photo.$.tsx` — three refusals and a set
 * of headers, in the one kind of file no test can import. The visibility
 * rule it enforces is the same one entry detail uses: a private entry's
 * photos are never fetchable by anyone but its owner, and a photo that is
 * not visible is *not found* rather than forbidden, because "403" tells a
 * stranger the photo exists.
 */
export async function photoResponse(
  key: string | undefined,
  viewerId: string | undefined,
): Promise<Response> {
  // Absent and blank in one check: the splat is `""` for `/feed/photo/`
  // itself, and neither is a photo. Written as one because an explicit
  // `=== ""` arm would be indistinguishable from letting it fall through
  // to the visibility check, which refuses it too — at the cost of a
  // query.
  if (!key) return notFound();
  if (!(await isPhotoVisible(key, viewerId))) return notFound();
  const object = await getPhotoObject(key);
  if (object === null) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Private: a photo is only ever visible to people the entry is shared
  // with, so a shared cache must not hold it.
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}

function notFound(): Response {
  return new Response("not found", { status: 404 });
}
