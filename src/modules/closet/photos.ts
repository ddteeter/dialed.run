/**
 * Photo pipeline (packet §5): validate → original to R2 → 3 derived webp
 * sizes via photon-wasm. Requirement 8 (degrade, don't fail): the item row
 * is created/updated by ./service *before* a photo is ever attached, so a
 * decode/resize/R2 failure here never touches it — the caller (functions.ts)
 * catches and reports a photo-specific error; the form offers a retry that
 * re-calls this same function. `photoKey` is written to the item only after
 * every derived size has landed in R2, so a partial failure never leaves a
 * dangling reference the GET route can't serve.
 */
import { and, isNotNull, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { newUlid, ulidSchema } from "../../lib/ids";
import { isAllowedPhotoType, maxPhotoBytes } from "../../lib/photo-constraints";
import { env } from "../../env";
import { fitWithin, withReleased } from "../../lib/photo-pipeline";
import { photoKeyFor } from "../../lib/garment-photo-key";
import { ownedBy } from "../../lib/owned";
import { getOwnedItem } from "./service";
import {
  captureException,
  oweOutbox,
  outboxInsert,
  settleOutbox,
} from "../ops";
import { classifierFromEnv, screenPhoto, type Classify } from "../safety";

type Db = ReturnType<typeof drizzle>;

export const photoSizes = ["thumb", "card", "full"] as const;
export type PhotoSize = (typeof photoSizes)[number];

const SIZE_TARGETS: Record<PhotoSize, number> = {
  thumb: 200,
  card: 600,
  full: 1600,
};

export function isPhotoSize(value: string): value is PhotoSize {
  const sizes: readonly string[] = photoSizes;
  return sizes.includes(value);
}

export class PhotoValidationError extends Error {}

/**
 * Exhaustive over AllowedPhotoType, so adding a type to lib is a compile
 * error here rather than a runtime throw on the first upload of it.
 */
export function extensionFor(contentType: string): string {
  if (!isAllowedPhotoType(contentType)) {
    throw new PhotoValidationError("Photo must be JPEG, PNG, or WEBP.");
  }
  switch (contentType) {
    case "image/jpeg": {
      return "jpg";
    }
    case "image/png": {
      return "png";
    }
    case "image/webp": {
      return "webp";
    }
  }
}

export function validatePhoto(contentType: string, byteLength: number): void {
  if (!isAllowedPhotoType(contentType)) {
    throw new PhotoValidationError("Photo must be JPEG, PNG, or WEBP.");
  }
  if (byteLength === 0) {
    throw new PhotoValidationError("Photo file is empty.");
  }
  if (byteLength > maxPhotoBytes) {
    throw new PhotoValidationError("Photo must be 10 MB or smaller.");
  }
}

export interface PhotoUploadResult {
  photoKey: string;
}

export async function uploadItemPhoto(
  db: Db,
  userId: string,
  itemId: string,
  bytes: Uint8Array,
  contentType: string,
  /**
  Injectable so a test can make the upstream fail on demand.
  */
  classify?: Classify,
  /**
  Where a failed cleanup of the replaced photo is reported. Injectable for
  the same reason as `classify`.
  */
  report: typeof captureException = captureException,
): Promise<PhotoUploadResult> {
  validatePhoto(contentType, bytes.byteLength);
  await getOwnedItem(db, userId, itemId);

  // Lazily imported on purpose: this package ships a WASM module, and a
  // static import instantiates it during worker startup — a cost paid by
  // every request, including the ones that never touch a photo, and
  // charged against the separate startup CPU limit. Deferring it means the
  // module compiles once per isolate, on a request that was always slow.
  const { PhotonImage, SamplingFilter, resize } =
    await import("@cf-wasm/photon/workerd");
  // A new version under the item's prefix for every upload. The URL a
  // photo is served from carries the version (`photoUrlFor`), and the GET
  // route caches it as immutable — so a replaced photo must live at a new
  // address, or every browser that saw the old one keeps showing it.
  const keyPrefix = `${photoKeyFor(userId, itemId)}/${newUlid()}`;
  const ext = extensionFor(contentType);

  // Original first (requirement 8): even if decode/resize below throws, the
  // source bytes are already durable in R2.
  await env.MEDIA.put(`${keyPrefix}/original.${ext}`, bytes, {
    httpMetadata: { contentType },
  });

  await withReleased(PhotonImage.new_from_byteslice(bytes), async (input) => {
    const width = input.get_width();
    const height = input.get_height();
    for (const size of photoSizes) {
      const dims = fitWithin(width, height, SIZE_TARGETS[size]);
      await withReleased(
        resize(input, dims.width, dims.height, SamplingFilter.Lanczos3),
        async (resized) => {
          await env.MEDIA.put(
            `${keyPrefix}/${size}.webp`,
            resized.get_bytes_webp(),
            {
              httpMetadata: { contentType: "image/webp" },
            },
          );
        },
      );
    }
  });

  // The replaced photo leaves storage — it may be the unblurred frame the
  // runner replaced it to get rid of, under whichever original extension
  // it arrived with. The debt is written with the new key, in one batch
  // (law 8c), so it is owed from the moment the row stops naming the old
  // version; the fast path then clears every object the row no longer
  // names. A failed fast path never fails the upload (law 5) — the photo
  // the runner asked for is saved — and the outbox drainer finishes it.
  const debt = oweOutbox({ kind: "photo_delete", payload: { userId, itemId } });
  const pointAtNewVersion = db
    .update(wardrobeItems)
    // `visibility: "pending"` in the same write as the key. A garment with
    // a photo and no screening state would read as `ok` — the pre-106
    // default meaning "never screened" — and slip into public view
    // unclassified. Setting it here rather than in the column default is
    // deliberate: most wardrobe rows have no photo at all and should stay
    // `ok` rather than queue for a sweep that has nothing to fetch.
    .set({ photoKey: keyPrefix, visibility: "pending" })
    .where(ownedBy(wardrobeItems, { id: itemId, userId }));
  await db.batch([pointAtNewVersion, outboxInsert(db, debt)]);
  await settleOutbox(db, debt, report);

  // Same shape as the entry path: bounded, never throws, and a failure
  // leaves the row `pending` for the screening-retry cron. The ORIGINAL
  // bytes are classified rather than a derived size — a resize is our
  // artefact, and screening something the runner never uploaded would
  // make a verdict hard to explain.
  await screenPhoto(
    { scope: "garment", photoId: itemId, bytes, contentType },
    classify ?? classifierFromEnv(),
  );

  return { photoKey: keyPrefix };
}

/**
 * Remove photo (round 22, the well's Remove): the garment goes back to
 * having no photo, and its bytes leave storage.
 *
 * **D1 first, with the debt in the same batch** (law 8c — R2 and D1 cannot
 * be one transaction, so the outbox makes the pair eventually true). The
 * row stops naming the photo and an `outbox` row records that its bytes
 * are owed a delete; they commit together or not at all. The fast path
 * then clears the item's prefix and settles the row. If R2 fails, the
 * runner's Remove has still succeeded — the photo is gone from every
 * screen — and the daily drainer deletes the bytes (possibly a face) and
 * reports if it cannot (law 6). Nothing depends on the runner retrying.
 *
 * The other order — R2, then D1 — would leave a row naming objects that
 * are gone, a broken image on the runner's own screen, with nothing to
 * finish it.
 *
 * `visibility` goes back to `ok` in the same statement, because that is
 * what a garment with no photo wears (`uploadItemPhoto` sets `pending`
 * only alongside a key) — leaving `pending` would queue a photo that no
 * longer exists for the screening sweep, and leaving a hidden state would
 * hide nothing. Only a row that still names a photo is touched, so a
 * repeated Remove leaves a no-photo row's visibility alone.
 */
export async function removeItemPhoto(
  db: Db,
  userId: string,
  itemId: string,
  report: typeof captureException = captureException,
): Promise<void> {
  await getOwnedItem(db, userId, itemId);
  const debt = oweOutbox({ kind: "photo_delete", payload: { userId, itemId } });
  const stillNamesAPhoto = and(
    ownedBy(wardrobeItems, { id: itemId, userId }),
    isNotNull(wardrobeItems.photoKey),
  );
  const clearPhoto = db
    .update(wardrobeItems)
    // `sql\`NULL\`` rather than the literal — see lib/sql-null.
    .set({ photoKey: sql`NULL`, visibility: "ok" })
    .where(stillNamesAPhoto);
  await db.batch([clearPhoto, outboxInsert(db, debt)]);
  await settleOutbox(db, debt, report);
}

/**
 * A photo upload's outcome, kept apart from the item save.
 *
 * Requirement 8 (degrade, don't fail): the item row is already written by
 * the time a photo is attached, so a decode/resize/R2 failure is reported
 * as its own result rather than as a form-wide error — the form offers a
 * photo-specific retry and the item stays intact.
 */
export type UploadPhotoResult =
  { ok: true; result: PhotoUploadResult } | { ok: false; error: string };

/**
 * The multipart upload path: pull the item and the file out of the form,
 * and turn any failure into a reportable result.
 *
 * In this file rather than in `functions.ts` because every line of it is a
 * decision — is there a file, did validation pass, what does the runner
 * get told when it did not — and `functions.ts` cannot be imported by a
 * test (D-41).
 */
export async function uploadPhotoFromForm(
  db: Db,
  userId: string,
  form: FormData,
): Promise<UploadPhotoResult> {
  const itemId = ulidSchema.parse(form.get("itemId"));
  const photo = form.get("photo");
  if (!(photo instanceof File)) {
    return { ok: false, error: "No photo file provided." };
  }
  try {
    // Equivalent mutant, and the guard stays: `uploadItemPhoto` validates
    // the same rules and raises the same sentences, so removing this
    // changes no answer. What it changes is when — this runs against the
    // *declared* size, before `arrayBuffer()` buffers the whole file into
    // the isolate. An oversized upload is refused without being read.
    // Stryker disable next-line CallExpression
    validatePhoto(photo.type, photo.size);
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const result = await uploadItemPhoto(db, userId, itemId, bytes, photo.type);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: reasonFrom(error) };
  }
}

/**
 * A sentence to show the runner, from whatever reached the `catch`.
 *
 * Its own function so both halves can be asserted: everything this file
 * throws is a `PhotoValidationError` and says what to do about it, but a
 * `catch` catches anything, and an upload that failed with no reason at
 * all is the one message nobody can act on.
 */
export function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Photo upload failed.";
}

/**
 * Owner-scoped fetch for the cached GET route. Returns undefined (route
 * answers 404) rather than throwing when there's simply no photo yet.
 */
/**
 * R2's `onlyIf` rejects a quoted etag outright — but `httpEtag` is quoted,
 * and so is every browser's If-None-Match, so passing one straight through
 * throws on exactly the requests this optimisation exists for. Strips the
 * quotes and the weak-comparison prefix, and gives up on the multi-etag
 * form (`a, b`) rather than guessing, since R2 takes a single value.
 */
export function unquoteEtag(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim().replace(/^W\//, "");
  // No empty check here: an empty value falls through to the one at the
  // bottom, which has to exist anyway for `""`. Mutation testing found the
  // first one unkillable, which is what a redundant condition looks like.
  if (trimmed === "*" || trimmed.includes(",")) return undefined;
  const unquoted = trimmed.replaceAll(/^"|"$/g, "");
  return unquoted === "" ? undefined : unquoted;
}

/**
 * The stored object, or a bodyless hit when the caller already has this
 * exact version.
 *
 * `onlyIf` hands the conditional request to R2 itself: on an etag match it
 * returns metadata with no `body`, so the bytes are never read out of
 * storage or streamed back. Repeat views of a wardrobe grid are the common
 * case — several photos, revisited constantly — and this is what makes
 * serving them through the Worker cheap rather than merely correct.
 */
export async function getItemPhotoObject(
  db: Db,
  userId: string,
  itemId: string,
  size: string,
  ifNoneMatch?: string | null,
): Promise<R2Object | R2ObjectBody | undefined> {
  const item = await getOwnedItem(db, userId, itemId);
  if (item.photoKey === null) return undefined;
  if (!isPhotoSize(size)) return undefined;
  const key = `${item.photoKey}/${size}.webp`;
  const conditionalEtag = unquoteEtag(ifNoneMatch);
  const object =
    // Equivalent mutant: R2 treats `etagDoesNotMatch: undefined` as no
    // condition at all, so both arms answer the same for a caller that
    // sent no usable header. The branch is here to say so out loud.
    // Stryker disable next-line ConditionalExpression
    conditionalEtag === undefined
      ? await env.MEDIA.get(key)
      : await env.MEDIA.get(key, {
          onlyIf: { etagDoesNotMatch: conditionalEtag },
        });
  return object ?? undefined;
}
