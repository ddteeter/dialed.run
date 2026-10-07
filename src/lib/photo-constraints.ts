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

/**
 * The accepted types as a runner reads them, for a well's hint.
 *
 * Derived from `allowedPhotoTypes` through a table keyed by it, so a type
 * added to the tuple fails to compile until it has a word — the hint cannot
 * go on naming formats the server refuses. Round 22's well draws "JPG, PNG
 * or HEIC"; HEIC is not accepted, so the hint says what is.
 */
const PHOTO_TYPE_WORDS = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const satisfies Record<AllowedPhotoType, string>;

export const photoFormatWords = new Intl.ListFormat("en-GB", {
  type: "disjunction",
}).format(allowedPhotoTypes.map((type) => PHOTO_TYPE_WORDS[type]));

const MEGABYTE = 1024 * 1024;

/**
 * What is wrong with a picked photo, or nothing.
 *
 * A field failure — the fix is another file — so the well's field message
 * says it (round 22, "Well states": *"File type and size are field
 * failures"*). The type list and the cap are the two above, the same two
 * facts the upload routes refuse by, so the screen cannot accept a file
 * the server would turn away.
 *
 * Here rather than in `modules/feed` because two screens ask it: A2's well
 * and W3's Pick another (`modules/safety`), which may not reach into the
 * feed module. A second copy in the step is how a PDF got past it.
 */
export function photoProblem(file: File): string | undefined {
  if (!isAllowedPhotoType(file.type)) {
    return `Photos must be ${photoFormatWords}.`;
  }
  if (file.size > maxPhotoBytes) {
    return `That photo is over ${String(maxPhotoBytes / MEGABYTE)} MB. Pick a smaller one.`;
  }
  return undefined;
}
