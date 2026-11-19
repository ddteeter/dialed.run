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
import type { OutboxKind, OutboxMessage } from "../../lib/sql/outbox";
import { nowSeconds } from "../../lib/now";
import { deliverOwedEmail, emailDepsFromEnv, type EmailDeps } from "../email";
import { isReminderStillOwed, reminderEmailSent } from "../runs";
import { mintReceiptConfirmToken } from "../safety";
import { forgetManualBand } from "../weather";

type Db = ReturnType<typeof drizzle>;

type PayloadOf<K extends OutboxKind> = Extract<
  OutboxMessage,
  { kind: K }
>["payload"];

/**
 * What a handler's run answers when it did part of the work and owes the
 * rest (design 232). Anything else it resolves to means done. A symbol,
 * so no other value a handler resolves to can be mistaken for it.
 */
export const OWED_AGAIN: unique symbol = Symbol();

/**
 * What a handler's run answers when the far side refused the work for a
 * reason this row carries with it, so no retry of the same row is likely
 * to go differently (SA-L22, design 244): an email whose address the
 * sender will not send to. The row is not settled and nothing failed in
 * the app; the drain decides how long such a row is kept. `reason` is the
 * far side's own code, never anything of the payload's (law 7).
 */
export class Refused {
  constructor(readonly reason: string) {}
}

export type OutboxHandlers = {
  readonly [K in OutboxKind]: {
    /**
     * Does the work; throws when it could not, and the row stays owed.
     * `rowId` is the row being worked, for a handler that must mark it
     * before the delete (an email, once sent). `OWED_AGAIN` says the work is
     * done in part and the rest is owed to the next drain (design 232): the
     * row stays, with its attempts back at none, since nothing failed.
     * A `Refused` says the far side will not take this row's work.
     */
    readonly run: (
      db: Db,
      payload: PayloadOf<K>,
      rowId: string,
    ) => Promise<unknown>;
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
  run: (db: Db, rowId: string) => Promise<unknown>;
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

type OwedEmailMessage = PayloadOf<"email">["email"];

/**
 * SA-L18: a removal request's receipt is owed with its request, not its
 * confirm token, and the token is minted here, as it is sent
 * (`mintReceiptConfirmToken`). A request no longer waiting on a confirm
 * gets its receipt without the link. Any other email goes as owed.
 */
async function withReceiptConfirmToken(
  db: Db,
  email: OwedEmailMessage,
): Promise<OwedEmailMessage> {
  const { template } = email;
  // Only a receipt has the field; one owed before SA-L18 carries its token
  // instead, and goes as owed.
  if (
    !("confirmRequestId" in template) ||
    template.confirmRequestId === undefined
  ) {
    return email;
  }
  const { confirmRequestId, ...rest } = template;
  const confirmToken = await mintReceiptConfirmToken(db, confirmRequestId);
  return { ...email, template: { ...rest, confirmToken } };
}

/**
 * An owed email (task 126, ACC-2). A send is at-least-once like every
 * handler here, and the sender has no idempotency key (and sets
 * `Message-ID` itself, refusing ours), so the row is marked sent —
 * `sent_at` and the sender's id, in one statement — the moment the send
 * lands. A Worker that dies before the delete leaves a row the drain
 * deletes rather than sends again. What no mark can cover is a Worker
 * that dies between the send and the mark: that email goes twice.
 * `deps` is a parameter so a test hands in a fake sender.
 *
 * A Strava reminder's email (`reminder`) is checked here, when it is due
 * rather than when it was owed — skipped if no reminder from its landing
 * on is still unread, the runner disconnected, or the day's email already
 * went — and its day is marked sent in the same batch as the row (design
 * 140), so neither a re-firing drain nor a second debt for the day can
 * send it again.
 */
export function emailHandler(deps: () => EmailDeps): OutboxHandlers["email"] {
  return {
    run: async (db, payload, rowId) => {
      // A reminder with nothing left to say — answered, disconnected, or
      // the day's already sent — settles like a skipped send: the row
      // goes, nothing is marked.
      const { reminder } = payload;
      if (
        reminder !== undefined &&
        !(await isReminderStillOwed(db, reminder))
      ) {
        return;
      }
      const sent = await deliverOwedEmail(
        db,
        await withReceiptConfirmToken(db, payload.email),
        deps(),
      );
      if (sent.status === "refused") return new Refused(sent.code);
      if (sent.status === "skipped") return;
      const sentAt = nowSeconds();
      // Due at once, too: the drain's one index range then finds a row
      // whose delete never landed, and deletes it rather than sending.
      const markSent = db
        .update(outbox)
        .set({ sentAt, nextAttemptAt: sentAt, messageId: sent.messageId })
        .where(eq(outbox.id, rowId));
      await db.batch([
        markSent,
        ...(reminder === undefined ? [] : [reminderEmailSent(db, reminder)]),
      ]);
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
const importFileDelete: OutboxHandlers["import_file_delete"] = {
  run: async (_db, payload) => {
    await env.IMPORTS.delete(payload.key);
  },
  // The key names the runner and the upload's id; it carries no content.
  context: (payload) => ({ userId: payload.userId, key: payload.key }),
};

/**
 * What links a newly confirmed runner's typed garments to the shared
 * products (design 133, decision D-113 Q1): `closet`'s
 * `linkTypedGarments`, which `ops` cannot import — `closet` imports `ops`
 * — so the Worker entry hands it to the firings (`DailyUpkeep`).
 */
export type ProductLinker = (
  db: Db,
  userId: string,
) => Promise<"linked" | "more">;

/**
 * The `product_link` handler, bound to the linker handed in. With none, it
 * fails loudly, so the row stays owed and the drain reports it, rather
 * than settling a runner's link into nothing.
 */
export function productLinkHandler(
  link: ProductLinker | undefined,
): OutboxHandlers["product_link"] {
  return {
    run: async (db, payload) => {
      if (link === undefined) {
        throw new Error("product_link drained with no linker handed in");
      }
      // A bounded run that left garments unlinked owes the rest to the
      // next drain (design 232): not a failure.
      return (await link(db, payload.userId)) === "more"
        ? OWED_AGAIN
        : undefined;
    },
    context: (payload) => ({ userId: payload.userId }),
  };
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
  import_file_delete: importFileDelete,
  // A run file owed on a date — read (D-116), or failed 30 days ago: the
  // same delete.
  import_file_expire: importFileDelete,
  // Task 126 (ACC-2): an owed email (`emailHandler`).
  email: emailHandler(emailDepsFromEnv),
  // Design 232: the operators' mail, sent as any email is.
  operator_email: emailHandler(emailDepsFromEnv),
  // Design 133 (D-113 Q1): unwired here, and wired by the firings that
  // are handed the linker (`scheduled.ts`).
  product_link: productLinkHandler(undefined),
  // C1: a deleted run's band, in the weather database. Not the core `db`
  // the drain hands in — `weather` owns that database's connection.
  manual_conditions_delete: {
    run: (_db, payload) => forgetManualBand(payload.runId),
    context: (payload) => ({ userId: payload.userId, runId: payload.runId }),
  },
};
