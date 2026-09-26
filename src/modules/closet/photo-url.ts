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
): string | undefined {
  if (item.photoKey === null) return undefined;
  // **Versioned**, because the GET route caches as `immutable`: each
  // upload writes under a new version of the key, and the version rides
  // the URL, so a replaced photo is a new address rather than a stale
  // cache entry. The route ignores the query; only the cache reads it.
  const version = item.photoKey.split("/").at(-1);
  return `/closet/photo/${item.id}/card?v=${String(version)}`;
}
