/**
 * Where an uploaded run file lives in `IMPORTS`:
 * `imports/{userId}/{importId}.{ext}`.
 *
 * In `lib/` for the reason `garment-photo-key.ts` is: three places spell
 * the prefix and none may import the others. `runs` writes the files, the
 * outbox's `import_file_delete` and `import_file_expire` kinds (lib)
 * refuse a key outside the runner's own prefix, and `account`'s data
 * export and purge list it. No bucket rule expires these files: one that
 * was read goes once its run is in the log (D-116, replacing D-110's "as
 * long as the run"), a failed import's 30 days after it failed, and every
 * one of a runner's goes with their account.
 */

/**
Every run file one runner has uploaded, under one prefix.
*/
export function importFilePrefix(userId: string): string {
  return `imports/${userId}/`;
}

export function importFileKeyFor(
  userId: string,
  importId: string,
  extension: string,
): string {
  return `${importFilePrefix(userId)}${importId}.${extension}`;
}
