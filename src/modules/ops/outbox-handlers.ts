/**
 * What each outbox kind does when it is drained — or run as a fast path
 * straight after the write that owed it.
 *
 * Every handler is idempotent (law 1): a row is at-least-once, so a run
 * that half-finished, or finished and failed to delete its row, is simply
 * run again.
 */
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { env } from "../../env";
import { photoKeyFor } from "../../lib/garment-photo-key";
import type { OutboxKind, OutboxMessage } from "../../lib/outbox";

type Db = ReturnType<typeof drizzle>;

type PayloadOf<K extends OutboxKind> = Extract<
  OutboxMessage,
  { kind: K }
>["payload"];

export type OutboxHandlers = {
  readonly [K in OutboxKind]: {
    /**
    Does the work; throws when it could not, and the row stays owed.
    */
    readonly run: (db: Db, payload: PayloadOf<K>) => Promise<void>;
    /**
    Sentry context for a failure (law 7): ids to act on, never secrets.
    */
    readonly context: (payload: PayloadOf<K>) => Record<string, string>;
  };
};

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

export const outboxHandlers: OutboxHandlers = {
  photo_delete: {
    run: (db, payload) =>
      reconcileItemPhotos(db, payload.userId, payload.itemId),
    context: (payload) => ({
      userId: payload.userId,
      itemId: payload.itemId,
    }),
  },
};
