/**
 * A copyright takedown's 30 days (D-130, design 149): `copyright_holds`.
 *
 * **The material is hidden, not deleted**, so a valid counter-notice can
 * put it back, which 17 U.S.C. §512(g)(2)(C) expects 10 to 14 business
 * days after it arrives. The Desk records the counter-notice; the daily
 * sweep restores on the 12th weekday after it — inside the window even
 * with two federal holidays in it — unless the Desk records that the
 * sender has gone to court. With no counter-notice recorded, the sweep
 * deletes the material 30 days after the takedown (`feed/moderation/moderation.ts`,
 * whose delete statements those are).
 *
 * **A court action is a litigation hold** (D-146): the material stays
 * hidden past its 30 days, because deleting the subject of a pending suit
 * risks a spoliation claim. Only the Desk ends it, when the case does:
 * "Case over: restore" (the claimant lost, so no strike) or "Case over:
 * delete" (a strike, as every purge is).
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
  reviewQueue,
  takedownRequests,
  userProfiles,
} from "../../../db/schema-core";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { qualified } from "../../../lib/sql/qualified";

import { hiddenNoticeTo } from "../notices";
import { settleOpenReviews } from "../review";
import { heldPhotoStatus, isCopyrightTakedown } from "../rules";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

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
function copyrightHoldWrites(
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
    heldOutOfSight(db, record.subjectType, record.subjectId),
  ];
}

/**
 * A held subject out of every reader's sight: its own column moved to
 * `removed`, from whatever it was. A take-down of material a hold keeps
 * moves it the same way, since that hold may be on its kit or a photo.
 */
function heldOutOfSight(
  db: Db,
  subjectType: HeldSubjectType,
  subjectId: string,
): BatchItem<"sqlite"> {
  return hideWriters[subjectType](db, subjectId);
}

/**
The subject's own column moved to `removed`, from whatever it was.
*/
const hideWriters: Record<
  HeldSubjectType,
  (db: Db, subjectId: string) => BatchItem<"sqlite">
> = {
  entry: (db, subjectId) =>
    db
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, subjectId)),
  photo: (db, subjectId) =>
    db
      .update(entryPhotos)
      .set({ screenStatus: heldPhotoStatus })
      .where(eq(entryPhotos.id, subjectId)),
};

/**
Statuses a hold is still holding in: hidden, or its delete owed.
*/
const LIVE = ["hidden", "purging"] as const;

/**
 * How a takedown goes, as the holds see it (D-130; owner, 2026-11-21):
 *
 * - `repeat` — a copyright takedown of what a live hold already holds,
 *   or a take-down of material every covering hold already records;
 * - `keep` — the bytes stay, and its statements say how: a copyright
 *   takedown writes the hold and the hide, for 30 days; a Remove or a
 *   removal request's takedown of material a live hold keeps records the
 *   take-down on the holds (`takenDownWrite`), hides the subject, and
 *   settles its open Review rows, a kit's photos' too, by the moderator;
 * - `none` — nothing holds it, so the caller deletes it. A quarantine is
 *   always `none`: it keeps its own copy (D-70).
 *
 * `statements` take the audit row's id, which the caller mints.
 */
export type TakeDownHold =
  | { readonly kind: "repeat" }
  | { readonly kind: "none" }
  | {
      readonly kind: "keep";
      readonly statements: (
        actionId: string,
      ) => [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
    };

interface TakeDownRequest {
  readonly actorId: string;
  readonly action: "remove" | "quarantine" | "takedown";
  readonly reason: Parameters<typeof isCopyrightTakedown>[1];
  readonly subjectType: HeldSubjectType;
  readonly subjectId: string;
}

export async function takeDownHoldOf(
  db: Db,
  input: TakeDownRequest,
  target: { readonly ownerId: string; readonly entryId: string },
): Promise<TakeDownHold> {
  const subject = { ...input, entryId: target.entryId };
  if (isCopyrightTakedown(input.action, input.reason)) {
    if (await isCopyrightHeld(db, input.subjectType, input.subjectId)) {
      return { kind: "repeat" };
    }
    return {
      kind: "keep",
      statements: (moderationActionId) =>
        copyrightHoldWrites(db, {
          moderationActionId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          ownerId: target.ownerId,
          entryId: target.entryId,
        }),
    };
  }
  if (input.action === "quarantine") return { kind: "none" };
  const holds = await coveringHoldsOf(db, subject);
  if (holds.length === 0) return { kind: "none" };
  if (holds.every((hold) => hold.takenDownBy !== null)) {
    return { kind: "repeat" };
  }
  return {
    kind: "keep",
    statements: (actionId) => [
      takenDownWrite(db, subject, actionId),
      heldOutOfSight(db, input.subjectType, input.subjectId),
      settleOpenReviews(
        db,
        input.subjectType,
        [input.subjectId],
        input.actorId,
      ),
      ...(input.subjectType === "entry"
        ? [
            settleOpenReviews(
              db,
              "photo",
              db
                .select({ id: entryPhotos.id })
                .from(entryPhotos)
                .where(eq(entryPhotos.entryId, target.entryId)),
              input.actorId,
            ),
          ]
        : []),
    ],
  };
}

/**
 * What the daily sweep owes after its restore (`restoreDueHolds`): the
 * holds its purge claims (`claimDuePurges`), and what was taken down
 * under a hold whose kit no live hold keeps any more
 * (`takenDownSubjectsDue`) — read after the claim, so a kit whose hold
 * is purging now waits for the next sweep.
 */
export async function sweepClaims(
  db: Db,
  now = nowSeconds(),
): Promise<{
  readonly purges: ClaimedPurge[];
  readonly takenDown: TakenDownSubject[];
}> {
  const purges = await claimDuePurges(db, now);
  return { purges, takenDown: await takenDownSubjectsDue(db) };
}

/**
 * Whether a live hold already covers this subject, so a second takedown
 * answers "already removed" (`copyright_holds_live_subject`).
 */
async function isCopyrightHeld(
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

/**
 * A subject a take-down names: the kit, or a photo with the kit it is on.
 */
interface KeptSubject {
  readonly subjectType: HeldSubjectType;
  readonly subjectId: string;
  readonly entryId: string;
}

/**
 * The live holds whose material a take-down of `subject` would delete: a
 * hold on the subject itself, a hold on the kit a photo is on, and, for a
 * kit, a hold on any of its photos. Every such hold names the same kit.
 */
function covering(subject: KeptSubject): SQL | undefined {
  const onTheKit = and(
    inArray(copyrightHolds.status, [...LIVE]),
    eq(copyrightHolds.entryId, subject.entryId),
  );
  return subject.subjectType === "entry"
    ? onTheKit
    : and(
        onTheKit,
        or(
          eq(copyrightHolds.subjectType, "entry"),
          eq(copyrightHolds.subjectId, subject.subjectId),
        ),
      );
}

/**
The live holds that keep `subject`'s material, with the take-down each records.
*/
function coveringHoldsOf(db: Db, subject: KeptSubject) {
  return db
    .select({ takenDownBy: copyrightHolds.takenDownBy })
    .from(copyrightHolds)
    .where(covering(subject));
}

/**
 * A take-down of held material, for its batch (owner, 2026-11-21): every
 * covering hold records the take-down's moderation action, so no hold's
 * end restores the subject, and the material stays as the hold keeps it
 * until the last covering hold ends (`takenDownSubjectsDue`).
 */
function takenDownWrite(
  db: Db,
  subject: KeptSubject,
  actionId: string,
): BatchItem<"sqlite"> {
  return db
    .update(copyrightHolds)
    .set({ takenDownBy: actionId })
    .where(and(covering(subject), isNull(copyrightHolds.takenDownBy)));
}

/**
 * What a take-down made under a hold is owed once no live hold keeps the
 * kit: the action's subject, deleted with the statements a Remove uses.
 * Only while the subject is still there, so each is listed until its
 * delete lands, and never again.
 */
interface TakenDownSubject {
  readonly actionId: string;
  readonly actorId: string;
  readonly subjectType: HeldSubjectType;
  readonly subjectId: string;
  /**
  The kit's runner and the kit, from the hold: what the delete owes R2 for.
  */
  readonly ownerId: string;
  readonly entryId: string;
}

/**
The most take-downs one sweep deletes; the rest wait for the next.
*/
const TAKEN_DOWN_PER_SWEEP = 50;

async function takenDownSubjectsDue(db: Db): Promise<TakenDownSubject[]> {
  const action = moderationActions;
  const stillLive = sql`exists (select 1 from ${copyrightHolds} as "live" where "live"."entry_id" = ${qualified(copyrightHolds, copyrightHolds.entryId)} and "live"."status" in ('hidden', 'purging'))`;
  const stillThere = sql`(case ${qualified(action, action.subjectType)} when 'entry' then exists (select 1 from ${outfitEntries} where ${qualified(outfitEntries, outfitEntries.id)} = ${qualified(action, action.subjectId)}) else exists (select 1 from ${entryPhotos} where ${qualified(entryPhotos, entryPhotos.id)} = ${qualified(action, action.subjectId)}) end)`;
  return db
    .selectDistinct({
      actionId: action.id,
      actorId: action.actorId,
      // Only `takenDownWrite` names an action here, and only for a kit
      // or a photo.
      subjectType: sql<HeldSubjectType>`${action.subjectType}`,
      subjectId: action.subjectId,
      ownerId: copyrightHolds.ownerId,
      entryId: copyrightHolds.entryId,
    })
    .from(copyrightHolds)
    .innerJoin(action, eq(action.id, copyrightHolds.takenDownBy))
    .where(and(sql`not ${stillLive}`, stillThere))
    .limit(TAKEN_DOWN_PER_SWEEP);
}

export type CounterNoticeOutcome =
  | {
      readonly outcome: "recorded";
      readonly counterNoticeAt: number;
      readonly restoreAt: number;
    }
  | { readonly outcome: "already" | "before_hidden" | "gone" };

/**
 * The Desk's "Counter-notice received": the day it arrived (round 39 #73,
 * RECEIVED ON, `YYYY-MM-DD`), who recorded it, and the day the sweep
 * restores, counted from that day. Only on a hold still hidden, once, and
 * never for a day before the hide (`before_hidden`): the form refuses
 * that too, but only this `WHERE` knows when the hold began. The day is
 * kept as its 00:00 UTC, the Desk's clock.
 */
export async function recordCounterNotice(
  db: Db,
  actorId: string,
  holdId: string,
  receivedOn: string,
): Promise<CounterNoticeOutcome> {
  const counterNoticeAt = Date.parse(`${receivedOn}T00:00:00Z`) / 1000;
  const restoreAt = restoreDayAfter(counterNoticeAt);
  const landed = await db
    .update(copyrightHolds)
    .set({ counterNoticeAt, counterNoticeBy: actorId, restoreAt })
    .where(
      and(
        eq(copyrightHolds.id, holdId),
        eq(copyrightHolds.status, "hidden"),
        isNull(copyrightHolds.counterNoticeAt),
        lt(copyrightHolds.hiddenAt, counterNoticeAt + DAY_SECONDS),
      ),
    )
    .returning({ id: copyrightHolds.id });
  if (landed.length > 0) {
    return { outcome: "recorded", counterNoticeAt, restoreAt };
  }
  const hold = await hiddenHold(db, holdId);
  if (hold === undefined) return { outcome: "gone" };
  return {
    outcome: hold.counterNoticeAt === null ? "before_hidden" : "already",
  };
}

export type CourtActionOutcome =
  | { readonly outcome: "recorded"; readonly courtActionAt: number }
  | { readonly outcome: "already" | "no_counter_notice" | "gone" };

/**
 * The Desk's "Court action filed": the sender says they have gone to
 * court, so the restore is cancelled and the purge with it — a litigation
 * hold until the Desk ends the case (D-146). Only once a counter-notice
 * is recorded, and only before the sweep has restored it.
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
 * court action is claimed `restored` with this firing's moment as
 * `settled_at`, then the subjects those claims name — and only those —
 * go back from `removed` (`restoreBatch`). A sweep that runs twice claims
 * nothing the second time, so it gives nothing back.
 */
export async function restoreDueHolds(
  db: Db,
  now = nowSeconds(),
): Promise<void> {
  const due = and(
    eq(copyrightHolds.status, "hidden"),
    isNull(copyrightHolds.courtActionAt),
    lte(copyrightHolds.restoreAt, now),
  );
  await restoreBatch(db, due, { settledAt: now });
}

/**
 * A restore, in one batch after one read: the claim `where` names, then
 * the give-back of what a claim at this moment restored.
 *
 * - **A subject something else still holds goes to review, not public.**
 *   Where a Review row is open on it, or a pending removal request that
 *   may hide names it, an entry or photo goes back to
 *   `hidden_pending_review`, and its author gets the hide notice in the
 *   same batch; the decision on that row or request gives it back.
 * - **The rest go back as public**: an entry as `ok`, a photo as
 *   `pending`, never `pass`, so screening looks at it again as after
 *   every give-back (`releaseHoldWrites`).
 * - **A hold whose subject was taken down while held gives nothing
 *   back** (`taken_down_by`): the claim ends the hold, and the sweep
 *   deletes the subject once no live hold covers it
 *   (`takenDownSubjectsDue`).
 *
 * The read names each hold's owner for the notice; the claim, not the
 * read, decides what is restored.
 */
async function restoreBatch(
  db: Db,
  where: SQL | undefined,
  settle: { readonly settledAt: number; readonly caseClosedBy?: string },
) {
  const due = await db
    .select({
      id: copyrightHolds.id,
      subjectType: copyrightHolds.subjectType,
      subjectId: copyrightHolds.subjectId,
      ownerId: copyrightHolds.ownerId,
    })
    .from(copyrightHolds)
    .where(and(where, isNull(copyrightHolds.takenDownBy)));
  const thisClaim = and(
    eq(copyrightHolds.status, "restored"),
    eq(copyrightHolds.settledAt, settle.settledAt),
  );
  return db.batch([
    db
      .update(copyrightHolds)
      .set({ status: "restored", ...settle })
      .where(where)
      .returning({ id: copyrightHolds.id }),
    ...giveBacks(db, thisClaim),
    ...due.map((hold) =>
      hiddenNoticeTo(
        db,
        { userId: hold.ownerId },
        hold,
        sql`${restoredHere(hold.id, thisClaim)} and ${inReview[hold.subjectType](hold.subjectId)}`,
      ),
    ),
  ]);
}

/**
 * The give-back of what a claim restored, per subject type: to review
 * first where something still holds it, then the rest to public. The
 * first moves its rows off `removed`, so the second cannot touch them.
 */
function giveBacks(db: Db, claim: SQL | undefined) {
  const entriesBack = and(
    eq(outfitEntries.moderationStatus, "removed"),
    inArray(outfitEntries.id, restoredBy(db, "entry", claim)),
  );
  const photosBack = and(
    eq(entryPhotos.screenStatus, heldPhotoStatus),
    inArray(entryPhotos.id, restoredBy(db, "photo", claim)),
  );
  const entryHeld = stillHeld(
    "entry",
    qualified(outfitEntries, outfitEntries.id),
  );
  const photoHeld = stillHeld("photo", qualified(entryPhotos, entryPhotos.id));
  return [
    db
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(and(entriesBack, entryHeld)),
    db.update(outfitEntries).set({ moderationStatus: "ok" }).where(entriesBack),
    db
      .update(entryPhotos)
      .set({ screenStatus: "hidden_pending_review" })
      .where(and(photosBack, photoHeld)),
    db.update(entryPhotos).set({ screenStatus: "pending" }).where(photosBack),
  ] as const;
}

/**
 * Whether something other than the hold still keeps a subject from
 * public: an open Review row on it, or a pending removal request naming
 * it that may hide (`hold_state = 'held'`, whether or not it hid then).
 */
function stillHeld(subjectType: HeldSubjectType, subjectId: SQL): SQL {
  return sql`(exists (select 1 from ${reviewQueue} where ${qualified(reviewQueue, reviewQueue.subjectType)} = ${subjectType} and ${qualified(reviewQueue, reviewQueue.subjectId)} = ${subjectId} and ${qualified(reviewQueue, reviewQueue.status)} in ('pending', 'reviewing')) or exists (select 1 from ${takedownRequests} where ${qualified(takedownRequests, takedownRequests.subjectType)} = ${subjectType} and ${qualified(takedownRequests, takedownRequests.subjectId)} = ${subjectId} and ${qualified(takedownRequests, takedownRequests.status)} = 'pending' and ${qualified(takedownRequests, takedownRequests.holdState)} = 'held'))`;
}

/**
Whether this hold is one the batch's claim restored.
*/
function restoredHere(holdId: string, claim: SQL | undefined) {
  return sql`exists (select 1 from ${copyrightHolds} where ${and(eq(copyrightHolds.id, holdId), claim)})`;
}

/**
Whether the subject now waits in review, as the guarded give-back leaves it.
*/
const inReview: Record<HeldSubjectType, (subjectId: string) => SQL> = {
  entry: (subjectId) =>
    sql`exists (select 1 from ${outfitEntries} where ${and(eq(outfitEntries.id, subjectId), eq(outfitEntries.moderationStatus, "hidden_pending_review"))})`,
  photo: (subjectId) =>
    sql`exists (select 1 from ${entryPhotos} where ${and(eq(entryPhotos.id, subjectId), eq(entryPhotos.screenStatus, "hidden_pending_review"))})`,
};

/**
The subjects of one type a restore's claim restored, and may give back.
*/
function restoredBy(
  db: Db,
  subjectType: HeldSubjectType,
  claim: SQL | undefined,
) {
  return db
    .select({ id: copyrightHolds.subjectId })
    .from(copyrightHolds)
    .where(
      and(
        eq(copyrightHolds.subjectType, subjectType),
        isNull(copyrightHolds.takenDownBy),
        claim,
      ),
    );
}

interface NotHeld {
  readonly outcome: "not_held" | "gone";
}

export type CaseOverOutcome = NotHeld | { readonly outcome: "recorded" };

/**
 * A hold the litigation hold still keeps (D-146): hidden, with a court
 * action recorded — the only holds "Case over" acts on.
 */
function heldForCase(holdId: string): SQL | undefined {
  return and(
    eq(copyrightHolds.id, holdId),
    eq(copyrightHolds.status, "hidden"),
    isNotNull(copyrightHolds.courtActionAt),
  );
}

/**
Why a "Case over" did not land: no court action, or no hold to act on.
*/
async function whyNotHeld(db: Db, holdId: string): Promise<NotHeld> {
  const hold = await hiddenHold(db, holdId);
  return { outcome: hold === undefined ? "gone" : "not_held" };
}

/**
 * The Desk's "Case over: restore" (D-146): the court found for the
 * runner, so the material comes back at once, as the sweep's restore
 * would have — claim and give-back in one batch. A restored hold is not
 * a strike. Once only: a second click claims nothing and answers `gone`.
 */
export async function restoreAfterCase(
  db: Db,
  actorId: string,
  holdId: string,
  now = nowSeconds(),
): Promise<CaseOverOutcome> {
  const [claimed] = await restoreBatch(db, heldForCase(holdId), {
    settledAt: now,
    caseClosedBy: actorId,
  });
  return claimed.length > 0 ? { outcome: "recorded" } : whyNotHeld(db, holdId);
}

export type CaseOverClaim =
  NotHeld | { readonly outcome: "claimed"; readonly hold: ClaimedPurge };

/**
 * The Desk's "Case over: delete" (D-146), its claim: the hold moves to
 * `purging` as the sweep's purge claim does, so `feed` deletes it with
 * the same statements, and a delete whose batch fails is the next
 * sweep's stale purge to take over. A purged hold is a strike.
 */
export async function claimPurgeAfterCase(
  db: Db,
  actorId: string,
  holdId: string,
  now = nowSeconds(),
): Promise<CaseOverClaim> {
  const claimed = await db
    .update(copyrightHolds)
    .set({ status: "purging", settledAt: now, caseClosedBy: actorId })
    .where(heldForCase(holdId))
    .returning({ id: copyrightHolds.id });
  const [hold] = await claimedPurges(db, claimed);
  return hold === undefined
    ? whyNotHeld(db, holdId)
    : { outcome: "claimed", hold };
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
 * recorded move to `purging`, and so do purges an earlier sweep claimed
 * and did not finish. A counter-notice keeps a hold from the purge either
 * way: until its restore, or, once a court action follows it, until the
 * Desk ends the case (D-146). One statement, so two sweeps never claim
 * the same hold; the claim's moment is `settled_at`, which is how a stale
 * one is told apart.
 */
async function claimDuePurges(
  db: Db,
  now = nowSeconds(),
): Promise<ClaimedPurge[]> {
  const due = and(
    eq(copyrightHolds.status, "hidden"),
    lte(copyrightHolds.purgeAt, now),
    isNull(copyrightHolds.counterNoticeAt),
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
  return claimedPurges(db, claimed);
}

/**
A claimed purge's columns: the hold's subject, and who took it down.
*/
function purgeColumns() {
  return {
    id: copyrightHolds.id,
    subjectType: copyrightHolds.subjectType,
    subjectId: copyrightHolds.subjectId,
    ownerId: copyrightHolds.ownerId,
    entryId: copyrightHolds.entryId,
    actorId: moderationActions.actorId,
  };
}

/**
What a purge claim took, with who took each down.
*/
function claimedPurges(
  db: Db,
  claimed: readonly { readonly id: string }[],
): Promise<ClaimedPurge[]> {
  return db
    .select(purgeColumns())
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
 * The owner's @handle (R55·199's card head), as a column of the hold's own
 * row like `strikesOf`: null for an owner with no profile, whose hold
 * still lists. `user_profiles`' primary key finds it.
 */
function handleOf(owner: SQLiteColumn): SQL<string | null> {
  return sql<
    string | null
  >`(select ${userProfiles.username} from ${userProfiles} where ${userProfiles.userId} = ${owner})`;
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
  const rows = await db
    .select({
      id: copyrightHolds.id,
      subjectType: copyrightHolds.subjectType,
      subjectId: copyrightHolds.subjectId,
      ownerId: copyrightHolds.ownerId,
      ownerHandle: handleOf(copyrightHolds.ownerId),
      strikes: strikesOf(copyrightHolds.ownerId),
      // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; heldCopyrightContent reads the hidden holds with the notice that hid them, a join only copyright holds have
      notice: moderationActions.reason,
      // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; heldCopyrightContent reads the hidden holds with the notice that hid them, a join only copyright holds have
      hiddenAt: copyrightHolds.hiddenAt,
      purgeAt: copyrightHolds.purgeAt,
      // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; heldCopyrightContent reads the hidden holds with the notice that hid them, a join only copyright holds have
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
  // No handle reads as absent, as every other Desk owner does.
  return rows.map(({ ownerHandle, ...hold }) => ({
    ...hold,
    ownerHandle: ownerHandle ?? undefined,
  }));
}

export type CopyrightHoldSummary = Awaited<
  ReturnType<typeof heldCopyrightContent>
>[number];
