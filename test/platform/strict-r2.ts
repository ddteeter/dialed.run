import { env } from "../../src/env";

/**
 * What R2 says to a delete of no keys, or of more than a thousand.
 * Production's own words: the first deploy's hourly cron threw them, from
 * a sweep that found nothing to delete (2026-11-28).
 */
export const R2_DELETE_REFUSAL =
  "delete: The number of keys in the request must be between 1 and 1000 inclusive. (10027)";

/**
The most keys one R2 delete takes.
*/
const R2_DELETE_MOST = 1000;

/**
 * Every R2 binding the worker has, made to refuse what R2 refuses.
 *
 * The local runtime deletes an empty list without complaint, and a list
 * of any length, so a test of code that hands R2 either passes and the
 * code throws in production. The worker project's setup file calls this
 * before each test file, so every test of every bucket sees production's
 * answer, including code nobody has written yet. A test that wants its
 * own `delete` still replaces it with `vi.spyOn`.
 */
export function refuseLikeR2(): void {
  for (const bucket of [
    env.MEDIA,
    env.IMPORTS,
    env.PUBLIC_PHOTOS,
    env.MEDIA_BACKUP,
  ]) {
    const local = bucket.delete.bind(bucket);
    Object.defineProperty(bucket, "delete", {
      configurable: true,
      writable: true,
      value: async (keys: string | string[]): Promise<void> => {
        if (
          Array.isArray(keys) &&
          (keys.length === 0 || keys.length > R2_DELETE_MOST)
        ) {
          throw new Error(R2_DELETE_REFUSAL);
        }
        await local(keys);
      },
    });
  }
}
