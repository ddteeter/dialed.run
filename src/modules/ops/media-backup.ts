/**
 * The daily photo backup (D-172, #420, design 186): garment and kit photos
 * copied from `MEDIA` into `MEDIA_BACKUP`, so a bad delete or overwrite by
 * the app can be undone. R2 keeps no versions and has no Time Travel.
 *
 * **A diff, not a log.** Each firing lists both buckets under each backed-up
 * prefix and copies what the backup lacks or holds an older copy of (its
 * `sourceEtag` differs from the source's etag). No checkpoint says "since
 * when", so a firing that dies halfway leaves nothing to reconcile: the
 * next one sees the same difference and finishes it (law 1).
 *
 * **What is backed up:** garment photos and entry photos, the two prefixes
 * only the runner could replace. Not `quarantine/` (suspected CSAM: one
 * more copy is one more place it lives, #530; a bucket lock protects it
 * instead), not `products/` (re-fetchable), not `health-probe`.
 *
 * **A deleted photo leaves the backup 30 days later** (#529). A backup
 * object whose source is gone moves to `gone/<key>`, and its upload time
 * there marks when it went. A `gone/` object more than 30 days old is
 * deleted. Without that the backup would keep every photo a runner ever
 * deleted, which the privacy policy does not allow.
 */
import { ENTRY_PHOTO_ROOT } from "../../lib/entry-photo-key";
import { GARMENT_PHOTO_ROOT } from "../../lib/garment-photo-key";

type Source = Pick<R2Bucket, "list" | "get">;
type Backup = Pick<R2Bucket, "list" | "get" | "put" | "delete">;

/**
 * The prefixes copied: the roots the key helpers write under, so a renamed
 * root cannot leave the backup copying nothing.
 */
export const BACKED_UP_PREFIXES: readonly string[] = [
  GARMENT_PHOTO_ROOT,
  ENTRY_PHOTO_ROOT,
];

/**
Where a backup object goes once its source is gone.
*/
export const GONE_PREFIX = "gone/";

/**
How long a deleted photo's copy is kept (#529).
*/
export const GONE_RETENTION_S = 30 * 24 * 60 * 60;

/**
 * Copies one firing makes at most. Each is two subrequests (a get and a
 * put), and the daily digest shares the invocation's budget. What is left
 * is the next firing's, and the digest says how much.
 */
export const MAX_COPIES_PER_FIRING = 1000;

const SOURCE_ETAG = "sourceEtag";

interface Listed {
  readonly key: string;
  readonly etag: string;
  readonly uploaded: Date;
  readonly customMetadata?: Record<string, string> | undefined;
}

async function listAll(
  bucket: Pick<R2Bucket, "list">,
  prefix: string,
): Promise<Listed[]> {
  const include: R2ListOptions["include"] = ["customMetadata"];
  let page = await bucket.list({ prefix, include });
  const found: Listed[] = [...page.objects];
  while (page.truncated) {
    page = await bucket.list({ prefix, include, cursor: page.cursor });
    found.push(...page.objects);
  }
  return found;
}

export interface MediaBackupOptions {
  /**
  Epoch seconds.
  */
  readonly now: number;
  readonly maxCopies?: number;
  readonly prefixes?: readonly string[];
}

/**
Copies one object from `from` to `to` under `key`, with its metadata.
*/
async function didCopy(
  from: Pick<R2Bucket, "get">,
  fromKey: string,
  to: Pick<R2Bucket, "put">,
  toKey: string,
  customMetadata: (source: R2Object) => Record<string, string>,
): Promise<boolean> {
  const object = await from.get(fromKey);
  if (object === null) return false;
  // Buffered: R2's put needs a body of known length, and photos are small.
  await to.put(toKey, await object.arrayBuffer(), {
    httpMetadata: object.httpMetadata ?? {},
    customMetadata: customMetadata(object),
  });
  return true;
}

/**
 * What the backup holds for a key it has no copy of. R2's listing gives
 * every object a `customMetadata` (empty when none was set), so this is
 * the only way the metadata is ever missing.
 */
const NOTHING_HELD: Pick<Listed, "customMetadata"> = {};

interface Tally {
  copied: number;
  owed: number;
  failed: number;
}

async function backUpPrefix(
  source: Source,
  backup: Backup,
  prefix: string,
  tally: Tally,
  maxCopies: number,
): Promise<void> {
  const [originals, copies] = await Promise.all([
    listAll(source, prefix),
    listAll(backup, prefix),
  ]);
  const copyOf = new Map(copies.map((object) => [object.key, object]));
  for (const original of originals) {
    const { customMetadata: held = {} } =
      copyOf.get(original.key) ?? NOTHING_HELD;
    copyOf.delete(original.key);
    if (held[SOURCE_ETAG] === original.etag) continue;
    if (tally.copied >= maxCopies) {
      tally.owed += 1;
      continue;
    }
    try {
      const isDone = await didCopy(
        source,
        original.key,
        backup,
        original.key,
        (object) => ({ ...object.customMetadata, [SOURCE_ETAG]: object.etag }),
      );
      if (isDone) tally.copied += 1;
    } catch {
      tally.failed += 1;
    }
  }
  // What is left held a source that is gone: set it aside to expire.
  for (const key of copyOf.keys()) {
    try {
      await didCopy(
        backup,
        key,
        backup,
        `${GONE_PREFIX}${key}`,
        (object) => object.customMetadata ?? {},
      );
      await backup.delete(key);
    } catch {
      tally.failed += 1;
    }
  }
}

async function expireGone(
  backup: Backup,
  now: number,
  tally: Tally,
): Promise<void> {
  const gone = await listAll(backup, GONE_PREFIX);
  const expired = gone
    .filter(
      (object) => now - object.uploaded.getTime() / 1000 > GONE_RETENTION_S,
    )
    .map((object) => object.key);
  try {
    // R2 deletes up to 1000 keys a call.
    for (let start = 0; start < expired.length; start += 1000) {
      await backup.delete(expired.slice(start, start + 1000));
    }
  } catch {
    tally.failed += 1;
  }
}

/**
 * One firing's backup. Anomaly lines go to the daily digest; none means
 * every photo is backed up and nothing failed.
 */
export async function backUpMedia(
  buckets: { readonly source: Source; readonly backup: Backup },
  anomalies: string[],
  options: MediaBackupOptions,
): Promise<void> {
  const { source, backup } = buckets;
  const tally: Tally = { copied: 0, owed: 0, failed: 0 };
  const maxCopies = options.maxCopies ?? MAX_COPIES_PER_FIRING;
  const prefixes = options.prefixes ?? BACKED_UP_PREFIXES;
  for (const prefix of prefixes) {
    await backUpPrefix(source, backup, prefix, tally, maxCopies);
  }
  await expireGone(backup, options.now, tally);
  if (tally.owed > 0) {
    anomalies.push(
      `media-backup: ${String(tally.owed)} photos left for the next firing (${String(maxCopies)} a day)`,
    );
  }
  if (tally.failed > 0) {
    anomalies.push(
      `media-backup: ${String(tally.failed)} copies or deletes failed; the next firing retries them`,
    );
  }
}
