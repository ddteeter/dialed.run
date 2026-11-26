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
 * Not in `account/index.ts`, and called by nothing in `ops` or `feed`: it
 * calls feed's delete primitives, and both import this module's barrel,
 * so either importing this would be a cycle. The dispatch, which nothing
 * imports, runs it on the daily firing (`liveUpkeep`, design 253).
 */
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { account, session, user, verification } from "../../../db/schema-auth";
import {
  accessAsks,
  accessRequests,
  accountDeletions,
  blocks,
  closedAddresses,
  copyrightHolds,
  dataExports,
  emailVerifications,
  entryPhotos,
  follows,
  followNotices,
  heldTakeDowns,
  imports,
  inviteCodes,
  inviteRedemptions,
  notificationPreferences,
  notifications,
  productCorrections,
  outfitEntries,
  passwordAttempts,
  photoScreenings,
  reactions,
  reminderEmailDays,
  reports,
  runConditions,
  runs,
  stravaConnections,
  termsAcceptances,
  userProfiles,
  usernameHistory,
  wardrobeItems,
} from "../../../db/schema-core";
import { coreDb, env } from "../../../env";
import { importFilePrefix } from "../../../lib/import-file-key";
import { columnWhere, firstRowWhere } from "../../../lib/sql/keyed-read";
import { listedPages } from "../../../lib/sql/r2-pages";
import { orSqlNull } from "../../../lib/sql/sql-null";
import { nowSeconds } from "../../../lib/now";
import type { RateLimitKind } from "../../../lib/contracts/rate-limits";
import { forgetRateLimit, forgetSendLimits } from "../../email";
import { deleteRuns, deleteRunsThrough, LIVE_HOLD } from "../../feed";
import { captureException, outboxInsert, oweOutbox } from "../../ops";
import { disconnectStrava } from "../../runs";
import { followRowsNaming } from "../../notifications";
import { forgetReportCounts, settleOpenReviews } from "../../safety";
import { forgetManualBands } from "../../weather";
import { closedAddressRows, forgetClosedAddresses } from "../access";
import { exportPrefixFor } from "../data";

type Db = ReturnType<typeof drizzle>;
type Report = (error: unknown, context: Record<string, string>) => void;

/**
 * Accounts one round claims at most. A purge is a few hundred statements
 * and R2 calls for a runner with years of runs, so a firing claims a few at
 * a time and claims again while it has time (`PURGE_BUDGET_MS`); what is
 * left waits a day.
 */
export const PURGE_PER_ROUND = 3;

/**
 * How long a firing keeps claiming: no round starts past it. A daily
 * firing may run fifteen minutes; this leaves the rest of the upkeep room.
 */
export const PURGE_BUDGET_MS = 5 * 60 * 1000;

/**
 * How long a claim is held before another firing may take it over. The
 * daily firing is a day apart, so a purge that died is always retaken by
 * the next one; this only stops two overlapping firings sharing a row.
 */
export const PURGE_LEASE_S = 60 * 60;

/**
How many of a runner's runs the purge deletes in one statement batch.
*/
export const PURGE_RUNS_PAGE = 400;

/**
 * How many runs one firing's purge deletes across every account it
 * claims. An account with more keeps its claim, and the next firing goes
 * on from where this one stopped.
 */
export const PURGE_RUNS_PER_FIRING = 8000;

export interface PurgeDeps {
  readonly core: Db;
  /**
   * Weather's `forgetManualBands`: the runner's bands live in
   * `DIALED_WEATHER`, which only that module touches (design 173).
   */
  readonly forgetBands: (runIds: readonly string[]) => Promise<void>;
  /**
  Runs' `disconnectStrava`, bound to the queue (seam 5).
  */
  readonly revokeStrava: (userId: string) => Promise<void>;
  /**
   * `IMPORTS`: the runner's uploaded run files (`imports/`, kept only
   * until read since D-116, or 30 days after a failed read) and their data
   * export ZIPs (`exports/`, ACC-10).
   */
  readonly importsBucket: Pick<R2Bucket, "list" | "delete">;
  readonly report: Report;
  readonly now: number;
  /**
   * `CLOSED_ADDRESS_SECRET` (SA-L09): keys what is kept of a closed
   * account's addresses. Absent: nothing is kept, and the digest says so.
   */
  readonly closedAddressSecret?: string | undefined;
  /**
  The run pages' sizes, `PURGE_RUNS_PAGE` and `PURGE_RUNS_PER_FIRING` unless given.
  */
  readonly runPages?: { readonly page: number; readonly perFiring: number };
}

/**
What is left of the firing's runs to delete.
*/
interface RunBudget {
  left: number;
}

/**
No bound: every run the account has.
*/
function everyRun(): RunBudget {
  return { left: Infinity };
}

function liveDeps(): PurgeDeps {
  const core = coreDb();
  return {
    core,
    forgetBands: forgetManualBands,
    revokeStrava: (userId) =>
      disconnectStrava(core, env.IMPORTS_QUEUE, userId, captureException),
    importsBucket: env.IMPORTS,
    report: captureException,
    now: nowSeconds(),
    closedAddressSecret: env.CLOSED_ADDRESS_SECRET,
  };
}

/**
 * The daily firing's purge: claim what is due, a round at a time while the
 * budget lasts, purge each, and put what could not finish into the digest
 * (law 6). A claim that fails is held for the lease, so no round of this
 * firing takes it again, and the rounds end when nothing is left to claim.
 */
export async function purgeDueAccounts(
  anomalies: string[],
  deps: PurgeDeps = liveDeps(),
  // Milliseconds, for the budget.
  clock: () => number = Date.now,
): Promise<void> {
  const startedAt = clock();
  // The daily firing also lets go of closed addresses past their 3 years.
  await forgetClosedAddresses(deps.core, deps.now);
  let failed = 0;
  let unremembered = 0;
  let unfinished = 0;
  const budget: RunBudget = {
    left: deps.runPages?.perFiring ?? PURGE_RUNS_PER_FIRING,
  };
  // The next claim is the loop's step, outside its body, so each round
  // reads the clock and the runs left whatever the round did.
  for (
    let claimed = await claimDue(deps.core, deps.now);
    claimed.length > 0;
    claimed =
      clock() - startedAt < PURGE_BUDGET_MS && budget.left > 0
        ? await claimDue(deps.core, deps.now)
        : []
  ) {
    const outcome = await purgeEach(deps, claimed, budget);
    failed += outcome.failed;
    unremembered += outcome.unremembered;
    unfinished += outcome.unfinished;
  }
  if (failed > 0) {
    anomalies.push(
      `${String(failed)} account deletion(s) stopped part way and are finished on the next firing`,
    );
  }
  if (unfinished > 0) {
    anomalies.push(
      `${String(unfinished)} account deletion(s) are part way through and continue on the next firing`,
    );
  }
  if (unremembered > 0) {
    anomalies.push(
      `${String(unremembered)} closed account(s) were purged with their addresses unremembered: CLOSED_ADDRESS_SECRET is not set`,
    );
  }
  const dueButHeld = and(due(deps.now), sql`EXISTS (${liveHold()})`);
  const [waiting, held] = await Promise.all([
    deps.core.$count(accountDeletions, claimable(deps.now)),
    deps.core.$count(accountDeletions, dueButHeld),
  ]);
  if (waiting > 0) {
    anomalies.push(
      `${String(waiting)} account deletion(s) past their date wait for the next firing`,
    );
  }
  if (held > 0) {
    anomalies.push(
      `${String(held)} account deletion(s) wait for a copyright hold to settle`,
    );
  }
}

/**
 * How many of these purges failed, how many stopped at the firing's runs
 * and go on next firing, and how many closed accounts were purged with
 * nothing kept of their addresses; each failure is reported, and the rest
 * go on.
 */
async function purgeEach(
  deps: PurgeDeps,
  userIds: readonly string[],
  budget: RunBudget,
): Promise<{ failed: number; unremembered: number; unfinished: number }> {
  let failed = 0;
  let unremembered = 0;
  let unfinished = 0;
  for (const userId of userIds) {
    try {
      const outcome = await purgeAccount(deps, userId, budget);
      if (outcome === undefined) unfinished += 1;
      else if (outcome.isUnremembered) unremembered += 1;
    } catch (error) {
      failed += 1;
      deps.report(error, { surface: "account-purge", userId });
    }
  }
  return { failed, unremembered, unfinished };
}

/**
 * Past its date, and not held by a purge that is still running.
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
 * SA-L09: whether a live copyright hold names the account's material
 * (`copyright_holds_owner`). While one does, the account is not purged:
 * the hold's material is evidence until the Desk settles it, and the purge
 * would delete it with the rest. The hold's own end lets the next firing in.
 */
/**
 * The runner's live holds, checked by the run deletes' own batches as
 * they run: the claim only waited for the holds there were when it was
 * taken. A hold placed since fails the batch, the claim is kept, and the
 * next firing waits (`claimable`).
 */
function heldBy(userId: string) {
  return { entries: eq(copyrightHolds.ownerId, userId), noun: "run" } as const;
}

function liveHold() {
  const live = and(
    eq(copyrightHolds.ownerId, accountDeletions.userId),
    inArray(copyrightHolds.status, [...LIVE_HOLD]),
  );
  return sql`SELECT 1 FROM ${copyrightHolds} WHERE ${live}`;
}

/**
A claim the firing may take: due, and no live hold on its account.
*/
function claimable(now: number) {
  return and(due(now), sql`NOT EXISTS (${liveHold()})`);
}

/**
 * Claim, then work (law 2): only the rows this statement moved are this
 * firing's, however many firings overlap.
 *
 * **Every session of a runner whose purge has started goes with the
 * claim**, in its batch: a runner who signed in during the week and never
 * pressed Keep is signed out the moment the purge owns the account, and
 * `auth`'s deletion gate makes no new session for them. So nothing can be
 * written behind the purge's back — a garment saved after the closet step
 * would outlive the account (review of PR #130). Every started purge, not
 * only this firing's: the batch cannot branch on the claim's result, and a
 * started purge's runner is owed no session whichever firing holds it.
 */
async function claimDue(db: Db, now: number): Promise<string[]> {
  // Never tried first, oldest first: a claim a purge failed on (its lease
  // ran out) goes behind every one not yet tried, so a purge that fails
  // every firing cannot keep the others waiting.
  const oldest = db
    .select({ userId: accountDeletions.userId })
    .from(accountDeletions)
    .where(claimable(now))
    .orderBy(
      sql`coalesce(${accountDeletions.purgeStartedAt}, 0)`,
      asc(accountDeletions.purgeAfter),
    )
    .limit(PURGE_PER_ROUND);
  const started = db
    .select({ userId: accountDeletions.userId })
    .from(accountDeletions)
    .where(isNotNull(accountDeletions.purgeStartedAt));
  const taken = and(inArray(accountDeletions.userId, oldest), claimable(now));
  const [rows] = await db.batch([
    db
      .update(accountDeletions)
      .set({ purgeStartedAt: now })
      .where(taken)
      .returning({ userId: accountDeletions.userId }),
    db.delete(session).where(inArray(session.userId, started)),
  ]);
  return rows.map((row) => row.userId);
}

/**
 * One account, step by step. Every step reads what is left, so running
 * it again from the top after a failure at any step does only what the
 * failure left undone. `isUnremembered` when the account was closed, had
 * proved addresses, and nothing was kept of them (`deleteAccountRows`).
 * Nothing (`undefined`) when the firing's runs (`budget`) ran out first:
 * nothing past the runs is touched, and the claim stays for the next
 * firing.
 */
export async function purgeAccount(
  deps: PurgeDeps,
  userId: string,
  budget: RunBudget = everyRun(),
): Promise<{ isUnremembered: boolean } | undefined> {
  const { core, report } = deps;
  // Revoked before anything else of theirs goes: a connection the request
  // could not close is closed here, with the grant owed to Strava.
  await deps.revokeStrava(userId);
  await forgetScreenings(core, userId);
  if (!(await didDeleteEveryRun(deps, userId, budget))) return undefined;
  // 128's SAF-3 primitive (seam 4): every entry left — with their items,
  // tags, reactions, photos and notifications — and the media prefix owed.
  await deleteRuns(core, userId, "all", report, undefined, heldBy(userId));
  await deleteCloset(core, userId);
  await deleteStoredFiles(deps.importsBucket, userId);
  return deleteAccountRows(core, userId, deps);
}

/**
 * Everything the runner has in `IMPORTS`: their uploaded run files and
 * their data export ZIPs (ACC-10), each found by listing its prefix rather
 * than from rows. So a ZIP a build staged before its row said so goes too,
 * and so does an upload whose row was never written (`startImport` puts
 * the file before the row). No bucket rule expires either
 * kind of upload, so this listing is the only thing that ever removes one
 * of those.
 *
 * Reconciled by the purge's claim, not owed to the outbox: the runs' and
 * the closet's rows are already gone, so nothing under these prefixes is
 * still named, and a listing that stops part way throws, keeps the claim,
 * and is finished by the next firing.
 */
async function deleteStoredFiles(
  bucket: PurgeDeps["importsBucket"],
  userId: string,
): Promise<void> {
  for (const prefix of [importFilePrefix(userId), exportPrefixFor(userId)]) {
    for await (const objects of listedPages(bucket, prefix)) {
      await bucket.delete(objects.map((object) => object.key));
    }
  }
}

/**
 * The runner's runs, a page at a time, oldest id first, while the firing
 * has runs left: each page's bands in `DIALED_WEATHER` first, because
 * once the runs are gone nothing names those rows (two databases, so its
 * own write, law 8c), then the page's runs and what hangs on them. True
 * when no run is left; false when the firing's runs ran out first. Every
 * page reads what is left, so a page that fails is done again next firing.
 */
async function didDeleteEveryRun(
  deps: PurgeDeps,
  userId: string,
  budget: RunBudget,
): Promise<boolean> {
  const pageSize = deps.runPages?.page ?? PURGE_RUNS_PAGE;
  while (budget.left > 0) {
    const size = Math.min(pageSize, budget.left);
    const page = await deps.core
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.userId, userId))
      .orderBy(asc(runs.id))
      .limit(size);
    const last = page.at(-1);
    if (last === undefined) return true;
    budget.left -= page.length;
    await deps.forgetBands(page.map((run) => run.id));
    await deleteRunsThrough(
      deps.core,
      userId,
      last.id,
      deps.report,
      undefined,
      heldBy(userId),
    );
  }
  return false;
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
    // A garment's photo is queued by the garment's id (design 157).
    settleOpenReviews(db, "garment", theirGarments, userId),
  ]);
}

/**
 * The closet, and any upload that never became a run: the rows, and the
 * R2 each garment is owed (its photo prefix), in one batch. Left to the
 * drain rather than sent now: a closet is dozens of prefixes, and the
 * drain clears them within days. The uploads' files are not owed here:
 * `deleteStoredFiles` lists the runner's whole `imports/` prefix next.
 */
async function deleteCloset(db: Db, userId: string): Promise<void> {
  const garments = await columnWhere(
    db,
    wardrobeItems,
    wardrobeItems.id,
    eq(wardrobeItems.userId, userId),
  );
  const debts = garments.map((itemId) =>
    oweOutbox({ kind: "photo_delete", payload: { userId, itemId } }),
  );
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
 * The addresses this runner proved theirs, lower-cased: while the account's
 * address is confirmed, that address and the one they redeemed their
 * invite with (an email change needs a confirmed address, so the first
 * was proved before any change). An unconfirmed account has proved none.
 * An address only named — an email change nobody opened — is not one:
 * its row goes by the runner's id with the rest. Each proved address is
 * kept somewhere by address rather than by id, so each is forgotten by
 * address (`forgetAddress`) and, for a closed account, fingerprinted.
 */
async function provedAddressesOf(db: Db, userId: string): Promise<string[]> {
  const confirmedAccount = and(
    eq(user.id, userId),
    eq(user.emailVerified, true),
  );
  const redeemed = eq(inviteRedemptions.userId, userId);
  const [confirmed, redemption] = await Promise.all([
    firstRowWhere(db, user, confirmedAccount),
    firstRowWhere(db, inviteRedemptions, redeemed),
  ]);
  if (confirmed === undefined) return [];
  // A repeat is harmless: forgetting is by address, and the fingerprints
  // are kept as a set (`closedAddressRows`).
  const known =
    redemption === undefined
      ? [confirmed.email]
      : [confirmed.email, redemption.email];
  return known.map((address) => address.toLowerCase());
}

/**
 * What is kept by one address: an access request and its asks, the send
 * counters, and
 * an invite code's label that names it — which D7 no longer writes
 * (`invites.ts`' `requestLabelOr`), but a code made before that did, and
 * an operator may type one. `instr` rather than `LIKE`, so an address's
 * `_` is a letter and not a wildcard; a scan of a table one operator
 * writes to by hand, once per deletion.
 */
function forgetAddress(db: Db, address: string) {
  return [
    ...[accessRequests, accessAsks].map((table) =>
      db.delete(table).where(eq(table.email, address)),
    ),
    forgetSendLimits(db, address),
    db
      .update(inviteCodes)
      .set({ label: orSqlNull(undefined) })
      .where(sql`instr(lower(${inviteCodes.label}), ${address}) > 0`),
  ] as const;
}

/**
 * The label of the code a runner redeemed, blanked where it names the
 * address they redeemed it with (an operator may type the address they
 * sent it to). The redemption ties the code to the runner by id, so this
 * needs no proved address; a code's other labels stay, so a code many
 * runners spent keeps its operator's words.
 */
function forgetRedeemedLabel(db: Db, userId: string) {
  const namesTheirAddress = sql`EXISTS (SELECT 1 FROM ${inviteRedemptions} WHERE ${inviteRedemptions.userId} = ${userId} AND ${inviteRedemptions.codeId} = ${inviteCodes.id} AND instr(lower(${inviteCodes.label}), ${inviteRedemptions.email}) > 0)`;
  return db
    .update(inviteCodes)
    .set({ label: orSqlNull(undefined) })
    .where(namesTheirAddress);
}

/**
 * The counts whose subject is the runner's id, each forgotten by the
 * purge: a deleted account's id is not kept as a subject. A new
 * runner-keyed kind joins this list; `handle-runner` was the one missed
 * (owner, 2026-11-26, #1076). The report counts are `safety`'s
 * (`forgetReportCounts`).
 */
const RUNNER_COUNTS = [
  "change-runner",
  "upload-runner",
  "manual-run-runner",
  "weather-runner",
  "photo-runner",
  "purge-runner",
  "deletion-notice",
  "correction-runner",
  "strava-connect-runner",
  "shared-row-runner",
  "enrich-runner",
  "handle-runner",
] as const satisfies readonly RateLimitKind[];

/**
 * One closed address's fingerprint, written only while the runner's
 * profile carries a ban: `INSERT … SELECT … FROM user_profiles WHERE
 * banned_at IS NOT NULL`, so the ban is the one in place when the
 * statement runs, not when the profile was read.
 */
function keptIfClosed(
  db: Db,
  userId: string,
  row: { hash: string; closedAt: number },
) {
  const fingerprint = {
    hash: sql<string>`${row.hash}`.as("hash"),
    closedAt: sql<number>`${row.closedAt}`.as("closed_at"),
  };
  const ifClosed = and(
    eq(userProfiles.userId, userId),
    isNotNull(userProfiles.bannedAt),
  );
  const whileClosed = db.select(fingerprint).from(userProfiles).where(ifClosed);
  return db.insert(closedAddresses).select(whileClosed).onConflictDoNothing();
}

/**
 * Everything else, and the account itself — one batch, so the claim goes
 * only with the `user` row, and a purge that reaches here finishes whole.
 */
async function deleteAccountRows(
  db: Db,
  userId: string,
  deps: Pick<PurgeDeps, "now" | "closedAddressSecret">,
): Promise<{ isUnremembered: boolean }> {
  const { now } = deps;
  const addresses = await provedAddressesOf(db, userId);
  const profile = await firstRowWhere(
    db,
    userProfiles,
    eq(userProfiles.userId, userId),
  );
  const handle = profile?.username ?? undefined;
  const isClosed = profile !== undefined && profile.bannedAt !== null;
  // Hashed whatever the profile said when read: whether they are kept is
  // decided by the batch itself, from the ban as it stands then
  // (`keptIfClosed`).
  const fingerprints = await closedAddressRows(
    deps.closedAddressSecret,
    addresses,
    now,
  );
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
  const ringsNamingThem = followRowsNaming(db, userId, handle);
  // A follow's ring (R48·131e), on their bell or someone else's.
  const eitherRing = involvingEither(
    followNotices.followerId,
    followNotices.followeeId,
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
    dataExports,
    termsAcceptances,
    reminderEmailDays,
    // Corrections they sent (D-163): a decided product keeps its value,
    // and a waiting one loses one runner from its row.
    productCorrections,
    // The copies of their runs' conditions (D-175).
    runConditions,
  ] as const;
  // The trailing rows below share the same "found by nothing but the
  // runner's id" shape as `byUserId`, just on a column that is not always
  // called `userId` (`verification.value`, `user.id`) — so this generalises
  // the same way, on a pair rather than a bare table. Order is load-bearing
  // (comment at the call site): the profile, then Better Auth's rows, then
  // the account and the claim, last.
  const namedByOwnColumn = [
    [userProfiles, userProfiles.userId],
    [verification, verification.value],
    [session, session.userId],
    [account, account.userId],
    [user, user.id],
    [accountDeletions, accountDeletions.userId],
  ] as const;
  await db.batch([
    db.delete(follows).where(eitherFollow),
    db.delete(blocks).where(eitherBlock),
    // Before the rings, which are how these rows are found.
    db.delete(notifications).where(ringsNamingThem),
    db.delete(followNotices).where(eitherRing),
    // Useful marks they gave others' entries (theirs went with the runs).
    ...byUserId.map((table) =>
      db.delete(table).where(eq(table.userId, userId)),
    ),
    // The take-downs of their material a hold kept (owner, 2026-11-21):
    // the purge waits out every live hold, so these name nothing still
    // kept. No index leads with the owner, so this scans once.
    db.delete(heldTakeDowns).where(eq(heldTakeDowns.ownerId, userId)),
    ...addresses.flatMap((address) => forgetAddress(db, address)),
    // What sign-up refuses for 3 years, in place of the addresses: kept
    // only if the account is closed as this batch runs. Before the
    // profile's delete, below, which is what the condition reads.
    ...fingerprints.map((row) => keptIfClosed(db, userId, row)),
    ...RUNNER_COUNTS.map((kind) => forgetRateLimit(db, kind, userId)),
    ...forgetReportCounts(db, userId),
    // Reports they filed stay — what was said about someone else's post
    // is that runner's record too — but name nobody (the development
    // plan's default; an owner question). A per-report id keeps them
    // distinct, so one-per-reporter counts stay true.
    db
      .update(reports)
      .set({ reporterId: sql`'deleted:' || ${reports.id}` })
      .where(eq(reports.reporterId, userId)),
    // The code they spent, where its label names the address they spent
    // it with: found by their own redemption, not by the address, so an
    // account that never confirmed its address leaves it too. Before the
    // redemption's address goes, below.
    forgetRedeemedLabel(db, userId),
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
  // SA-L09: a closed account's addresses are kept as fingerprints, so
  // sign-up can refuse them; with no secret, none were.
  return {
    isUnremembered:
      isClosed && addresses.length > 0 && fingerprints.length === 0,
  };
}
