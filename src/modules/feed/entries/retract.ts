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
import { and, eq, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  copyrightHolds,
  entryPhotos,
  entryTags,
  imports,
  notifications,
  outfitEntries,
  outfitEntryItems,
  reactions,
  runs,
} from "../../../db/schema-core";
import { WORLD_AUDIENCE } from "../../../lib/contracts";
import { ControlRefusal } from "../../../lib/control-refusal";
import { NotFoundError } from "../../../lib/errors";
import { ulidSchema } from "../../../lib/ids";
import {
  kitCacheTags,
  runnerCacheTag,
  type PurgeTags,
} from "../../../lib/cache-tags";
import { columnWhere } from "../../../lib/sql/keyed-read";
import {
  captureException,
  outboxInsert,
  oweOutbox,
  purgePublicPages,
  settleOutbox,
  storageHandlers,
  type OutboxDebtOf,
} from "../../ops";
import { owedEmailHandlers } from "../../ops/owed-email";
import {
  screeningDeletes,
  settleOpenReviews,
  withdrawnUnderReview,
} from "../../safety";
import { manualConditionsHandler } from "../../weather";
import { clearEntryHalves, deleteRunCopies } from "../conditions";

type Db = ReturnType<typeof drizzle>;
export type Report = typeof captureException;
/**
 * What a retraction's fast path settles, keyed by kind (design 256): an
 * entry's media and a garment's photo, a run file, a run's band, and the
 * email a moderation decision sends.
 */
const settledHere = {
  ...storageHandlers,
  ...owedEmailHandlers,
  manual_conditions_delete: manualConditionsHandler,
};
type Debt = OutboxDebtOf<keyof typeof settledHere>;
export type Statements = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/**
 * `statements` with `kept` after the first, so ahead of every delete
 * (design 232): the first of a photo's or a kit's statements is a review
 * settle, which no keep depends on.
 */
function keeping(
  [first, ...rest]: Statements,
  kept: readonly BatchItem<"sqlite">[],
): Statements {
  return [first, ...kept, ...rest];
}

/**
The one photo to delete, by the id its key ends in.
*/
export const photoIdInput = z.object({ photoId: ulidSchema });

/**
Everything of a runner's, or these ids of theirs.
*/
export type Scope = "all" | readonly string[];

/**
 * The rows of `table` that are the runner's, in scope and matching `also`
 * if given, as a subquery — never read into memory, so "all" is the same
 * one statement for a runner with ten thousand entries as for one with one.
 */
export function owned(
  db: Db,
  table: typeof outfitEntries | typeof runs,
  userId: string,
  scope: Scope,
  also?: SQL,
) {
  return db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.userId, userId),
        scope === "all" ? undefined : inArray(table.id, [...scope]),
        also,
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
    // Before the entries' delete, which is how their runs are found.
    clearEntryHalves(db, entries),
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
  for (const debt of debts) await settleOutbox(db, debt, settledHere, report);
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
  return entries === "all"
    ? [runnerCacheTag(userId)]
    : [...new Set(entries.flatMap((id) => kitCacheTags(userId, id)))];
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
    async (entries) => ({
      // A photo under review keeps its fingerprint and its record
      // (design 232).
      statements: keeping(
        entryStatements(db, userId, entries),
        await withdrawnUnderReview(
          db,
          userId,
          inArray(entryPhotos.entryId, entries),
        ),
      ),
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
  held: HeldCheck,
): Promise<void> {
  await assertOwned(db, table, userId, id, notFoundMessage);
  await assertNotHeld(db, held);
  await deleteScoped(db, userId, [id], effects.report, effects.purge);
}

/**
 * SA-L09: what a live copyright hold names stays until the Desk settles
 * it ("Case over", the 30-day purge, a restore). Asked only on the
 * runner's own deletes: the hold's purge and a moderator's Remove build
 * their deletes from the same statements and must still delete.
 */
export interface HeldCheck {
  /**
  Which kits the delete would take, as a predicate on `copyright_holds.entry_id`.
  */
  entries: SQL;
  noun: "kit" | "run" | "photo";
}

/**
 * A hold's statuses while it is live: the material is hidden, or its purge
 * has started. The account purge waits on the same set.
 */
export const LIVE_HOLD = ["hidden", "purging"] as const;

async function assertNotHeld(db: Db, check: HeldCheck): Promise<void> {
  const [hold] = await db
    .select({ id: copyrightHolds.id })
    .from(copyrightHolds)
    .where(and(inArray(copyrightHolds.status, LIVE_HOLD), check.entries))
    .limit(1);
  if (hold !== undefined) {
    throw new ControlRefusal(
      `This ${check.noun} is held while a copyright claim is settled, so it can't be deleted yet.`,
    );
  }
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
  heldOf: (id: string) => HeldCheck,
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
      heldOf(id),
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
  (entryId) => ({ entries: eq(copyrightHolds.entryId, entryId), noun: "kit" }),
);

/**
 * The one entry photo a condition picks out, with the entry it is on and
 * that entry's owner and audience: the runner's own delete scopes it to them, and the
 * Desk's Clear photo to the photo still pending. The condition may name
 * `entryPhotos` and `outfitEntries` columns.
 */
export async function entryPhotoWhere(db: Db, condition: SQL | undefined) {
  const [photo] = await db
    .select({
      entryId: entryPhotos.entryId,
      ownerId: outfitEntries.userId,
      audience: outfitEntries.audience,
    })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(condition)
    .limit(1);
  return photo;
}

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
  const photo = await entryPhotoWhere(
    db,
    and(eq(entryPhotos.id, photoId), eq(outfitEntries.userId, userId)),
  );
  if (photo === undefined) throw new NotFoundError("photo not found");
  await assertNotHeld(db, {
    entries: eq(copyrightHolds.entryId, photo.entryId),
    noun: "photo",
  });
  // Read before the batch (design 232): a photo under review keeps its
  // fingerprint and its record.
  const kept = await withdrawnUnderReview(
    db,
    userId,
    eq(entryPhotos.id, photoId),
  );
  await commit(
    db,
    keeping(photoDeletion(db, photoId, userId), kept),
    mediaDebts(userId, [photo.entryId]),
    report,
  );
  if (photo.audience === WORLD_AUDIENCE) {
    purge(kitCacheTags(userId, photo.entryId));
  }
}

/**
 * One photo's rows, whoever takes it off: its open review settled by
 * `settledBy`, what the screener said of it, and the photo itself — the
 * runner's own delete, a moderator's Remove, and the Desk's Clear photo
 * on a file that is missing (D-157). The bytes are the caller's debt.
 */
export function photoDeletion(
  db: Db,
  photoId: string,
  settledBy: string,
): Statements {
  return [
    settleOpenReviews(db, "photo", [photoId], settledBy),
    screeningDeletes(db, "entry", [photoId]),
    db.delete(entryPhotos).where(eq(entryPhotos.id, photoId)),
  ];
}

/**
The runner's upload rows for these runs.
*/
function uploadsOf(userId: string, ownedRuns: ReturnType<typeof owned>) {
  return and(eq(imports.userId, userId), inArray(imports.runId, ownedRuns));
}

/**
 * What deleting these runs and these entries of theirs writes: the
 * entries with everything on them (a photo under review keeps its
 * fingerprint and its record, design 232), the runs' notifications,
 * upload rows and copies, then the runs.
 */
async function runStatements(
  db: Db,
  userId: string,
  ownedRuns: ReturnType<typeof owned>,
  theirEntries: ReturnType<typeof owned>,
): Promise<Statements> {
  return [
    ...keeping(
      entryStatements(db, userId, theirEntries),
      await withdrawnUnderReview(
        db,
        userId,
        inArray(entryPhotos.entryId, theirEntries),
      ),
    ),
    deleteNotificationsAbout(db, userId, ownedRuns),
    db.delete(imports).where(uploadsOf(userId, ownedRuns)),
    deleteRunCopies(db, ownedRuns),
    db.delete(runs).where(inArray(runs.id, ownedRuns)),
  ];
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
 * owes neither a band nor a run file: only account deletion's purge (126 ·
 * ACC-9) asks for all, and it sweeps that database itself, before the runs
 * that name the bands go, and lists the runner's run-file prefix after.
 *
 * Reads go first, because a batch cannot branch on its own results: the
 * entries (each is owed its prefix), the uploads of the runs named (each
 * is owed its object; every upload row in scope is deleted in the batch) and the runs named
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
    const entryIds =
      scope === "all"
        ? []
        : await columnWhere(
            db,
            outfitEntries,
            outfitEntries.id,
            and(
              eq(outfitEntries.userId, userId),
              inArray(outfitEntries.runId, ownedRuns),
            ),
          );
    const uploads =
      scope === "all"
        ? []
        : await db
            .select({ key: imports.r2Key })
            .from(imports)
            .where(uploadsOf(userId, ownedRuns));
    // Every entry hangs on a run of the same runner's, so "all runs" is
    // "all entries" — and saying so keeps the statement to one parameter,
    // where a list of every id would pass D1's hundred-parameter cap for
    // anyone who has logged a hundred runs.
    const entryScope: Scope = scope === "all" ? "all" : entryIds;
    const bandRuns = scope === "all" ? [] : await ownedRuns;
    const theirEntries = owned(db, outfitEntries, userId, entryScope);
    return {
      statements: await runStatements(db, userId, ownedRuns, theirEntries),
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
 * Deletes the runner's runs whose id is at most `lastRunId`, with their
 * entries and everything on them, for account deletion's purge, which
 * works through a runner's runs a page at a time. Owes nothing: the purge
 * has forgotten these runs' bands itself, lists the runner's run-file
 * prefix, and its final `deleteRuns(…, "all")` owes the runner's media
 * prefix. Their public pages are purged.
 */
export async function deleteRunsThrough(
  db: Db,
  userId: string,
  lastRunId: string,
  report: Report = captureException,
  purge: PurgeTags = purgePublicPages,
): Promise<void> {
  const ownedRuns = owned(db, runs, userId, "all", lte(runs.id, lastRunId));
  const theirEntries = owned(
    db,
    outfitEntries,
    userId,
    "all",
    inArray(outfitEntries.runId, ownedRuns),
  );
  const statements = await runStatements(db, userId, ownedRuns, theirEntries);
  await commit(db, statements, [], report);
  purge(deletionCacheTags(userId, "all"));
}

/**
One run, the runner's own; "not found" for anyone else's.
*/
export const deleteRun = retractOneOf(
  runs,
  "run not found",
  deleteRuns,
  (runId) => ({
    entries: sql`${copyrightHolds.entryId} in (select ${outfitEntries.id} from ${outfitEntries} where ${outfitEntries.runId} = ${runId})`,
    noun: "run",
  }),
);
