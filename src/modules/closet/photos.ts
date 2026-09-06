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
import { env } from "../../env";
import { getOwnedItem } from "./service";

type Db = ReturnType<typeof drizzle>;

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

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

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  throw new PhotoValidationError("Photo must be JPEG, PNG, or WEBP.");
}

export function validatePhoto(contentType: string, byteLength: number): void {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new PhotoValidationError("Photo must be JPEG, PNG, or WEBP.");
  }
  if (byteLength === 0) {
    throw new PhotoValidationError("Photo file is empty.");
  }
  if (byteLength > MAX_BYTES) {
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

  const { PhotonImage, SamplingFilter, resize } =
    await import("@cf-wasm/photon/workerd");
  const keyPrefix = photoKeyFor(userId, itemId);
  const ext = extensionFor(contentType);

  // Original first (requirement 8): even if decode/resize below throws, the
  // source bytes are already durable in R2.
  await env.PHOTOS.put(`${keyPrefix}/original.${ext}`, bytes, {
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
        await env.PHOTOS.put(`${keyPrefix}/${size}.webp`, webpBytes, {
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
export async function getItemPhotoObject(
  db: Db,
  userId: string,
  itemId: string,
  size: string,
): Promise<R2ObjectBody | undefined> {
  const item = await getOwnedItem(db, userId, itemId);
  if (item.photoKey === null) return undefined;
  if (!isPhotoSize(size)) return undefined;
  const object = await env.PHOTOS.get(`${item.photoKey}/${size}.webp`);
  return object ?? undefined;
}
