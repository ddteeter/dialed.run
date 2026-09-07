/**
 * Photo limits shared by the client (pre-flight checks, input `accept`) and
 * the server (the authoritative validation).
 *
 * These live in lib/ specifically so a component can import them. Lane 104
 * re-declared them inside routes/feed/verdict.$entryId.tsx with a comment
 * explaining that importing modules/feed/photos.ts would drag D1- and
 * env-touching code into the client bundle. That reason was correct; the
 * conclusion was not. Pure constants belong in lib/, where both sides can
 * reach them and neither owns them.
 *
 * A client-side check here is a courtesy, not a gate — the server re-runs
 * every one of these against the uploaded bytes.
 */

export const allowedPhotoTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedPhotoType = (typeof allowedPhotoTypes)[number];

/**
Ready for an `<input type="file" accept=...>`.
*/
export const photoAcceptAttribute = allowedPhotoTypes.join(",");

export const maxPhotoBytes = 10 * 1024 * 1024;
export const maxPhotosPerEntry = 4;

/**
Widened once so the guard can test an arbitrary string against the tuple.
*/
const allowedPhotoTypeStrings: readonly string[] = allowedPhotoTypes;

export function isAllowedPhotoType(value: string): value is AllowedPhotoType {
  return allowedPhotoTypeStrings.includes(value);
}
