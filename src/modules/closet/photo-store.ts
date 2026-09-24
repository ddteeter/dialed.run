/**
 * Where a garment's photo bytes live in R2, and how they leave.
 *
 * Its own file because two writers need it and neither may import the
 * other: `photos.ts` (Replace, Remove) already imports `service.ts`, and
 * `service.ts` hard-deletes a garment, which has to take its photo with it.
 */
import { env } from "../../env";

/**
 * The item's own prefix in R2. Every version of every photo the garment
 * has ever had sits under it, so it is the unit a cleanup works on.
 */
export function photoKeyFor(userId: string, itemId: string): string {
  return `items/${userId}/${itemId}`;
}

/**
 * Deletes every object under `prefix/`, a page at a time.
 *
 * **Listed, not named**, because the thing calling this may not know what
 * is there: a Remove whose D1 write committed and whose R2 delete failed
 * has already cleared the only record of the photo's version, so the retry
 * has nothing to name. Deleting by prefix makes that retry complete, and
 * makes a second run of it a no-op (CLAUDE.md law 8c: a half-finished
 * cleanup must be something a retry can finish).
 *
 * `pageSize` is R2's own cap by default; a test passes a small one so the
 * cursor is exercised without writing a thousand objects.
 */
export async function deleteStoredObjects(
  prefix: string,
  pageSize = 1000,
): Promise<void> {
  const options: R2ListOptions = { prefix: `${prefix}/`, limit: pageSize };
  for (;;) {
    const page = await env.MEDIA.list(options);
    await env.MEDIA.delete(page.objects.map((object) => object.key));
    if (!page.truncated) return;
    options.cursor = page.cursor;
  }
}
