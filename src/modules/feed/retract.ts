/**
 * Taking back what you posted (task 128 · SAF-3, audit 0.9 and §2.5): an
 * entry, one photo on it, or a run and everything hung on it.
 *
 * **Claim, then delete — D1 first, the bytes owed.** R2 and D1 cannot be
 * one transaction (law 8c), so every row goes in one `db.batch()` with an
 * `outbox` row owing R2 a reconcile. They commit together or not at all: a
 * failed batch leaves everything whole, and a committed one always leaves
 * the bytes owed. The fast path clears them straight after; if R2 fails,
 * the delete has still happened — it is gone from every screen — and the
 * daily drainer finishes it (law 5). The other order would leave rows
 * naming objects that are gone.
 *
 * **Sized for "all of a runner's"** (the shared packet's seam 4): account
 * deletion (126 · ACC-9) calls `deleteRuns(db, userId, "all")` and
 * `retractEntries(db, userId, "all")` rather than writing a second delete.
 * Every statement scopes by the runner in SQL, so a list naming someone
 * else's row deletes nothing of theirs.
 *
 * **Why runs are deleted here and not in `modules/runs`.** The packet
 * named `runs/delete-run.ts`, and it cannot exist as an export: `ops`
 * imports the runs barrel for its queue consumer, and anything the runs
 * barrel exports that reaches `ops` — as the outbox fast path must — is a
 * cycle dependency-cruiser refuses. The feed already reads `runs` for every
 * card it draws, and a run's deletion is mostly its entry's.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  entryTags,
  imports,
  notifications,
  outfitEntries,
  outfitEntryItems,
  reactions,
  runs,
} from "../../db/schema-core";
import { WORLD_AUDIENCE } from "../../lib/contracts";
import { NotFoundError } from "../../lib/errors";
import { ulidSchema } from "../../lib/ids";
import {
  kitCacheTags,
  runnerCacheTag,
  type PurgeTags,
} from "../../lib/cache-tags";
import { columnWhere, firstRowWhere } from "../../lib/sql/keyed-read";
import {
  captureException,
  outboxInsert,
  oweOutbox,
  purgePublicPages,
  settleOutbox,
} from "../ops";
import { screeningDeletes, settleOpenReviews } from "../safety";

type Db = ReturnType<typeof drizzle>;
export type Report = typeof captureException;
type Debt = ReturnType<typeof oweOutbox>;
export type Statements = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/**
The one photo to delete, by the id its key ends in.
*/
export const photoIdInput = z.object({ photoId: ulidSchema });

/**
Everything of a runner's, or these ids of theirs.
*/
export type Scope = "all" | readonly string[];

/**
 * The rows of `table` that are the runner's and in scope, as a subquery —
 * never read into memory, so "all" is the same one statement for a runner
 * with ten thousand entries as for one with one.
 */
export function owned(
  db: Db,
  table: typeof outfitEntries | typeof runs,
  userId: string,
  scope: Scope,
) {
  return db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.userId, userId),
        scope === "all" ? undefined : inArray(table.id, [...scope]),
      ),
    );
}

/**
 * What deleting these entries writes, for a caller to put in its batch.
 *
 * The order is load-bearing: every statement finds its rows through the
 * entries (and the photos) still being there, so the photo reviews go
 * before the photos and the entries go last. Reports filed against the
 * entries stay — they are what someone said — and the settled review row
 * is what stops the sweep queueing them again.
 */
export function entryStatements(
  db: Db,
  userId: string,
  entries: ReturnType<typeof owned>,
  settledBy: string = userId,
): Statements {
  const photos = db
    .select({ id: entryPhotos.id })
    .from(entryPhotos)
    .where(inArray(entryPhotos.entryId, entries));
  return [
    settleOpenReviews(db, "photo", photos, settledBy),
    settleOpenReviews(db, "entry", entries, settledBy),
    db
      .delete(outfitEntryItems)
      .where(inArray(outfitEntryItems.entryId, entries)),
    db.delete(entryTags).where(inArray(entryTags.entryId, entries)),
    db.delete(reactions).where(inArray(reactions.entryId, entries)),
    // Before the photos, which are how they are found (design 157).
    screeningDeletes(db, "entry", photos),
    db.delete(entryPhotos).where(inArray(entryPhotos.entryId, entries)),
    // The verdict prompt's row names the entry, the kit reminder's names
    // the run; nothing else of the runner's names either.
    deleteNotificationsAbout(db, userId, entries),
    db.delete(outfitEntries).where(inArray(outfitEntries.id, entries)),
  ];
}

function deleteNotificationsAbout(
  db: Db,
  userId: string,
  subjects: ReturnType<typeof owned>,
) {
  return db.delete(notifications).where(
    and(
      eq(notifications.userId, userId),
      inArray(notifications.subjectId, subjects),
      // The Desk's notice that it took this down stays: a copyright
      // hold's purge deletes the entry 30 days after telling its author
      // (D-130), and the telling is not undone by it.
      ne(notifications.kind, "content_removed"),
    ),
  );
}

/**
 * One reconcile per entry named, or one for the runner's whole prefix.
 * An entry id that turns out not to be theirs costs one empty listing.
 */
export function mediaDebts(userId: string, scope: Scope): Debt[] {
  return scope === "all"
    ? [oweOutbox({ kind: "entry_media_delete", payload: { userId } })]
    : scope.map((entryId) =>
        oweOutbox({ kind: "entry_media_delete", payload: { userId, entryId } }),
      );
}

/**
The batch, then the fast path for each debt.
*/
export async function commit(
  db: Db,
  statements: Statements,
  debts: readonly Debt[],
  report: Report,
): Promise<void> {
  await db.batch([...statements, ...debts.map((d) => outboxInsert(db, d))]);
  for (const debt of debts) await settleOutbox(db, debt, report);
}

/**
 * What deleting a runner's kits purges from the edge (design 163): every
 * page of theirs for "all" (account deletion's purge), else each kit's own
 * page and their profile, which lists it. Nothing when no kit goes — a run
 * with no kit had no page. One purge either way, never one per kit.
 */
export function deletionCacheTags(
  userId: string,
  entries: "all" | readonly string[],
): string[] {
  if (entries === "all") return [runnerCacheTag(userId)];
  return [...new Set(entries.flatMap((id) => kitCacheTags(userId, id)))];
}

/**
 * The frame every scope-taking delete shares: resolve `scope` to the
 * runner's own rows in `table`, hand them to `build` (which may itself read
 * before it can say what to write — a batch cannot branch on its own
 * results), commit whatever it returns, then purge the tags it names.
 *
 * Extracted from `retractEntries` and `deleteRuns`, which used to repeat
 * this frame around bodies that otherwise differ completely — one reads
 * nothing further, the other reads runs, imports and every entry hung on
 * them before it can build its statements.
 */
async function retractScoped(
  db: Db,
  table: typeof outfitEntries | typeof runs,
  userId: string,
  scope: Scope,
  effects: { readonly report: Report; readonly purge: PurgeTags },
  build: (rows: ReturnType<typeof owned>) => Promise<{
    statements: Statements;
    debts: readonly Debt[];
    tags: readonly string[];
  }>,
): Promise<void> {
  const rows = owned(db, table, userId, scope);
  const { statements, debts, tags } = await build(rows);
  await commit(db, statements, debts, effects.report);
  effects.purge(tags);
}

/**
Deletes a runner's entries — all of them, or the ones named.
*/
export async function retractEntries(
  db: Db,
  userId: string,
  scope: Scope,
  report: Report = captureException,
  purge: PurgeTags = purgePublicPages,
): Promise<void> {
  await retractScoped(
    db,
    outfitEntries,
    userId,
    scope,
    { report, purge },
    (entries) =>
      Promise.resolve({
        statements: entryStatements(db, userId, entries),
        debts: mediaDebts(userId, scope),
        tags: deletionCacheTags(userId, scope),
      }),
  );
}

/**
 * The row a single-item delete is about, or the reason there isn't one: a
 * missing id and someone else's answer the same "not found" — a 403 would
 * confirm the row exists. Called from `retractOne`, which every
 * `retractOneOf` instance (`retractEntry`, `deleteRun`) shares.
 */
async function assertOwned(
  db: Db,
  table: typeof outfitEntries | typeof runs,
  userId: string,
  id: string,
  notFoundMessage: string,
): Promise<void> {
  const [row] = await owned(db, table, userId, [id]).limit(1);
  if (row === undefined) throw new NotFoundError(notFoundMessage);
}

/**
 * One row, the runner's own, then the scoped delete that does the rest. A
 * missing row and somebody else's answer the same "not found" — a 403
 * would confirm the row exists. Called through `retractOneOf`, which fixes
 * the table, the message and the scoped delete for a given single-row entry
 * point (`retractEntry`, `deleteRun`).
 */
async function retractOne(
  db: Db,
  table: typeof outfitEntries | typeof runs,
  userId: string,
  id: string,
  notFoundMessage: string,
  effects: { readonly report: Report; readonly purge: PurgeTags },
  deleteScoped: ScopedDelete,
): Promise<void> {
  await assertOwned(db, table, userId, id, notFoundMessage);
  await deleteScoped(db, userId, [id], effects.report, effects.purge);
}

/**
`retractEntries` or `deleteRuns`: a runner's rows in a scope, deleted.
*/
type ScopedDelete = (
  db: Db,
  userId: string,
  scope: Scope,
  report: Report,
  purge: PurgeTags,
) => Promise<void>;

/**
 * `retractOne`, fixed to one table, message and scoped delete — so a
 * single-row entry point is one line naming what it is, not a whole
 * function body repeating `retractOne`'s call shape. `retractEntry` and
 * `deleteRun` used to be that repeat, differing only in the table, the id,
 * the sentence and which scoped delete follows; now there is one shape for
 * "one row of a runner's, or not found" and two names for it.
 */
function retractOneOf(
  table: typeof outfitEntries | typeof runs,
  notFoundMessage: string,
  deleteScoped: ScopedDelete,
): (
  db: Db,
  userId: string,
  id: string,
  report?: Report,
  purge?: PurgeTags,
) => Promise<void> {
  return (
    db,
    userId,
    id,
    report = captureException,
    purge = purgePublicPages,
  ) =>
    retractOne(
      db,
      table,
      userId,
      id,
      notFoundMessage,
      { report, purge },
      deleteScoped,
    );
}

/**
 * One entry, the runner's own. A missing entry and somebody else's answer
 * the same "not found" — a 403 would confirm the entry exists.
 */
export const retractEntry = retractOneOf(
  outfitEntries,
  "entry not found",
  retractEntries,
);

/**
 * One photo off one of the runner's entries. The row goes with its open
 * review, and the entry's prefix is owed a reconcile, which deletes this
 * object and keeps the photos still named. On a PUBLIC kit, its page is
 * purged, and with it the photo's public copy (design 163 step 8); a kit
 * that is not PUBLIC has neither.
 */
export async function deleteEntryPhoto(
  db: Db,
  userId: string,
  photoId: string,
  report: Report = captureException,
  purge: PurgeTags = purgePublicPages,
): Promise<void> {
  // The kit the photo is on, if it is the runner's: a missing photo and
  // one on someone else's kit answer the same.
  const kitOfPhoto = db
    .select({ id: entryPhotos.entryId })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
  const entry = await firstRowWhere(
    db,
    outfitEntries,
    and(
      eq(outfitEntries.userId, userId),
      inArray(outfitEntries.id, kitOfPhoto),
    ),
  );
  if (entry === undefined) throw new NotFoundError("photo not found");
  const photo = { entryId: entry.id, audience: entry.audience };
  await commit(
    db,
    [
      settleOpenReviews(db, "photo", [photoId], userId),
      screeningDeletes(db, "entry", [photoId]),
      db.delete(entryPhotos).where(eq(entryPhotos.id, photoId)),
    ],
    mediaDebts(userId, [photo.entryId]),
    report,
  );
  if (photo.audience === WORLD_AUDIENCE) {
    purge(kitCacheTags(userId, photo.entryId));
  }
}

/**
 * Deletes a runner's runs — all, or the ones named — with everything hung
 * on them.
 *
 * **The entry goes with its run** (the packet's product default): an entry
 * is a kit attached to a run, and a verdict with no conditions and no date
 * answers nothing. **So does the uploaded file**: a run imported from a GPX
 * or FIT file left the track in `IMPORTS`, and a track is the route a
 * runner ran from their door. **So does a runner-set band** (C1): its
 * `manual_conditions` row, keyed by run id, is in `DIALED_WEATHER`, a
 * second database no batch here can reach (law 8c), so each run named is
 * owed a `manual_conditions_delete` in the batch that deletes it. "All"
 * owes none: only account deletion's purge (126 · ACC-9) asks for all, and
 * it sweeps that database itself, before the runs that name the bands go.
 *
 * Reads go first, because a batch cannot branch on its own results: the
 * entries (each is owed its prefix), the uploads (each is owed its object,
 * and the row that names it is deleted in the batch) and the runs named
 * that are the runner's (each is owed its band — a band is found by run id
 * alone, so an id of someone else's must never be owed one).
 */
export async function deleteRuns(
  db: Db,
  userId: string,
  scope: Scope,
  report: Report = captureException,
  purge: PurgeTags = purgePublicPages,
): Promise<void> {
  const effects = { report, purge };
  await retractScoped(db, runs, userId, scope, effects, async (ownedRuns) => {
    const entryIds = await columnWhere(
      db,
      outfitEntries,
      outfitEntries.id,
      and(
        eq(outfitEntries.userId, userId),
        inArray(outfitEntries.runId, ownedRuns),
      ),
    );
    const ofTheseRuns = and(
      eq(imports.userId, userId),
      inArray(imports.runId, ownedRuns),
    );
    const uploads = await db
      .select({ key: imports.r2Key })
      .from(imports)
      .where(ofTheseRuns);
    // Every entry hangs on a run of the same runner's, so "all runs" is
    // "all entries" — and saying so keeps the statement to one parameter,
    // where a list of every id would pass D1's hundred-parameter cap for
    // anyone who has logged a hundred runs.
    const entryScope: Scope = scope === "all" ? "all" : entryIds;
    const bandRuns = scope === "all" ? [] : await ownedRuns;
    return {
      statements: [
        ...entryStatements(
          db,
          userId,
          owned(db, outfitEntries, userId, entryScope),
        ),
        deleteNotificationsAbout(db, userId, ownedRuns),
        db.delete(imports).where(ofTheseRuns),
        db.delete(runs).where(inArray(runs.id, ownedRuns)),
      ],
      debts: [
        ...mediaDebts(userId, entryScope),
        ...uploads.map((upload) =>
          oweOutbox({
            kind: "import_file_delete",
            payload: { userId, key: upload.key },
          }),
        ),
        ...bandRuns.map((run) =>
          oweOutbox({
            kind: "manual_conditions_delete",
            payload: { userId, runId: run.id },
          }),
        ),
      ],
      tags: deletionCacheTags(userId, entryScope),
    };
  });
}

/**
One run, the runner's own; "not found" for anyone else's.
*/
export const deleteRun = retractOneOf(runs, "run not found", deleteRuns);
