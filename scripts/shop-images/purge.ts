/**
 * The decisions behind `npm run shop-images:delete` (design 187, #472):
 * which objects in MEDIA are shop images, and deleting them only when
 * asked to.
 *
 * Until D-176 the enrichment consumer copied a shop's primary image into
 * MEDIA as `products/<productId>/image-<fetchedAt>`. The owner ruled no
 * shop images, and approved deleting the copies. **Page snapshots share the
 * prefix** (`products/<productId>/snapshot-<fetchedAt>.html`, D-31's
 * re-runnable extraction), so the match is the whole key, not the prefix.
 *
 * It takes the bucket as an argument, so the worker pool's MEDIA can test it
 * and the CLI can hand it a local or a remote one.
 */

/**
 * Exactly the key `copyProductImage` wrote: one path segment of id, then
 * `image-` and the fetch's millisecond timestamp, and nothing after it.
 */
const SHOP_IMAGE_KEY = /^products\/[^/]+\/image-\d+$/u;

export function isShopImageKey(key: string): boolean {
  return SHOP_IMAGE_KEY.test(key);
}

/**
 * R2's own cap on one `delete` call, and the most one `list` page returns.
 */
const R2_PAGE = 1000;

type Bucket = Pick<R2Bucket, "list" | "delete">;

/**
 * Every shop-image key in the bucket, in R2's key order, across as many list
 * pages as it takes.
 */
export async function shopImageKeys(bucket: Bucket): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: "products/",
      limit: R2_PAGE,
      ...(cursor !== undefined && { cursor }),
    });
    keys.push(
      ...page.objects
        .map((object) => object.key)
        .filter((key) => isShopImageKey(key)),
    );
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
}

export interface PurgeResult {
  /**
  The keys found. On a dry run these are what `--apply` would delete.
  */
  readonly keys: readonly string[];
  readonly isDeleted: boolean;
}

/**
 * Lists the shop images and, only when `apply` is set, deletes them in
 * batches of R2's cap. Re-runnable: a second run finds nothing left.
 */
export async function purgeShopImages(
  bucket: Bucket,
  { apply }: Readonly<{ apply: boolean }>,
): Promise<PurgeResult> {
  const keys = await shopImageKeys(bucket);
  if (!apply) return { keys, isDeleted: false };
  for (let start = 0; start < keys.length; start += R2_PAGE) {
    await bucket.delete(keys.slice(start, start + R2_PAGE));
  }
  return { keys, isDeleted: true };
}
