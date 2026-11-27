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
import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { newUlid, ulidSchema } from "../../lib/ids";
import {
  PHOTO_LIMIT_REACHED,
  PHOTOS_STILL_HELD,
  isAllowedPhotoType,
  maxPhotoBytes,
} from "../../lib/photo-constraints";
import { env, primaryCoreDb } from "../../env";
import {
  fitWithin,
  photoRefusal,
  withReleased,
} from "../../lib/photo-pipeline";
import { garmentOriginalKey, photoKeyFor } from "../../lib/garment-photo-key";
import { nowSeconds } from "../../lib/now";
import { fingerprintOf } from "../../lib/photo-fingerprint";
import { ownedBy } from "../../lib/sql/owned";
import { doesConditionHold } from "../../lib/sql/condition";
import { claimLimit } from "../ops/limits";
import { getOwnedItem } from "./service";
import {
  outboxInsert,
  oweOutbox,
  settleOutbox,
  storageHandlers,
} from "../ops/outbox";
import { captureException } from "../ops/sentry";
import {
  enqueueForReview,
  withdrawnGarmentUnderReview,
  isHeldAsRemovedCopy,
  photosHeldBelowLimit,
} from "../safety/review";
import {
  classifierFromEnv,
  garmentPhotoForgotten,
  screenPhoto,
  type Classify,
} from "../safety/screening";

type Db = ReturnType<typeof drizzle>;

export const photoSizes = ["thumb", "card", "full"] as const;
export type PhotoSize = (typeof photoSizes)[number];

const SIZE_TARGETS: Record<PhotoSize, number> = {
  thumb: 200,
  card: 600,
  full: 1600,
};

/**
 * The re-encoded original's JPEG quality: high enough that nothing a
 * runner would notice is lost, since it is the one copy at full size.
 */
const ORIGINAL_QUALITY = 90;

export function isPhotoSize(value: string): value is PhotoSize {
  const sizes: readonly string[] = photoSizes;
  return sizes.includes(value);
}

export class PhotoValidationError extends Error {}

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
  // Read from the header, before anything decodes it (SAF-2, R-3): a
  // 10 MB file can decode to ~96 MB, and the isolate has 128.
  const refusal = photoRefusal(bytes);
  if (refusal !== undefined) throw new PhotoValidationError(refusal);
  await getOwnedItem(db, userId, itemId);
  // Refused while the classifier's holds on the runner's photos are at
  // their limit, before the day's count, so the refusal spends none of it.
  if (!(await hasHeldPhotoRoom(userId))) {
    throw new PhotoValidationError(PHOTOS_STILL_HELD);
  }
  // One of the runner's day's photo uploads (SA-M14), counted before
  // anything is decoded or stored.
  const claim = await claimLimit(db, "photo-runner", userId);
  if (!claim.isAllowed) throw new PhotoValidationError(PHOTO_LIMIT_REACHED);

  // Lazily imported on purpose: this package ships a WASM module, and a
  // static import instantiates it during worker startup — a cost paid by
  // every request, including the ones that never touch a photo, and
  // charged against the separate startup CPU limit. Deferring it means the
  // module compiles once per isolate, on a request that was always slow.
  const photon = await import("@cf-wasm/photon/workerd");
  const { PhotonImage, SamplingFilter, resize } = photon;
  // A new version under the item's prefix for every upload. The URL a
  // photo is served from carries the version (`photoUrlFor`), and the GET
  // route caches it as immutable — so a replaced photo must live at a new
  // address, or every browser that saw the old one keeps showing it.
  const keyPrefix = `${photoKeyFor(userId, itemId)}/${newUlid()}`;

  // Nothing the runner sent is stored as sent (task 128 · SAF-1). The
  // original is decoded and re-encoded like every size, so no metadata —
  // the GPS a phone writes into every frame — survives into storage. That
  // puts the decode before the first write, which is why a photo that will
  // not decode now stores nothing at all rather than a raw original.
  const { original, fingerprint } = await withReleased(
    PhotonImage.new_from_byteslice(bytes),
    async (input) => {
      // Before the re-encode (D-142, design 146): the hash describes what
      // the runner sent, not our copy of it.
      const taken = await fingerprintOf(input, photon);
      const reencoded = input.get_bytes_jpeg(ORIGINAL_QUALITY);
      await env.MEDIA.put(garmentOriginalKey(keyPrefix), reencoded, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      const width = input.get_width();
      const height = input.get_height();
      for (const size of photoSizes) {
        const dims = fitWithin(width, height, SIZE_TARGETS[size]);
        await withReleased(
          resize(input, dims.width, dims.height, SamplingFilter.Lanczos3),
          async (resized) => {
            await env.MEDIA.put(
              sizeKey(keyPrefix, size),
              resized.get_bytes_webp(),
              {
                httpMetadata: { contentType: "image/webp" },
              },
            );
          },
        );
      }
      return { original: reencoded, fingerprint: taken };
    },
  );

  // The replaced photo leaves storage — it may be the unblurred frame the
  // runner replaced it to get rid of, under whichever original extension
  // it arrived with. The debt is written with the new key, in one batch
  // (law 8c), so it is owed from the moment the row stops naming the old
  // version; the fast path then clears every object the row no longer
  // names. A failed fast path never fails the upload (law 5) — the photo
  // the runner asked for is saved — and the outbox drainer finishes it.
  const debt = oweOutbox({ kind: "photo_delete", payload: { userId, itemId } });
  // A copy of an image removed as intimate (D-147, design 157) is held for
  // a person, as a kit photo's is, while the fingerprint breaker has room
  // (design 164): from the primary, since what was kept is an operator's
  // write and a replica may not have it yet.
  const isCopyOfRemoved = await isHeldAsRemovedCopy(
    primaryCoreDb(),
    fingerprint,
    userId,
    nowSeconds(),
  );
  const pointAtNewVersion = db
    .update(wardrobeItems)
    // `visibility: "pending"` in the same write as the key. A garment with
    // a photo and no screening state would read as `ok` — the pre-106
    // default meaning "never screened" — and slip into public view
    // unclassified. Setting it here rather than in the column default is
    // deliberate: most wardrobe rows have no photo at all and should stay
    // `ok` rather than queue for a sweep that has nothing to fetch.
    //
    // The fingerprint rides the same write, so a replaced photo's hash is
    // overwritten with the photo, never left describing it.
    //
    // The visibility is written only while the runner's photos held or
    // waiting to be screened are under their limit, counted in this
    // statement; with no room it is NULL, which the column refuses, and
    // the whole batch with it.
    .set({
      photoKey: keyPrefix,
      photoFingerprint: fingerprint,
      visibility: visibilityWhileRoom(db, userId, isCopyOfRemoved),
    })
    .where(ownedBy(wardrobeItems, { id: itemId, userId }));
  // A photo replaced under review keeps its fingerprint and its record
  // (design 232), asked in the batch.
  const kept = withdrawnGarmentUnderReview(db, userId, itemId);
  // The replaced photo's verdicts and open review go with it (design
  // 157), before the new photo's hold, if any, opens a review again; the
  // keep goes ahead of the settle, which closes the review it asks about.
  const [forgetVerdicts, settleReview] = garmentPhotoForgotten(
    db,
    userId,
    itemId,
  );
  try {
    await db.batch([
      forgetVerdicts,
      ...kept,
      settleReview,
      pointAtNewVersion,
      ...(isCopyOfRemoved
        ? [
            enqueueForReview(db, {
              subjectType: "garment",
              subjectId: itemId,
              source: "fingerprint",
            }),
          ]
        : []),
      outboxInsert(db, debt),
    ]);
  } catch (error: unknown) {
    if (!isHeldPhotosRefusal(error)) throw error;
    // Another of the runner's uploads took the last of their held photos'
    // room while this one was being stored: its objects go, and the
    // garment keeps the photo it had.
    await env.MEDIA.delete(versionKeys(keyPrefix));
    throw new PhotoValidationError(PHOTOS_STILL_HELD);
  }
  await settleOutbox(db, debt, storageHandlers, report);
  // A held photo waits for a person, not the classifier.
  if (isCopyOfRemoved) return { photoKey: keyPrefix };

  // Same shape as the entry path: bounded, never throws, and a failure
  // leaves the row `pending` for the screening-retry cron. The ORIGINAL
  // bytes are classified rather than a derived size — a resize is our
  // artefact, and screening something the runner never uploaded would
  // make a verdict hard to explain.
  await screenPhoto(
    {
      scope: "garment",
      photoId: itemId,
      bytes: original,
      contentType: "image/jpeg",
    },
    classify ?? classifierFromEnv(),
  );

  return { photoKey: keyPrefix };
}

/**
 * The new photo's screening state, held for a person when it is a copy of
 * a removed image, or NULL when the runner's photos held or waiting to be
 * screened are at their limit as the statement runs.
 */
function visibilityWhileRoom(db: Db, userId: string, isCopyOfRemoved: boolean) {
  type Visibility = (typeof wardrobeItems.$inferSelect)["visibility"];
  const state: Visibility = isCopyOfRemoved
    ? "hidden_pending_review"
    : "pending";
  return sql<Visibility>`case when ${photosHeldBelowLimit(db, userId)} then ${state} else null end`;
}

/**
 * Whether an error is the NOT NULL refusal of the garment's visibility
 * that a held photos' limit with no room fails the upload's batch with.
 * Only the parts SQLite's own text keeps are matched, wherever D1 or a
 * wrapper puts them in the message.
 */
export function isHeldPhotosRefusal(error: unknown): boolean {
  const text = String(error);
  return (
    text.includes("NOT NULL") && text.includes("wardrobe_items.visibility")
  );
}

/**
Every object one upload stores under its version's prefix.
*/
function versionKeys(keyPrefix: string): string[] {
  return [
    garmentOriginalKey(keyPrefix),
    ...photoSizes.map((size) => sizeKey(keyPrefix, size)),
  ];
}

function sizeKey(keyPrefix: string, size: PhotoSize): string {
  return `${keyPrefix}/${size}.webp`;
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
  const clearPhoto = photoOff(db, stillNamesAPhoto);
  // Kept under review (design 232), asked in the batch.
  const kept = withdrawnGarmentUnderReview(db, userId, itemId);
  // The keep goes ahead of the settle, which closes the review it asks about.
  const [forgetVerdicts, settleReview] = garmentPhotoForgotten(
    db,
    userId,
    itemId,
  );
  await db.batch([
    forgetVerdicts,
    ...kept,
    settleReview,
    clearPhoto,
    outboxInsert(db, debt),
  ]);
  await settleOutbox(db, debt, storageHandlers, report);
}

/**
 * The statement that takes the photo off the garments `where` matches,
 * and puts back the visibility of a garment with no photo.
 */
function photoOff(db: Db, where: SQL | undefined) {
  return (
    db
      .update(wardrobeItems)
      // `sql\`NULL\`` rather than the literal — see lib/sql/sql-null.
      // The fingerprint goes with the key (D-142): it describes the photo,
      // and the photo is gone.
      .set({
        photoKey: sql`NULL`,
        photoFingerprint: sql`NULL`,
        visibility: "ok",
      })
      .where(where)
  );
}

/**
 * The Desk's Remove of a garment's photo, as a statement for its batch:
 * only the version read, since a photo replaced since is not the one
 * decided on, and this must not clear it. Also the Desk's Clear photo on
 * a garment whose file is missing (D-157).
 */
export function clearedPhoto(
  db: Db,
  { itemId, photoKey }: { itemId: string; photoKey: string },
) {
  return photoOff(
    db,
    and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.photoKey, photoKey)),
  );
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
 * test (R-41).
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
    // *declared* size, before `arrayBuffer()` copies the file out of the
    // form, so an oversized upload is refused without that copy.
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
  if (item.photoKey === null || !isPhotoSize(size)) return undefined;
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

/**
 * Whether the runner has room for one more photo held or waiting to be
 * screened, read from the primary, since the answer decides whether an
 * upload is written: the rule the photo's own write carries.
 */
async function hasHeldPhotoRoom(userId: string): Promise<boolean> {
  const primary = primaryCoreDb();
  return doesConditionHold(primary, photosHeldBelowLimit(primary, userId));
}
