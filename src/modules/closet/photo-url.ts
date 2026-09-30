import type { PhotoSize } from "./photos";
import type { WardrobeItemRow } from "./service";

/**
 * Where a garment's own photo is served from, or nothing when it has none.
 *
 * A sibling of its own rather than a line in the route, because
 * `server-functions-are-glue` forbids a route choosing anything — and
 * because two screens need the same URL: garment detail renders it, and
 * §AH's shade sampler reads a pixel out of it. A second copy is how one of
 * them ends up pointing at `/full` while the other points at `/card`.
 *
 * Same-origin on purpose: the sampler draws this into a canvas, and a
 * cross-origin image would taint it so `getImageData` throws.
 */
export function photoUrlFor(
  item: Pick<WardrobeItemRow, "id" | "photoKey">,
  // The card the screens draw; the data export links the full size
  // (task 126, ACC-10), which is the most of the photo the app keeps.
  size: PhotoSize = "card",
): string | undefined {
  if (item.photoKey === null) return undefined;
  // **Versioned**, because the GET route caches as `immutable`: each
  // upload writes under a new version of the key, and the version rides
  // the URL, so a replaced photo is a new address rather than a stale
  // cache entry. The route ignores the query; only the cache reads it.
  const version = item.photoKey.split("/").at(-1);
  return `/closet/photo/${item.id}/${size}?v=${String(version)}`;
}

/**
 * Whether a garment's photo is still waiting on screening or a person
 * (D-69, round 27 #21): its owner sees it, nobody else does, and both the
 * detail and the closet tile say so. `ok` is "never screened" from before
 * screening existed and `pass` is cleared, so neither is being checked.
 */
export function isPhotoBeingChecked(
  item: Pick<WardrobeItemRow, "photoKey" | "visibility">,
): boolean {
  return item.photoKey !== null && CHECKING.has(item.visibility);
}

const CHECKING: ReadonlySet<WardrobeItemRow["visibility"]> = new Set([
  "pending",
  "flagged",
  "hidden_pending_review",
]);
