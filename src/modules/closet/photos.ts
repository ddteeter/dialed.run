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
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import {
  isAllowedPhotoType,
  maxPhotoBytes,
} from "../../lib/photo-constraints";
import { env } from "../../env";
import { getOwnedItem } from "./service";

type Db = ReturnType<typeof drizzle>;


export const photoSizes = ["thumb", "card", "full"] as const;
export type PhotoSize = (typeof photoSizes)[number];

const SIZE_TARGETS: Record<PhotoSize, number> = {
  thumb: 200,
  card: 600,
  full: 1600,
};

function isPhotoSize(value: string): value is PhotoSize {
  const sizes: readonly string[] = photoSizes;
  return sizes.includes(value);
}

export class PhotoValidationError extends Error {}

/**
 * Exhaustive over AllowedPhotoType, so adding a type to lib is a compile
 * error here rather than a runtime throw on the first upload of it.
 */
function extensionFor(contentType: string): string {
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

function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function photoKeyFor(userId: string, itemId: string): string {
  return `items/${userId}/${itemId}`;
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
  const keyPrefix = photoKeyFor(userId, itemId);
  const ext = extensionFor(contentType);

  // Original first (requirement 8): even if decode/resize below throws, the
  // source bytes are already durable in R2.
  await env.MEDIA.put(`${keyPrefix}/original.${ext}`, bytes, {
    httpMetadata: { contentType },
  });

  const input = PhotonImage.new_from_byteslice(bytes);
  try {
    const width = input.get_width();
    const height = input.get_height();
    for (const size of photoSizes) {
      const target = SIZE_TARGETS[size];
      const dims = fitWithin(width, height, target);
      const resized = resize(
        input,
        dims.width,
        dims.height,
        SamplingFilter.Lanczos3,
      );
      try {
        const webpBytes = resized.get_bytes_webp();
        await env.MEDIA.put(`${keyPrefix}/${size}.webp`, webpBytes, {
          httpMetadata: { contentType: "image/webp" },
        });
      } finally {
        resized.free();
      }
    }
  } finally {
    input.free();
  }

  await db
    .update(wardrobeItems)
    .set({ photoKey: keyPrefix })
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)));

  return { photoKey: keyPrefix };
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
function unquoteEtag(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim().replace(/^W\//, "");
  if (trimmed === "" || trimmed === "*" || trimmed.includes(",")) return undefined;
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
    conditionalEtag === undefined
      ? await env.MEDIA.get(key)
      : await env.MEDIA.get(key, {
          onlyIf: { etagDoesNotMatch: conditionalEtag },
        });
  return object ?? undefined;
}
