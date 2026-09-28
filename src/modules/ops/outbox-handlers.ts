/**
 * What each outbox kind does when it is drained — or run as a fast path
 * straight after the write that owed it.
 *
 * Every handler is idempotent (law 1): a row is at-least-once, so a run
 * that half-finished, or finished and failed to delete its row, is simply
 * run again.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { entryPhotos, outbox, wardrobeItems } from "../../db/schema-core";
import { env } from "../../env";
import { readInChunks } from "../../lib/chunked";
import { entryPhotoIdOf, entryPhotoPrefix } from "../../lib/entry-photo-key";
import { photoKeyFor } from "../../lib/garment-photo-key";
import type { OutboxKind, OutboxMessage } from "../../lib/outbox";
import { nowSeconds } from "../../lib/now";
import { deliverOwedEmail, emailDepsFromEnv, type EmailDeps } from "../email";

type Db = ReturnType<typeof drizzle>;

type PayloadOf<K extends OutboxKind> = Extract<
  OutboxMessage,
  { kind: K }
>["payload"];

export type OutboxHandlers = {
  readonly [K in OutboxKind]: {
    /**
     * Does the work; throws when it could not, and the row stays owed.
     * `rowId` is the row being worked, for a handler that must mark it
     * before the delete (an email, once sent).
     */
    readonly run: (
      db: Db,
      payload: PayloadOf<K>,
      rowId: string,
    ) => Promise<void>;
    /**
    Sentry context for a failure (law 7): ids to act on, never secrets.
    */
    readonly context: (payload: PayloadOf<K>) => Record<string, string>;
  };
};

/**
 * One message, bound to its kind's handler.
 *
 * Generic over the kind so the compiler can see that a message's payload
 * is its own handler's: indexing the map with a message of the whole
 * union reads every handler's payload type at once, and no payload is all
 * of them.
 */
export function boundHandler<K extends OutboxKind>(
  handlers: OutboxHandlers,
  message: { readonly kind: K; readonly payload: PayloadOf<K> },
): {
  run: (db: Db, rowId: string) => Promise<void>;
  context: () => Record<string, string>;
} {
  const handler = handlers[message.kind];
  return {
    run: (db, rowId) => handler.run(db, message.payload, rowId),
    context: () => handler.context(message.payload),
  };
}

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
 * cursor is exercised without writing a thousand objects.
 */
export async function reconcileItemPhotos(
  db: Db,
  userId: string,
  itemId: string,
  pageSize = 1000,
): Promise<void> {
  const options: R2ListOptions = {
    prefix: `${photoKeyFor(userId, itemId)}/`,
    limit: pageSize,
  };
  for (;;) {
    const page = await env.MEDIA.list(options);
    const live = await livePhotoKey(db, userId, itemId);
    await env.MEDIA.delete(
      page.objects
        .map((object) => object.key)
        .filter((key) => !isLiveObject(key, live)),
    );
    if (!page.truncated) return;
    options.cursor = page.cursor;
  }
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
 * An owed email (task 126, ACC-2). A send is at-least-once like every
 * handler here, and the sender has no idempotency key, so two things stand
 * in for one: the debt's own `Message-ID` on every attempt
 * (`deliverOwedEmail`), and the row marked sent — `sent_at` and the
 * sender's id, in one statement — the moment the send lands. A Worker
 * that dies before the delete leaves a row the drain deletes rather than
 * sends again. `deps` is a parameter so a test hands in a fake sender.
 */
export function emailHandler(deps: () => EmailDeps): OutboxHandlers["email"] {
  return {
    run: async (db, payload, rowId) => {
      const sent = await deliverOwedEmail(
        db,
        payload.email,
        payload.dedupeKey,
        deps(),
      );
      if (sent.status === "skipped") return;
      await db
        .update(outbox)
        .set({ sentAt: nowSeconds(), messageId: sent.messageId })
        .where(eq(outbox.id, rowId));
    },
    // Ids only (law 7): never the address, which is what a report would
    // otherwise carry.
    context: (payload) => ({
      dedupeKey: payload.dedupeKey,
      template: payload.email.template.kind,
    }),
  };
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
): Promise<void> {
  const options: R2ListOptions = {
    prefix: entryPhotoPrefix(userId, entryId),
    limit: pageSize,
  };
  for (;;) {
    const page = await env.MEDIA.list(options);
    const keys = page.objects.map((object) => object.key);
    const live = await liveEntryPhotoKeys(db, keys);
    await env.MEDIA.delete(keys.filter((key) => !live.has(key)));
    if (!page.truncated) return;
    options.cursor = page.cursor;
  }
}

export const outboxHandlers: OutboxHandlers = {
  photo_delete: {
    run: (db, payload) =>
      reconcileItemPhotos(db, payload.userId, payload.itemId),
    context: (payload) => ({
      userId: payload.userId,
      itemId: payload.itemId,
    }),
  },
  entry_media_delete: {
    run: (db, payload) =>
      reconcileEntryPhotos(db, payload.userId, payload.entryId),
    context: (payload) => ({
      userId: payload.userId,
      entryId: payload.entryId ?? "*",
    }),
  },
  // Deleting a missing key is not an error in R2, so a repeat is a no-op.
  import_file_delete: {
    run: async (_db, payload) => {
      await env.IMPORTS.delete(payload.key);
    },
    // The key names the runner and the upload's id; it carries no content.
    context: (payload) => ({ userId: payload.userId, key: payload.key }),
  },
  // Task 126 (ACC-2): an owed email (`emailHandler`).
  email: emailHandler(emailDepsFromEnv),
};
