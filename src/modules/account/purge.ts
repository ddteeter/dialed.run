/**
 * The purge at the end of a deletion's week (task 126, ACC-9): everything
 * the account held, across both databases and R2, gone.
 *
 * **Reconciliation, not an outbox** (law 8c). The claim row in
 * `account_deletions` is already the durable "not finished" marker, and
 * the daily firing already re-runs it: each firing claims what is due
 * (law 2) and walks the steps, and every step deletes what is left — so a
 * purge that stops at any step is finished by the next firing. The claim
 * is deleted in the same batch as the `user` row, last, so a claim that
 * exists is always a purge still owed.
 *
 * **An explicit exception to "retire, don't delete".** Garments an entry
 * used are deleted too: every entry goes first, and the runner is gone.
 *
 * **Kept, on purpose**: shared `products` (their `created_by` names nobody
 * once the account is gone); reports filed *about* the runner's content
 * (SAF-3 keeps them); moderation actions and quarantined content (D-70:
 * evidence outlives the account); the reports they filed, with the
 * reporter replaced (below); the invite's use, with the address replaced;
 * and the handle, which is never released (D-56, D-72).
 *
 * Not in `./index.ts`, and called by nothing in `ops`: it calls feed's
 * delete primitives, and `feed` and `ops` both import this module's
 * barrel, so either importing this would be a cycle. The Worker entry
 * hands it to the daily firing (`handleScheduled`'s upkeep).
 */
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { account, session, user, verification } from "../../db/schema-auth";
import {
  accessRequests,
  accountDeletions,
  blocks,
  emailVerifications,
  entryPhotos,
  follows,
  imports,
  inviteRedemptions,
  notificationPreferences,
  notifications,
  outfitEntries,
  passwordAttempts,
  photoScreenings,
  reactions,
  reports,
  runs,
  stravaConnections,
  userProfiles,
  usernameHistory,
  wardrobeItems,
} from "../../db/schema-core";
import { manualConditions } from "../../db/schema-weather";
import { env } from "../../env";
import { chunked, IN_LIST_CHUNK } from "../../lib/chunked";
import { columnWhere, firstRowWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";
import { forgetSendLimits } from "../email";
import { deleteRuns } from "../feed";
import { captureException, outboxInsert, oweOutbox } from "../ops";
import { disconnectStrava } from "../runs";
import { settleOpenReviews } from "../safety";

type Db = ReturnType<typeof drizzle>;
type Report = (error: unknown, context: Record<string, string>) => void;

/**
 * Accounts one firing purges at most. A purge is a few hundred statements
 * and R2 calls for a runner with years of runs; the rest wait a day.
 */
export const PURGE_PER_FIRING = 3;

/**
 * How long a claim is held before another firing may take it over. The
 * daily firing is a day apart, so a purge that died is always retaken by
 * the next one; this only stops two overlapping firings sharing a row.
 */
export const PURGE_LEASE_S = 60 * 60;

export interface PurgeDeps {
  readonly core: Db;
  readonly weather: Db;
  /**
  Runs' `disconnectStrava`, bound to the queue (seam 5).
  */
  readonly revokeStrava: (userId: string) => Promise<void>;
  readonly report: Report;
  readonly now: number;
}

function liveDeps(): PurgeDeps {
  const core = drizzle(env.DIALED_CORE);
  return {
    core,
    weather: drizzle(env.DIALED_WEATHER),
    revokeStrava: (userId) =>
      disconnectStrava(core, env.IMPORTS_QUEUE, userId, captureException),
    report: captureException,
    now: nowSeconds(),
  };
}

/**
 * The daily firing's purge: claim what is due, purge each, and put what
 * could not finish into the digest (law 6).
 */
export async function purgeDueAccounts(
  anomalies: string[],
  deps: PurgeDeps = liveDeps(),
): Promise<void> {
  const claimed = await claimDue(deps.core, deps.now);
  let failed = 0;
  for (const userId of claimed) {
    try {
      await purgeAccount(deps, userId);
    } catch (error) {
      failed += 1;
      deps.report(error, { surface: "account-purge", userId });
    }
  }
  if (failed > 0) {
    anomalies.push(
      `${String(failed)} account deletion(s) stopped part way and are finished on the next firing`,
    );
  }
  const waiting = await deps.core.$count(accountDeletions, due(deps.now));
  if (waiting > 0) {
    anomalies.push(
      `${String(waiting)} account deletion(s) past their date wait for the next firing`,
    );
  }
}

/**
 * A claim the firing may take: past its date, and not held by a purge
 * that is still running.
 */
function due(now: number) {
  return and(
    lte(accountDeletions.purgeAfter, now),
    or(
      isNull(accountDeletions.purgeStartedAt),
      lt(accountDeletions.purgeStartedAt, now - PURGE_LEASE_S),
    ),
  );
}

/**
 * Claim, then work (law 2): only the rows this statement moved are this
 * firing's, however many firings overlap.
 */
async function claimDue(db: Db, now: number): Promise<string[]> {
  const oldest = db
    .select({ userId: accountDeletions.userId })
    .from(accountDeletions)
    .where(due(now))
    .orderBy(asc(accountDeletions.purgeAfter))
    .limit(PURGE_PER_FIRING);
  const rows = await db
    .update(accountDeletions)
    .set({ purgeStartedAt: now })
    .where(and(inArray(accountDeletions.userId, oldest), due(now)))
    .returning({ userId: accountDeletions.userId });
  return rows.map((row) => row.userId);
}

/**
 * One account, step by step. Every step reads what is left, so running
 * it again from the top after a failure at any step does only what the
 * failure left undone.
 */
export async function purgeAccount(
  deps: PurgeDeps,
  userId: string,
): Promise<void> {
  const { core, report } = deps;
  await forgetManualConditions(deps, userId);
  // Revoked before anything else of theirs goes: a connection the request
  // could not close is closed here, with the grant owed to Strava.
  await deps.revokeStrava(userId);
  await forgetScreenings(core, userId);
  // 128's SAF-3 primitive (seam 4): every run, every entry — with their
  // items, tags, reactions, photos and notifications — and the R2 owed.
  await deleteRuns(core, userId, "all", report);
  await deleteCloset(core, userId);
  await deleteAccountRows(core, userId, deps.now);
}

/**
 * The runner's own bands for their runs, in `DIALED_WEATHER` — first,
 * because once the runs are gone nothing names these rows. Two databases,
 * so this is its own write (law 8c), in chunks under D1's parameter cap.
 */
async function forgetManualConditions(
  deps: PurgeDeps,
  userId: string,
): Promise<void> {
  const runIds = await columnWhere(
    deps.core,
    runs,
    runs.id,
    eq(runs.userId, userId),
  );
  for (const chunk of chunked(runIds, IN_LIST_CHUNK)) {
    await deps.weather
      .delete(manualConditions)
      .where(inArray(manualConditions.runId, chunk));
  }
}

/**
 * An id subquery, never materialized — composed straight into the next
 * `inArray` rather than read into memory, so a runner's whole entry history
 * or closet never turns a delete into a query with as many bound parameters
 * as they have rows (D1's parameter cap).
 *
 * Named and called rather than written inline three times: three
 * near-identical `.select().from().where()` chains is the same shape a
 * clone check already flags between `retract.ts`'s `owned` and
 * `closet/service.ts`'s `deleteItem` — accidental, since each answers a
 * different question, but this file does not need to restate it thrice to
 * make that point.
 */
function idsWhere(
  db: Db,
  table: typeof outfitEntries | typeof entryPhotos | typeof wardrobeItems,
  id: SQLiteColumn,
  where: SQL,
) {
  return db.select({ id }).from(table).where(where);
}

/**
 * What the screener said about the runner's photos — entry photos and
 * garments — before the photos go, because the photos are how these rows
 * are found; and an open review of their profile, settled as removed by
 * its runner, as SAF-3 settles an entry's (a garment photo is never
 * queued).
 */
async function forgetScreenings(db: Db, userId: string): Promise<void> {
  // `theirEntries` finds the photos through the entries the runner owns,
  // since `entry_photos` carries no owner column of its own.
  const theirEntries = idsWhere(
    db,
    outfitEntries,
    outfitEntries.id,
    eq(outfitEntries.userId, userId),
  );
  const theirEntryPhotos = idsWhere(
    db,
    entryPhotos,
    entryPhotos.id,
    inArray(entryPhotos.entryId, theirEntries),
  );
  const theirGarments = idsWhere(
    db,
    wardrobeItems,
    wardrobeItems.id,
    eq(wardrobeItems.userId, userId),
  );
  const ofEntryPhotos = and(
    eq(photoScreenings.photoScope, "entry"),
    inArray(photoScreenings.photoId, theirEntryPhotos),
  );
  const ofGarments = and(
    eq(photoScreenings.photoScope, "garment"),
    inArray(photoScreenings.photoId, theirGarments),
  );
  await db.batch([
    db.delete(photoScreenings).where(or(ofEntryPhotos, ofGarments)),
    settleOpenReviews(db, "profile", [userId], userId),
  ]);
}

/**
 * The closet, and any upload that never became a run: the rows, and the
 * R2 each is owed (a garment's photo prefix, an upload's file), in one
 * batch. Left to the drain rather than sent now: a closet is dozens of
 * prefixes, and the drain clears them within days.
 */
async function deleteCloset(db: Db, userId: string): Promise<void> {
  const garments = await columnWhere(
    db,
    wardrobeItems,
    wardrobeItems.id,
    eq(wardrobeItems.userId, userId),
  );
  const uploadKeys = await columnWhere(
    db,
    imports,
    imports.r2Key,
    eq(imports.userId, userId),
  );
  const debts = [
    ...garments.map((itemId) =>
      oweOutbox({ kind: "photo_delete", payload: { userId, itemId } }),
    ),
    ...uploadKeys.map((key) =>
      oweOutbox({ kind: "import_file_delete", payload: { userId, key } }),
    ),
  ];
  await db.batch([
    db.delete(wardrobeItems).where(eq(wardrobeItems.userId, userId)),
    db.delete(imports).where(eq(imports.userId, userId)),
    ...debts.map((debt) => outboxInsert(db, debt)),
  ]);
}

/**
 * Either side of a self-referencing pair, for the tables (`follows`,
 * `blocks`) that store "who did what to whom" as two columns naming a
 * runner: leaving means every row naming them in *either* column goes.
 */
function involvingEither(
  first: SQLiteColumn,
  second: SQLiteColumn,
  userId: string,
) {
  return or(eq(first, userId), eq(second, userId));
}

/**
 * Everything else, and the account itself — one batch, so the claim goes
 * only with the `user` row, and a purge that reaches here finishes whole.
 */
async function deleteAccountRows(
  db: Db,
  userId: string,
  now: number,
): Promise<void> {
  const row = await firstRowWhere(db, user, eq(user.id, userId));
  // What is kept by address. A claim whose `user` row is already gone
  // has no address left to forget.
  const byAddress =
    row === undefined
      ? []
      : [
          db
            .delete(accessRequests)
            .where(eq(accessRequests.email, row.email.toLowerCase())),
          forgetSendLimits(db, row.email),
        ];
  // An address the runner was moving to holds counters of its own.
  const movingTo = await columnWhere(
    db,
    emailVerifications,
    emailVerifications.email,
    eq(emailVerifications.userId, userId),
  );
  const profile = await firstRowWhere(
    db,
    userProfiles,
    eq(userProfiles.userId, userId),
  );
  const handle = profile?.username ?? undefined;
  // Both directions. `follows` has no index led by the followee, so the
  // second clause scans it — once, for a deletion.
  const eitherFollow = involvingEither(
    follows.followerId,
    follows.followeeId,
    userId,
  );
  const eitherBlock = involvingEither(
    blocks.blockerId,
    blocks.blockedId,
    userId,
  );
  // Every other table here is scoped by one plain `user_id` column, so the
  // per-table deletes are a data table rather than one line each —
  // `reactions_pk` leads with the entry, so that one scans once, as does
  // `follows`' second clause above.
  const byUserId = [
    reactions,
    notifications,
    notificationPreferences,
    emailVerifications,
    passwordAttempts,
    stravaConnections,
  ] as const;
  // The trailing rows below share the same "found by nothing but the
  // runner's id" shape as `byUserId`, just on a column that is not always
  // called `userId` (`verification.value`, `user.id`) — so this generalises
  // the same way, on a pair rather than a bare table. Order is load-bearing
  // (comment at the call site): the profile, then Better Auth's rows, then
  // the account and the claim, last.
  const namedByOwnColumn: readonly (readonly [SQLiteTable, SQLiteColumn])[] = [
    [userProfiles, userProfiles.userId],
    [verification, verification.value],
    [session, session.userId],
    [account, account.userId],
    [user, user.id],
    [accountDeletions, accountDeletions.userId],
  ];
  await db.batch([
    db.delete(follows).where(eitherFollow),
    db.delete(blocks).where(eitherBlock),
    // Useful marks they gave others' entries (theirs went with the runs).
    ...byUserId.map((table) =>
      db.delete(table).where(eq(table.userId, userId)),
    ),
    ...byAddress,
    ...movingTo.map((address) => forgetSendLimits(db, address)),
    // Reports they filed stay — what was said about someone else's post
    // is that runner's record too — but name nobody (the development
    // plan's default; an owner question). A per-report id keeps them
    // distinct, so one-per-reporter counts stay true.
    db
      .update(reports)
      .set({ reporterId: sql`'deleted:' || ${reports.id}` })
      .where(eq(reports.reporterId, userId)),
    // The invite's use stays spent (2b-1): the row stays, the address
    // does not. Distinct per account, as uses are counted by address.
    db
      .update(inviteRedemptions)
      .set({ email: `deleted:${userId}` })
      .where(eq(inviteRedemptions.userId, userId)),
    // The handle is never released (D-56, D-72): given up, as any old
    // handle is, to a runner who will never exist again.
    ...(handle === undefined
      ? []
      : [
          db
            .insert(usernameHistory)
            .values({ username: handle, userId, retiredAt: now })
            .onConflictDoNothing(),
        ]),
    // The profile, then Better Auth's rows last, then the account and the
    // claim with them — an open reset link names the runner in `value`
    // (unindexed: short-lived rows, and this runs once per deletion). See
    // `namedByOwnColumn` above.
    ...namedByOwnColumn.map(([table, column]) =>
      db.delete(table).where(eq(column, userId)),
    ),
  ]);
}
