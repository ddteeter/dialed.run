/**
 * Where an uploaded run file lives in `IMPORTS`:
 * `imports/{userId}/{importId}.{ext}`.
 *
 * In `lib/` for the reason `garment-photo-key.ts` is: three places spell
 * the prefix and none may import the others. `runs` writes the files, the
 * outbox's `import_file_delete` kind (lib) refuses a key outside the
 * runner's own prefix, and `account`'s data export lists it.
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
