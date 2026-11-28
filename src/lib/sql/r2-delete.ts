import { chunked } from "../chunked";

/**
The most keys one R2 delete takes.
*/
export const R2_DELETE_CAP = 1000;

/**
 * Delete these keys from an R2 bucket, a thousand at a time, and make no
 * call at all for none.
 *
 * R2 refuses a delete of an empty list, and of more than a thousand keys:
 * "The number of keys in the request must be between 1 and 1000
 * inclusive. (10027)". The local runtime accepts both, so only production
 * says so. A sweep that found nothing to delete threw it every hour after
 * the first deploy (2026-11-28). Every delete of a list goes through here.
 */
export async function deleteKeys(
  bucket: Pick<R2Bucket, "delete">,
  keys: readonly string[],
): Promise<void> {
  for (const chunk of chunked(keys, R2_DELETE_CAP)) await bucket.delete(chunk);
}
