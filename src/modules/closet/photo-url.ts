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
export function photoUrlFor(item: WardrobeItemRow): string | undefined {
  return item.photoKey === null ? undefined : `/closet/photo/${item.id}/card`;
}
