/**
 * The handlers whose work is R2's alone: a garment's photos, an entry's
 * media and an uploaded run file. They need nothing but `env`, so they
 * live beside the outbox (design 256); every other kind's handler lives
 * with the module it touches.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { entryPhotos, wardrobeItems } from "../../../db/schema-core";
import { env } from "../../../env";
import { readInChunks } from "../../../lib/chunked";
import { entryPhotoIdOf, entryPhotoPrefix } from "../../../lib/entry-photo-key";
import { photoKeyFor } from "../../../lib/garment-photo-key";
import type { OutboxHandler, OutboxHandlers } from "./handler";

type Db = ReturnType<typeof drizzle>;

/**
 * The photo the garment's row names, or undefined when it names none —
 * or when the garment is gone. Scoped by the runner as well as the item, as every
 * closet read is.
 */
async function livePhotoKey(
  db: Db,
  userId: string,
  itemId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ photoKey: wardrobeItems.photoKey })
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)))
    .limit(1);
  return rows[0]?.photoKey ?? undefined;
}

/**
 * Whether `key` is one of the live photo's own objects: directly under its
 * prefix, not nested beneath it. The nesting rule is what keeps a legacy
 * unversioned photo (`items/u/i/card.webp`, named by the row as
 * `items/u/i`) apart from the versions stored beside it
 * (`items/u/i/01V…/card.webp`), which share its prefix.
 */
export function isLiveObject(key: string, live: string | undefined): boolean {
  // Said out loud: `${undefined}/` is a real string, and a key that
  // happened to start with it would otherwise be kept as though a row had
  // named it.
  if (live === undefined) return false;
  const own = `${live}/`;
  return key.startsWith(own) && !key.slice(own.length).includes("/");
}

/**
 * The most pages one listing reads (1,000 objects each) before it stops.
 * A garment's photos are one page; the largest real listing is a runner's
 * every entry photo when the account goes, about 70 pages for three kits a
 * day for five years with four photos each in their sizes. A thousand
 * pages is a million objects, far past any runner, and keeps a listing
 * that never ends (a cursor that does not advance) from running forever.
 */
const MAX_LIST_PAGES = 1000;

/**
 * Hands each page of `MEDIA`'s listing to `handle`, following the cursor.
 * Past `maxPages` it throws, so the outbox row stays owed and the drain
 * reports it (its retry and Sentry) rather than looping on.
 */
async function forEachPage(
  options: R2ListOptions,
  maxPages: number,
  handle: (page: R2Objects) => Promise<void>,
): Promise<void> {
  const listing: R2ListOptions = { ...options };
  for (let pages = 0; pages < maxPages; pages += 1) {
    const page = await env.MEDIA.list(listing);
    await handle(page);
    if (!page.truncated) return;
    listing.cursor = page.cursor;
  }
  throw new Error(
    `listed ${String(maxPages)} pages under one prefix without reaching its end`,
  );
}

/**
 * Bring a garment's R2 prefix into line with its row: delete every object
 * there except the photo the row names. One operation for all three debts
 * — Remove (the row names nothing), Delete (there is no row), Replace (the
 * row names the new version) — because each is "the prefix holds more
 * than the row says".
 *
 * **Listed, not named**, because nothing records what a prefix holds: the
 * row forgot the old version in the same batch that owed this, and the
 * original's extension was never stored at all. A second run is a no-op.
 *
 * The row is read after each page is listed, never before. An upload puts
 * its objects first and names them in the row last, so an upload that
 * finished while this listed is kept. One narrow race is left, and it is
 * accepted: objects listed while an upload is still between its puts and
 * its row write are deleted, and that photo shows broken until the runner
 * uploads it again. It needs a second upload to the same garment in the
 * seconds this runs; the alternative, holding back recent objects, would
 * leave a photo the runner just removed in storage until the next drain.
 *
 * `pageSize` is R2's own cap by default; a test passes a small one so the
 * cursor is exercised without writing a thousand objects, and a small
 * `maxPages` to reach the cap (`forEachPage`).
 */
export async function reconcileItemPhotos(
  db: Db,
  userId: string,
  itemId: string,
  pageSize = 1000,
  maxPages = MAX_LIST_PAGES,
): Promise<void> {
  const prefix = `${photoKeyFor(userId, itemId)}/`;
  await forEachPage({ prefix, limit: pageSize }, maxPages, async (page) => {
    const live = await livePhotoKey(db, userId, itemId);
    await env.MEDIA.delete(
      page.objects
        .map((object) => object.key)
        .filter((key) => !isLiveObject(key, live)),
    );
  });
}

/**
 * Which of these keys an `entry_photos` row still names. Found by the
 * photo id each key ends in — a primary-key lookup, since the table has no
 * index on `photo_key` — then compared on the whole key, so an object that
 * merely shares an id with a live row under another prefix is not kept.
 */
async function liveEntryPhotoKeys(
  db: Db,
  keys: readonly string[],
): Promise<Set<string>> {
  const rows = await readInChunks(
    keys.map((key) => entryPhotoIdOf(key)),
    (chunk) =>
      db
        .select({ photoKey: entryPhotos.photoKey })
        .from(entryPhotos)
        .where(inArray(entryPhotos.id, chunk)),
  );
  return new Set(rows.map((row) => row.photoKey));
}

/**
 * Bring an entry's R2 prefix — or, with no entry, all of a runner's — into
 * line with the `entry_photos` rows (task 128 · SAF-3): delete every object
 * no row names. One operation for an entry deleted (no rows), a photo
 * deleted (the rest still named) and account deletion (the whole prefix).
 *
 * Listed rather than named, for `reconcileItemPhotos`'s reason: the rows
 * that named the objects went in the same batch that owed this. The rows
 * are read after each page is listed, so an upload that finished while
 * this listed is kept; one still between its put and its row write is
 * not, and the runner uploads it again — the same accepted race as the
 * garment path, and only reachable on an entry being deleted.
 */
export async function reconcileEntryPhotos(
  db: Db,
  userId: string,
  entryId: string | undefined,
  pageSize = 1000,
  maxPages = MAX_LIST_PAGES,
): Promise<void> {
  const prefix = entryPhotoPrefix(userId, entryId);
  await forEachPage({ prefix, limit: pageSize }, maxPages, async (page) => {
    const keys = page.objects.map((object) => object.key);
    const live = await liveEntryPhotoKeys(db, keys);
    await env.MEDIA.delete(keys.filter((key) => !live.has(key)));
  });
}

/**
 * One uploaded run file, deleted. Deleting a missing key is not an error
 * in R2, so a repeat — or a file the account purge already took — is a
 * no-op.
 */
const importFileDeleteHandler: OutboxHandler<"import_file_delete"> = {
  run: async (_db, payload) => {
    await env.IMPORTS.delete(payload.key);
  },
  // The key names the runner and the upload's id; it carries no content.
  context: (payload) => ({ userId: payload.userId, key: payload.key }),
};

/**
A garment's prefix, brought into line with its row (`reconcileItemPhotos`).
*/
const photoDeleteHandler: OutboxHandler<"photo_delete"> = {
  run: (db, payload) => reconcileItemPhotos(db, payload.userId, payload.itemId),
  context: (payload) => ({ userId: payload.userId, itemId: payload.itemId }),
};

/**
An entry's prefix, or a runner's, brought into line (`reconcileEntryPhotos`).
*/
const entryMediaDeleteHandler: OutboxHandler<"entry_media_delete"> = {
  run: (db, payload) =>
    reconcileEntryPhotos(db, payload.userId, payload.entryId),
  context: (payload) => ({
    userId: payload.userId,
    entryId: payload.entryId ?? "*",
  }),
};

/**
The kinds whose work is R2's alone, for the dispatch's registry.
*/
export const storageHandlers = {
  photo_delete: photoDeleteHandler,
  entry_media_delete: entryMediaDeleteHandler,
  import_file_delete: importFileDeleteHandler,
  // A run file owed on a date — read (D-116), or failed 30 days ago: the
  // same delete.
  import_file_expire: importFileDeleteHandler,
} satisfies Partial<OutboxHandlers>;
