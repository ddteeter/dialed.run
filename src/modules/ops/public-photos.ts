/**
 * The public photo bucket (D-151, design 160 step 8): a copy of each
 * screened photo on a PUBLIC kit, under an unguessable key, so `/k/<id>`
 * can show it and Cloudflare's cache (and the CSAM Scanning Tool) serves
 * it. Deleted when the kit or the photo stops being public, for whatever
 * reason.
 *
 * **One rule decides, and it is the page's.** A copy may exist only while
 * its photo is `pass` (`publicPhotoStatus`) on a kit `worldVisibleEntry()`
 * admits: so a photo still pending, held for review, under a copyright
 * hold or quarantined is never copied, and a copy whose kit was made
 * private, hidden, held, removed or deleted, or whose runner was banned or
 * is leaving, is deleted. `syncPublicPhotos` makes the bucket match the
 * rule for some kits or runners; it is re-runnable from any point (law 1)
 * and both directions are idempotent.
 *
 * **Not transactional with D1 (law 8c): reconciled.** `public_photos` is
 * the record of what is in the bucket. A copy is claimed there before it
 * is put (law 2), and its row is deleted only after the object is, so
 * every object has a row until it is gone. What the fast paths miss — a
 * failed delete, a Worker that died mid-copy — the hourly sweep finds: a
 * row the rule no longer admits, a copy still owed, or an object no row
 * names.
 *
 * **Every retraction reaches it through the purge.** `purgePublicPages`
 * (`./edge-purge`), which every path that takes a page back already
 * calls, syncs the kits and runners its tags name. A photo's own
 * retraction (hidden, held, removed, deleted) purges its kit's page for
 * the same reason. Publications the purge does not see are the sweep's,
 * within the hour, as their pages are the TTL's.
 *
 * **Never fails the write that asked** (law 5): the fast path runs in
 * `waitUntil`, and each copy's failure is reported to Sentry (law 7) with
 * the photo's id, never its public key, and the rest go on.
 */
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  not,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { entryPhotos, outfitEntries, publicPhotos } from "../../db/schema-core";
import { env, primaryCoreDb, waitUntil } from "../../env";
import type { TaggedScope } from "../../lib/cache-tags";
import { chunked, IN_LIST_CHUNK, readInChunks } from "../../lib/chunked";
import { nowSeconds } from "../../lib/now";
import {
  newPublicPhotoKey,
  PUBLIC_PHOTO_CACHE_CONTROL,
  publicPhotoUrl,
} from "../../lib/public-photos";
import { publicPhotoStatus, worldVisibleEntry } from "../safety";

import { captureException, type KeepAlive } from "./sentry";

type Db = DrizzleD1Database<Record<string, unknown>>;

/**
What a sync needs from the platform, handed in so a test can watch it.
*/
export interface PublicPhotoDeps {
  /**
  The primary: a sync follows the write that asked for it.
  */
  readonly db: Db;
  /**
  The private photos, read to copy.
  */
  readonly media: Pick<R2Bucket, "get">;
  readonly bucket: Pick<R2Bucket, "put" | "delete" | "list">;
  /**
   * Whether copies are made at all: `PUBLIC_PHOTOS_ORIGIN` is set. Deleting
   * never waits on it.
   */
  readonly isPublishing: boolean;
  readonly newKey: () => string;
  readonly report: (error: unknown, context: Record<string, string>) => void;
}

/**
 * How many copies one pass deletes, and how many it makes: a bound on one
 * invocation's work, which the sweep's next firing continues.
 */
const COPIES_PER_PASS = 50;

/**
 * The rule, for a `public_photos` row: its photo is still a screened photo
 * on a kit the open web may see. A row whose photo or kit is gone fails it.
 */
function stillPublic(): SQL {
  return sql`exists (select 1 from ${entryPhotos} inner join ${outfitEntries} on ${outfitEntries.id} = ${entryPhotos.entryId} where ${entryPhotos.id} = ${publicPhotos.photoId} and ${entryPhotos.screenStatus} = ${publicPhotoStatus} and ${worldVisibleEntry()})`;
}

/**
The rule's negation: a copy that must go.
*/
function noLongerPublic(): SQL {
  return not(stillPublic());
}

/**
 * One reconcile's reach: the copies it may delete and the kits whose
 * photos it may copy. Absent is everything (the sweep's `{}`).
 */
interface Reach {
  readonly copies?: SQL;
  readonly kits?: SQL;
}

/**
 * The scope as reaches of at most one `IN` list each, under D1's
 * parameter cap: a kit's copies by its id, a runner's by theirs.
 */
function reachesOf(scope: TaggedScope): Reach[] {
  return [
    ...chunked(scope.entryIds, IN_LIST_CHUNK).map((ids) => ({
      copies: inArray(publicPhotos.entryId, ids),
      kits: inArray(outfitEntries.id, ids),
    })),
    ...chunked(scope.runnerIds, IN_LIST_CHUNK).map((ids) => ({
      copies: inArray(publicPhotos.userId, ids),
      kits: inArray(outfitEntries.userId, ids),
    })),
  ];
}

/**
 * Makes the bucket match the rule for these kits and runners: deletes
 * every copy the rule no longer admits, then (when publishing) copies
 * every screened photo on a public kit that has none. Never throws for a
 * copy; returns how many copies it deleted.
 */
export async function syncPublicPhotos(
  deps: PublicPhotoDeps,
  scope: TaggedScope,
): Promise<number> {
  let deleted = 0;
  for (const reach of reachesOf(scope)) deleted += await reconcile(deps, reach);
  return deleted;
}

async function reconcile(deps: PublicPhotoDeps, reach: Reach): Promise<number> {
  const deleted = await deleteStale(deps, reach.copies);
  if (deps.isPublishing) await copyOwed(deps, reach.kits);
  return deleted;
}

/**
 * Deletes the copies in reach that the rule no longer admits, the object
 * before its row. Returns how many went.
 */
async function deleteStale(
  deps: PublicPhotoDeps,
  copies: SQL | undefined,
): Promise<number> {
  const stale = await deps.db
    .select({ key: publicPhotos.key, photoId: publicPhotos.photoId })
    .from(publicPhotos)
    .where(and(copies, noLongerPublic()))
    .limit(COPIES_PER_PASS);
  let deleted = 0;
  for (const copy of stale) {
    if (await didSettle(deps, copy.photoId, () => withdraw(deps, copy.key))) {
      deleted += 1;
    }
  }
  return deleted;
}

/**
 * The object, then the row that names it: a failure between leaves a row
 * naming nothing, which the next pass deletes again.
 */
async function withdraw(deps: PublicPhotoDeps, key: string): Promise<void> {
  await deps.bucket.delete(key);
  await deps.db.delete(publicPhotos).where(eq(publicPhotos.key, key));
}

/**
 * Copies the screened photos on public kits in reach that have no copy
 * yet, or whose copy was claimed and never landed.
 */
async function copyOwed(
  deps: PublicPhotoDeps,
  kits: SQL | undefined,
): Promise<void> {
  const owed = await deps.db
    .select({
      photoId: entryPhotos.id,
      entryId: entryPhotos.entryId,
      userId: outfitEntries.userId,
      photoKey: entryPhotos.photoKey,
      key: publicPhotos.key,
    })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .leftJoin(publicPhotos, eq(publicPhotos.photoId, entryPhotos.id))
    .where(
      and(
        kits,
        eq(entryPhotos.screenStatus, publicPhotoStatus),
        worldVisibleEntry(),
        isNull(publicPhotos.publishedAt),
      ),
    )
    .limit(COPIES_PER_PASS);
  for (const photo of owed) {
    await didSettle(deps, photo.photoId, () => copy(deps, photo));
  }
}

/**
A photo owed a copy: its row, its kit's runner, and any key already claimed.
*/
interface Owed {
  readonly photoId: string;
  readonly entryId: string;
  readonly userId: string;
  readonly photoKey: string;
  readonly key: string | null;
}

/**
 * Claim a key (or keep the one already claimed), put the bytes under it
 * with the copy's own `Cache-Control`, then mark it landed — only while
 * the rule still admits it. A kit taken back while the bytes were in
 * flight finds no row to mark, and the copy is withdrawn at once.
 */
async function copy(deps: PublicPhotoDeps, photo: Owed): Promise<void> {
  const key = photo.key ?? (await claim(deps, photo));
  const object = await deps.media.get(photo.photoKey);
  if (object === null) throw new Error("photo object missing");
  await deps.bucket.put(key, await object.arrayBuffer(), {
    httpMetadata: {
      ...object.httpMetadata,
      cacheControl: PUBLIC_PHOTO_CACHE_CONTROL,
    },
  });
  const landed = await deps.db
    .update(publicPhotos)
    .set({ publishedAt: nowSeconds() })
    .where(and(eq(publicPhotos.key, key), stillPublic()))
    .returning({ key: publicPhotos.key });
  if (landed.length === 0) await withdraw(deps, key);
}

/**
 * The row before the object (claim, then work): one per photo, so two
 * passes copying the same photo share one key — the second gets the
 * first's back, and both put the same bytes under it.
 */
async function claim(deps: PublicPhotoDeps, photo: Owed): Promise<string> {
  const claimed = await deps.db
    .insert(publicPhotos)
    .values({
      key: deps.newKey(),
      photoId: photo.photoId,
      entryId: photo.entryId,
      userId: photo.userId,
      createdAt: nowSeconds(),
    })
    .onConflictDoUpdate({
      target: publicPhotos.photoId,
      set: { photoId: photo.photoId },
    })
    .returning({ key: publicPhotos.key })
    // One row, inserted or kept: the statement cannot return none.
    .get();
  return claimed.key;
}

/**
 * Runs one copy's work; a failure is reported with the photo's id and the
 * pass goes on. Whether it went through.
 */
async function didSettle(
  deps: PublicPhotoDeps,
  photoId: string,
  work: () => Promise<void>,
): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error: unknown) {
    deps.report(error, { photoId });
    return false;
  }
}

/**
What the hourly sweep found to fix: both are a fast path that missed.
*/
export interface SweepFound {
  /**
  Copies still up after their photo or kit stopped being public.
  */
  readonly stale: number;
  /**
  Objects in the bucket no row named.
  */
  readonly unnamed: number;
}

/**
 * The hourly sweep: the reconcile over everything (bounded per pass), then
 * every object in the bucket no row names — a copy whose Worker died
 * between the put and the row's delete, or whose claim lost a race.
 */
export async function sweepPublicPhotos(
  deps: PublicPhotoDeps,
): Promise<SweepFound> {
  const stale = await reconcile(deps, {});
  return { stale, unnamed: await deleteUnnamed(deps) };
}

/**
 * Every page of the bucket's listing from `options`' cursor on, each
 * page's unnamed objects deleted. Returns how many went.
 */
async function deleteUnnamed(
  deps: PublicPhotoDeps,
  options: R2ListOptions = {},
): Promise<number> {
  const page = await deps.bucket.list(options);
  const unnamed = await deleteUnnamedOf(
    deps,
    page.objects.map((object) => object.key),
  );
  return page.truncated
    ? unnamed + (await deleteUnnamed(deps, { cursor: page.cursor }))
    : unnamed;
}

/**
 * One listing page's keys: the rows naming them are read an `IN` list at
 * a time, and every key no row names is deleted in one call.
 */
async function deleteUnnamedOf(
  deps: PublicPhotoDeps,
  keys: readonly string[],
): Promise<number> {
  const rows = await readInChunks(keys, (chunk) =>
    deps.db
      .select({ key: publicPhotos.key })
      .from(publicPhotos)
      .where(inArray(publicPhotos.key, chunk)),
  );
  const named = new Set(rows.map((row) => row.key));
  const unnamed = keys.filter((key) => !named.has(key));
  await deps.bucket.delete(unnamed);
  return unnamed.length;
}

/**
 * The switch (proposal 160, phase 4): `PUBLIC_PHOTOS_ORIGIN`, set once the
 * bucket, its domain and the scanning tool are live. Unset or empty, no
 * copy is made and the page shows none; deleting goes on regardless.
 */
export function publicPhotosOrigin(
  origin: string | undefined,
): string | undefined {
  return origin === "" ? undefined : origin;
}

/**
 * The Worker's own: the primary, the two buckets, the switch, Sentry.
 * `configured` is the switch's value, the Worker's unless a test names
 * another.
 */
export function workerPublicPhotos(
  configured: string | undefined = env.PUBLIC_PHOTOS_ORIGIN,
): PublicPhotoDeps {
  return {
    db: primaryCoreDb(),
    media: env.MEDIA,
    bucket: env.PUBLIC_PHOTOS,
    isPublishing: publicPhotosOrigin(configured) !== undefined,
    newKey: newPublicPhotoKey,
    report: captureException,
  };
}

/**
 * The fast path: syncs `scope` in the background, after the write that
 * asked, kept alive past the response. Nothing in scope, nothing runs. A
 * read that fails is reported, and the sweep is its retry.
 */
export function syncPublicPhotosLater(
  scope: TaggedScope,
  keepAlive: KeepAlive = waitUntil,
  deps: () => PublicPhotoDeps = workerPublicPhotos,
): void {
  if (scope.entryIds.length + scope.runnerIds.length === 0) return;
  keepAlive(syncReported(deps(), scope));
}

/**
`syncPublicPhotos`, never rejecting: a failure is reported instead.
*/
async function syncReported(
  deps: PublicPhotoDeps,
  scope: TaggedScope,
): Promise<void> {
  try {
    await syncPublicPhotos(deps, scope);
  } catch (error: unknown) {
    deps.report(error, { scope: "public photos" });
  }
}

/**
 * The page's photos (`/k/<id>`): the URLs of a kit's copies that have
 * landed, in the kit's order, while each photo is still screened. None
 * when the switch is off. The kit itself was read through
 * `worldVisibleEntry()` by the caller. `configured` is the switch's
 * value, the Worker's own unless a test names another.
 */
export async function publishedPhotoUrls(
  db: Db,
  entryId: string,
  configured: string | undefined = env.PUBLIC_PHOTOS_ORIGIN,
): Promise<string[]> {
  const copies = await landedCopies(db, [entryId], configured);
  return copies.map((copy) => copy.url);
}

/**
 * The profile's kit rows (`/@handle`, round 41 #86d): each kit's first
 * landed copy, by the page's own read, keyed by the kit. A kit with none
 * is absent, and every kit is when the switch is off. The kits were read
 * through `worldVisibleEntry()` by the caller.
 */
export async function firstPublishedPhotos(
  db: Db,
  entryIds: readonly string[],
  configured: string | undefined = env.PUBLIC_PHOTOS_ORIGIN,
): Promise<Map<string, string>> {
  const copies = await landedCopies(db, entryIds, configured);
  const first = new Map<string, string>();
  for (const copy of copies) {
    if (!first.has(copy.entryId)) first.set(copy.entryId, copy.url);
  }
  return first;
}

/**
A served copy: landed, of a screened photo on one of these kits.
*/
function served(entryIds: string[]): SQL | undefined {
  return and(
    inArray(entryPhotos.entryId, entryIds),
    eq(entryPhotos.screenStatus, publicPhotoStatus),
    isNotNull(publicPhotos.publishedAt),
  );
}

/**
 * The landed copies of these kits' screened photos as served, in each
 * kit's order, an `IN` list at a time: what `/k` and `/@handle` both show.
 */
async function landedCopies(
  db: Db,
  entryIds: readonly string[],
  configured: string | undefined,
): Promise<{ readonly entryId: string; readonly url: string }[]> {
  const origin = publicPhotosOrigin(configured);
  if (origin === undefined) return [];
  const rows = await readInChunks(entryIds, (chunk) =>
    db
      .select({ entryId: entryPhotos.entryId, key: publicPhotos.key })
      .from(publicPhotos)
      .innerJoin(entryPhotos, eq(entryPhotos.id, publicPhotos.photoId))
      .where(served(chunk))
      .orderBy(asc(entryPhotos.position)),
  );
  return rows.map((row) => ({
    entryId: row.entryId,
    url: publicPhotoUrl(origin, row.key),
  }));
}
