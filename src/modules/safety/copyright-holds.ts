/**
 * A copyright takedown's 30 days (D-130, design 148): `copyright_holds`.
 *
 * **The material is hidden, not deleted**, so a valid counter-notice can
 * put it back, which 17 U.S.C. §512(g)(2)(C) expects 10 to 14 business
 * days after it arrives. The Desk records the counter-notice; the daily
 * sweep restores on the 12th weekday after it — inside the window even
 * with two federal holidays in it — unless the Desk records that the
 * sender has gone to court. With no counter-notice pending, the sweep
 * deletes the material 30 days after the takedown (`feed/moderation.ts`,
 * whose delete statements those are).
 *
 * **The hide is a status no other writer moves.** An entry goes to
 * `moderation_status = 'removed'` and a photo to `screen_status =
 * 'removed'`; a report's hide and a review's Approve leave either alone
 * (`reports.ts`, `review.ts`), so only this file's restore brings one
 * back.
 */
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  copyrightHolds,
  entryPhotos,
  moderationActions,
  outfitEntries,
} from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";

import { heldPhotoStatus } from "./visibility";

type Db = ReturnType<typeof drizzle>;

export type HeldSubjectType =
  (typeof copyrightHolds.$inferSelect)["subjectType"];

const DAY_SECONDS = 24 * 60 * 60;

/**
Thirty days from the takedown to the purge (D-130).
*/
export const COPYRIGHT_HOLD_SECONDS = 30 * DAY_SECONDS;

/**
The weekday after a counter-notice on which the material comes back.
*/
export const RESTORE_WEEKDAYS = 12;

/**
 * 00:00 UTC of the 12th weekday after `at`'s UTC day. Day 0 of the epoch
 * was a Thursday, so `(day + 4) % 7` is the weekday with Sunday as 0.
 */
export function restoreDayAfter(at: number): number {
  let day = Math.floor(at / DAY_SECONDS);
  for (let counted = 0; counted < RESTORE_WEEKDAYS;) {
    day += 1;
    const weekday = (day + 4) % 7;
    if (weekday !== 0 && weekday !== 6) counted += 1;
  }
  return day * DAY_SECONDS;
}

export interface CopyrightHoldRecord {
  readonly moderationActionId: string;
  readonly subjectType: HeldSubjectType;
  readonly subjectId: string;
  readonly ownerId: string;
  readonly entryId: string;
}

/**
 * The takedown's hide, as statements for its batch: the hold, and the
 * subject moved to `removed` from whatever it was.
 */
export function copyrightHoldWrites(
  db: Db,
  record: CopyrightHoldRecord,
  now = nowSeconds(),
): [BatchItem<"sqlite">, BatchItem<"sqlite">] {
  return [
    db.insert(copyrightHolds).values({
      id: newUlid(),
      ...record,
      status: "hidden",
      hiddenAt: now,
      purgeAt: now + COPYRIGHT_HOLD_SECONDS,
    }),
    subjectWriters[record.subjectType](db, record.subjectId, {
      to: "removed",
      when: undefined,
    }),
  ];
}

/**
 * The subject's own column, set — on a restore only from `removed`, and
 * only `when` holds. A restore gives an entry back as `ok` and a photo as
 * `pending`, never `pass`: screening looks at it again, as it does after
 * every give-back (`releaseHoldWrites`).
 */
const subjectWriters: Record<
  HeldSubjectType,
  (
    db: Db,
    subjectId: string,
    change: { readonly to: "removed" | "back"; readonly when: SQL | undefined },
  ) => BatchItem<"sqlite">
> = {
  entry: (db, subjectId, { to, when }) =>
    db
      .update(outfitEntries)
      .set({ moderationStatus: to === "removed" ? "removed" : "ok" })
      .where(
        and(
          eq(outfitEntries.id, subjectId),
          to === "removed"
            ? undefined
            : eq(outfitEntries.moderationStatus, "removed"),
          when,
        ),
      ),
  photo: (db, subjectId, { to, when }) =>
    db
      .update(entryPhotos)
      .set({ screenStatus: to === "removed" ? heldPhotoStatus : "pending" })
      .where(
        and(
          eq(entryPhotos.id, subjectId),
          to === "removed"
            ? undefined
            : eq(entryPhotos.screenStatus, heldPhotoStatus),
          when,
        ),
      ),
};

/**
Statuses a hold is still holding in: hidden, or its delete owed.
*/
const LIVE = ["hidden", "purging"] as const;

/**
 * Whether a live hold already covers this subject, so a second takedown
 * answers "already removed" (`copyright_holds_live_subject`).
 */
export async function isCopyrightHeld(
  db: Db,
  subjectType: HeldSubjectType,
  subjectId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: copyrightHolds.id })
    .from(copyrightHolds)
    .where(
      and(
        eq(copyrightHolds.subjectType, subjectType),
        eq(copyrightHolds.subjectId, subjectId),
        inArray(copyrightHolds.status, [...LIVE]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Not a takedown a restore undid — for the author's "removed" band
 * (`run-removals.ts`), which stops showing once the thing is back.
 * `copyright_holds_action` keys it.
 */
export function notRestored(actionId: SQLiteColumn): SQL {
  return sql`not exists (select 1 from ${copyrightHolds} where ${copyrightHolds.moderationActionId} = ${actionId} and ${copyrightHolds.status} = 'restored')`;
}

export type CounterNoticeOutcome =
  | {
      readonly outcome: "recorded";
      readonly counterNoticeAt: number;
      readonly restoreAt: number;
    }
  | { readonly outcome: "already" | "gone" };

/**
 * The Desk's "Counter-notice received": the date, who recorded it, and
 * the day the sweep restores. Only on a hold still hidden, and once.
 */
export async function recordCounterNotice(
  db: Db,
  actorId: string,
  holdId: string,
  now = nowSeconds(),
): Promise<CounterNoticeOutcome> {
  const restoreAt = restoreDayAfter(now);
  const landed = await db
    .update(copyrightHolds)
    .set({ counterNoticeAt: now, counterNoticeBy: actorId, restoreAt })
    .where(
      and(
        eq(copyrightHolds.id, holdId),
        eq(copyrightHolds.status, "hidden"),
        isNull(copyrightHolds.counterNoticeAt),
      ),
    )
    .returning({ id: copyrightHolds.id });
  if (landed.length > 0) {
    return { outcome: "recorded", counterNoticeAt: now, restoreAt };
  }
  const hold = await hiddenHold(db, holdId);
  return { outcome: hold === undefined ? "gone" : "already" };
}

export type CourtActionOutcome =
  | { readonly outcome: "recorded"; readonly courtActionAt: number }
  | { readonly outcome: "already" | "no_counter_notice" | "gone" };

/**
 * The Desk's "Court action filed": the sender says they have gone to
 * court, so the restore is cancelled. Only once a counter-notice is
 * recorded, and only before the sweep has restored it.
 */
export async function recordCourtAction(
  db: Db,
  actorId: string,
  holdId: string,
  now = nowSeconds(),
): Promise<CourtActionOutcome> {
  const landed = await db
    .update(copyrightHolds)
    .set({ courtActionAt: now, courtActionBy: actorId })
    .where(
      and(
        eq(copyrightHolds.id, holdId),
        eq(copyrightHolds.status, "hidden"),
        isNotNull(copyrightHolds.counterNoticeAt),
        isNull(copyrightHolds.courtActionAt),
      ),
    )
    .returning({ id: copyrightHolds.id });
  if (landed.length > 0) return { outcome: "recorded", courtActionAt: now };
  const hold = await hiddenHold(db, holdId);
  if (hold === undefined) return { outcome: "gone" };
  return {
    outcome: hold.counterNoticeAt === null ? "no_counter_notice" : "already",
  };
}

/**
Why a Desk action did not land: the hold, if it is still hidden.
*/
async function hiddenHold(db: Db, holdId: string) {
  const [hold] = await db
    .select({ counterNoticeAt: copyrightHolds.counterNoticeAt })
    .from(copyrightHolds)
    .where(
      and(eq(copyrightHolds.id, holdId), eq(copyrightHolds.status, "hidden")),
    );
  return hold;
}

/**
 * The sweep's restore: every hidden hold whose day has come and has no
 * court action, put back in one batch. Each hold's claim goes first, and
 * its give-back is conditional on that claim being this sweep's
 * (`settled_at` is this firing's moment), so a sweep that runs twice, or
 * a claim that lost to a court action, restores nothing more.
 */
export async function restoreDueHolds(
  db: Db,
  now = nowSeconds(),
): Promise<void> {
  const due = await db
    .select({
      id: copyrightHolds.id,
      subjectType: copyrightHolds.subjectType,
      subjectId: copyrightHolds.subjectId,
    })
    .from(copyrightHolds)
    .where(and(stillRestorable(), lte(copyrightHolds.restoreAt, now)));
  const [first, ...rest] = due.flatMap((hold) => [
    db
      .update(copyrightHolds)
      .set({ status: "restored", settledAt: now })
      .where(and(eq(copyrightHolds.id, hold.id), stillRestorable())),
    subjectWriters[hold.subjectType](db, hold.subjectId, {
      to: "back",
      when: exists(restoredBy(db, hold.id, now)),
    }),
  ]);
  if (first !== undefined) await db.batch([first, ...rest]);
}

/**
A hold the restore may still claim: hidden, and no court action since.
*/
function stillRestorable() {
  return and(
    eq(copyrightHolds.status, "hidden"),
    isNull(copyrightHolds.courtActionAt),
  );
}

/**
The hold, if this sweep's claim restored it — what a give-back waits on.
*/
function restoredBy(db: Db, holdId: string, now: number) {
  const thisClaim = and(
    eq(copyrightHolds.id, holdId),
    eq(copyrightHolds.status, "restored"),
    eq(copyrightHolds.settledAt, now),
  );
  return db
    .select({ one: sql`1` })
    .from(copyrightHolds)
    .where(thisClaim);
}

/**
How long a claimed purge may sit before the next sweep takes it over.
*/
const PURGE_LEASE_SECONDS = 60 * 60;

export interface ClaimedPurge {
  readonly id: string;
  readonly subjectType: HeldSubjectType;
  readonly subjectId: string;
  readonly ownerId: string;
  readonly entryId: string;
  /**
  Who took it down: the purge settles any open review in their name.
  */
  readonly actorId: string;
}

/**
 * The sweep's purge claim: holds 30 days old with no counter-notice
 * pending — none recorded, or one a court action answered — move to
 * `purging`, and so do purges an earlier sweep claimed and did not
 * finish. One statement, so two sweeps never claim the same hold; the
 * claim's moment is `settled_at`, which is how a stale one is told apart.
 */
export async function claimDuePurges(
  db: Db,
  now = nowSeconds(),
): Promise<ClaimedPurge[]> {
  const noCounterNoticePending = or(
    isNull(copyrightHolds.counterNoticeAt),
    isNotNull(copyrightHolds.courtActionAt),
  );
  const due = and(
    eq(copyrightHolds.status, "hidden"),
    lte(copyrightHolds.purgeAt, now),
    noCounterNoticePending,
  );
  const stale = and(
    eq(copyrightHolds.status, "purging"),
    lt(copyrightHolds.settledAt, now - PURGE_LEASE_SECONDS),
  );
  const claimed = await db
    .update(copyrightHolds)
    .set({ status: "purging", settledAt: now })
    .where(or(due, stale))
    .returning({ id: copyrightHolds.id });
  return db
    .select({
      id: copyrightHolds.id,
      subjectType: copyrightHolds.subjectType,
      subjectId: copyrightHolds.subjectId,
      ownerId: copyrightHolds.ownerId,
      entryId: copyrightHolds.entryId,
      actorId: moderationActions.actorId,
    })
    .from(copyrightHolds)
    .innerJoin(
      moderationActions,
      eq(moderationActions.id, copyrightHolds.moderationActionId),
    )
    .where(
      inArray(
        copyrightHolds.id,
        claimed.map((hold) => hold.id),
      ),
    );
}

/**
The claimed purge, done: for the batch that deletes the material.
*/
export function purgedWrite(db: Db, holdId: string, now = nowSeconds()) {
  return db
    .update(copyrightHolds)
    .set({ status: "purged", settledAt: now })
    .where(
      and(eq(copyrightHolds.id, holdId), eq(copyrightHolds.status, "purging")),
    );
}

/**
 * A runner's copyright strikes (`copyright.md` §Repeat infringers), as a
 * column of the hold's own row: every takedown of the owner's that a
 * restore did not undo. A notice a counter-notice answered with no court
 * action following is restored, and does not count. `copyright_holds_owner`
 * keys it.
 */
function strikesOf(owner: SQLiteColumn): SQL<number> {
  return sql<number>`(select count(*) from ${copyrightHolds} as "other" where "other"."owner_id" = ${owner} and "other"."status" <> 'restored')`;
}

/**
The most holds Review lists.
*/
export const COPYRIGHT_HOLD_PAGE = 100;

/**
 * What the Desk holds, soonest purge first: the subject, whose it is and
 * their strikes, the notice it answered, and where its counter-notice
 * stands.
 */
export async function heldCopyrightContent(db: Db) {
  return db
    .select({
      id: copyrightHolds.id,
      subjectType: copyrightHolds.subjectType,
      subjectId: copyrightHolds.subjectId,
      ownerId: copyrightHolds.ownerId,
      strikes: strikesOf(copyrightHolds.ownerId),
      notice: moderationActions.reason,
      hiddenAt: copyrightHolds.hiddenAt,
      purgeAt: copyrightHolds.purgeAt,
      counterNoticeAt: copyrightHolds.counterNoticeAt,
      restoreAt: copyrightHolds.restoreAt,
      courtActionAt: copyrightHolds.courtActionAt,
    })
    .from(copyrightHolds)
    .innerJoin(
      moderationActions,
      eq(moderationActions.id, copyrightHolds.moderationActionId),
    )
    .where(eq(copyrightHolds.status, "hidden"))
    .orderBy(asc(copyrightHolds.purgeAt), asc(copyrightHolds.id))
    .limit(COPYRIGHT_HOLD_PAGE);
}

export type CopyrightHoldSummary = Awaited<
  ReturnType<typeof heldCopyrightContent>
>[number];
