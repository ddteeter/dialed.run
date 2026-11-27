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
 * **Nor a photo a quarantine record covers** (D-70). A quarantine deletes
 * the backup's copies of what it took, under their keys and under `gone/`,
 * once its record has landed (`dropBackupCopies`). Each firing then
 * deletes any copy of a covered photo it finds, and copies none, even of
 * a source whose delete is still owed, for as long as the record lasts.
 * The records are read before anything is copied, so a firing that cannot
 * read them copies nothing. A firing that read them just before a
 * quarantine landed may still copy that photo if its source delete
 * failed too; the next firing deletes that copy.
 *
 * **A deleted photo leaves the backup 30 days later** (#529). A backup
 * object whose source is gone moves to `gone/<key>`, and its upload time
 * there marks when it went. A `gone/` object more than 30 days old is
 * deleted. Without that the backup would keep every photo a runner ever
 * deleted, which the privacy policy does not allow.
 */
import { env } from "../../../env";
import { ENTRY_PHOTO_ROOT } from "../../../lib/entry-photo-key";
import { GARMENT_PHOTO_ROOT } from "../../../lib/garment-photo-key";

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

/**
The most keys one R2 delete takes.
*/
const DELETE_BATCH = 1000;

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

/**
 * Whether a quarantine's scope covers a key: the scope itself, or anything
 * beneath it. A photo's key covers that photo, a kit's prefix every photo
 * under it, and a garment photo's version every object of that version.
 */
function isCoveredBy(key: string, scope: string): boolean {
  const beneath = scope.endsWith("/") ? scope : `${scope}/`;
  return key === scope || key.startsWith(beneath);
}

/**
The key a `gone/` object was set aside from.
*/
function setAsideFrom(goneKey: string): string {
  return goneKey.slice(GONE_PREFIX.length);
}

/**
 * Deletes these keys from the backup, a call per `DELETE_BATCH`. Throws
 * what R2 throws.
 */
async function deleteKeys(
  backup: Pick<R2Bucket, "delete">,
  keys: readonly string[],
): Promise<void> {
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    await backup.delete(keys.slice(start, start + DELETE_BATCH));
  }
}

/**
 * What the backup holds under a prefix, under its own key or set aside
 * under `gone/`: each copy by the key its photo had, and where it is.
 */
async function copiesUnder(
  backup: Pick<R2Bucket, "list">,
  prefix: string,
): Promise<{ key: string; at: string }[]> {
  const [held, gone] = await Promise.all([
    listAll(backup, prefix),
    listAll(backup, `${GONE_PREFIX}${prefix}`),
  ]);
  return [
    ...held.map((object) => ({ key: object.key, at: object.key })),
    ...gone.map((object) => ({
      key: setAsideFrom(object.key),
      at: object.key,
    })),
  ];
}

/**
 * The backup's copies of what one quarantine covers, deleted now: under
 * their own keys and under `gone/`. `scope` is the photo's key, the kit's
 * prefix or the garment photo's version. Each firing deletes whatever
 * this leaves (`backUpMedia`), so a caller reports a failure and goes on.
 * Throws what R2 throws.
 */
export async function dropBackupCopies(
  scope: string,
  backup: Pick<R2Bucket, "list" | "delete"> = env.MEDIA_BACKUP,
): Promise<void> {
  const copies = await copiesUnder(backup, scope);
  await deleteKeys(
    backup,
    copies
      .filter((copy) => isCoveredBy(copy.key, scope))
      .map((copy) => copy.at),
  );
}

/**
 * The keys the backup holds a copy of under a prefix, under the key or
 * set aside under `gone/`, each once: what a quarantine preserves of a
 * garment photo's version beside what `MEDIA` still lists.
 */
export async function backedUpKeysUnder(
  prefix: string,
  backup: Pick<R2Bucket, "list"> = env.MEDIA_BACKUP,
): Promise<string[]> {
  const copies = await copiesUnder(backup, prefix);
  return [...new Set(copies.map((copy) => copy.key))];
}

/**
 * The backup's copy of one photo, under its key or else set aside under
 * `gone/`, and where it was found: what a quarantine preserves of a photo
 * `MEDIA` no longer has. Nothing when the backup has neither.
 */
export async function backedUpCopyOf(
  key: string,
  backup: Pick<R2Bucket, "get"> = env.MEDIA_BACKUP,
): Promise<{ at: string; object: R2ObjectBody } | undefined> {
  for (const at of [key, `${GONE_PREFIX}${key}`]) {
    const object = await backup.get(at);
    if (object !== null) return { at, object };
  }
  return undefined;
}

/**
 * The scopes the quarantine records cover, read once a firing
 * (`quarantinedScopes`, in safety): each a photo's key, a kit's prefix or
 * a garment photo's version.
 */
type QuarantinedScopes = () => Promise<readonly string[]>;

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

/**
What one firing works with, and what it has done so far.
*/
interface Firing {
  readonly source: Source;
  readonly backup: Backup;
  readonly tally: Tally;
  readonly maxCopies: number;
  /**
  Whether a quarantine record covers this key.
  */
  readonly isQuarantined: (key: string) => boolean;
}

/**
Deletes these keys from the backup, counting a failure once.
*/
async function dropAll(
  firing: Pick<Firing, "backup" | "tally">,
  keys: readonly string[],
): Promise<void> {
  try {
    await deleteKeys(firing.backup, keys);
  } catch {
    firing.tally.failed += 1;
  }
}

/**
A source the backup lacks or holds an older copy of, copied within the cap.
*/
async function copyOriginal(firing: Firing, key: string): Promise<void> {
  const { tally } = firing;
  if (tally.copied >= firing.maxCopies) {
    tally.owed += 1;
    return;
  }
  try {
    const isDone = await didCopy(
      firing.source,
      key,
      firing.backup,
      key,
      (object) => ({ ...object.customMetadata, [SOURCE_ETAG]: object.etag }),
    );
    if (isDone) tally.copied += 1;
  } catch {
    tally.failed += 1;
  }
}

/**
A copy whose source is gone, moved under `gone/` to expire.
*/
async function setAside(firing: Firing, key: string): Promise<void> {
  try {
    await didCopy(
      firing.backup,
      key,
      firing.backup,
      `${GONE_PREFIX}${key}`,
      (object) => object.customMetadata ?? {},
    );
    await firing.backup.delete(key);
  } catch {
    firing.tally.failed += 1;
  }
}

async function backUpPrefix(firing: Firing, prefix: string): Promise<void> {
  const [originals, copies] = await Promise.all([
    listAll(firing.source, prefix),
    listAll(firing.backup, prefix),
  ]);
  const copyOf = new Map(copies.map((object) => [object.key, object]));
  for (const original of originals) {
    // Never copied. A copy made before stays in `copyOf`, and goes below.
    if (firing.isQuarantined(original.key)) continue;
    const { customMetadata: held = {} } =
      copyOf.get(original.key) ?? NOTHING_HELD;
    copyOf.delete(original.key);
    if (held[SOURCE_ETAG] !== original.etag) {
      await copyOriginal(firing, original.key);
    }
  }
  // What is left is a covered photo's copy, which goes, or one whose source
  // is gone, which is set aside to expire.
  const covered: string[] = [];
  for (const key of copyOf.keys()) {
    if (firing.isQuarantined(key)) {
      covered.push(key);
    } else {
      await setAside(firing, key);
    }
  }
  await dropAll(firing, covered);
}

/**
A `gone/` copy past its 30 days, or one a quarantine covers at any age.
*/
async function expireGone(firing: Firing, now: number): Promise<void> {
  const gone = await listAll(firing.backup, GONE_PREFIX);
  const due = gone
    .filter(
      (object) =>
        now - object.uploaded.getTime() / 1000 > GONE_RETENTION_S ||
        firing.isQuarantined(setAsideFrom(object.key)),
    )
    .map((object) => object.key);
  await dropAll(firing, due);
}

/**
 * One firing's backup. Anomaly lines go to the daily digest; none means
 * every photo is backed up and nothing failed. Throws, having copied
 * nothing, when the quarantine records cannot be read.
 */
export async function backUpMedia(
  sides: {
    readonly source: Source;
    readonly backup: Backup;
    readonly quarantined: QuarantinedScopes;
  },
  anomalies: string[],
  options: MediaBackupOptions,
): Promise<void> {
  const scopes = await sides.quarantined();
  const firing: Firing = {
    source: sides.source,
    backup: sides.backup,
    tally: { copied: 0, owed: 0, failed: 0 },
    maxCopies: options.maxCopies ?? MAX_COPIES_PER_FIRING,
    isQuarantined: (key) => scopes.some((scope) => isCoveredBy(key, scope)),
  };
  const prefixes = options.prefixes ?? BACKED_UP_PREFIXES;
  for (const prefix of prefixes) await backUpPrefix(firing, prefix);
  await expireGone(firing, options.now);
  const { owed, failed } = firing.tally;
  if (owed > 0) {
    anomalies.push(
      `media-backup: ${String(owed)} photos left for the next firing (${String(firing.maxCopies)} a day)`,
    );
  }
  if (failed > 0) {
    anomalies.push(
      `media-backup: ${String(failed)} copies or deletes failed; the next firing retries them`,
    );
  }
}
