/**
 * Requests to remove an intimate image shared without consent, from
 * someone who may have no account (design 136, decision D-117): the TAKE
 * IT DOWN Act's signed-out path, beside the in-app `intimate` report.
 *
 * **A request whose link is ours hides it at once** (round 35 #58e, the
 * owner's call over D-117's first answer): "A valid request hides the
 * image at once, as a W1 report of the reason does." A link that is not
 * ours names nothing to hide. Every operator is emailed, and a person
 * decides within the 48 hours its `dueAt` keeps. The decision is
 * `feed`'s (`decideRemovalRequest`), because taking something down is;
 * a Decline gives the subject back through `releaseHoldWrites`.
 */
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  outfitEntries,
  reviewQueue,
  takedownBlocks,
  takedownRequests,
  userProfiles,
} from "../../../db/schema-core";
import type {
  TakedownRequestValues,
  TakedownSubject,
} from "../../../lib/contracts/takedown";
import type { OutboxMessage } from "../../../lib/sql/outbox";
import type { PurgeTags } from "../../../lib/cache-tags";
import { readInChunks } from "../../../lib/chunked";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { firstRowWhere } from "../../../lib/sql/keyed-read";
import { qualified } from "../../../lib/sql/qualified";
import { operatorEmailMessage } from "../../../lib/sql/outbox";
import { claimLimit, countSend, emailDebt, sendClaimOf } from "../../email";
import { adminUserIds } from "../rules";
import { REMOVAL_DUE_SECONDS, removalDueLabel } from "../rules";
import { subjectCacheTagsOf } from "../rules";
import { hiddenNotice } from "../notices";
import { otherPhotosOf, type OtherPhotos } from "../review";
import { photoMatchesOf, type PhotoMatches } from "../review";
import {
  filedSubjectOf,
  namedIds,
  requestSubjectOf,
  requestSubjectsOf,
  subjectPhotoKeysOf,
} from "./request-subject";
import { ipKey, requesterKey } from "./requester-key";
import type { HoldState } from "../limits";
import {
  alertRoomSql,
  blockedSql,
  confirmTokenHash,
  counted,
  holdStateSql,
  newConfirmToken,
  requestHolds,
  TAKEDOWN_VALVE_PER_HOUR,
  valveHour,
  valveShutSql,
} from "../limits";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

/**
 * An email owed once for each row of `from.table` that `from.where`
 * matches as the statement runs: `ops`' `outboxInsertWhere`, handed in
 * as `oweInCore` is, since `ops` imports this module. Every condition
 * here is one request's own row, so a debt is owed once or not at all.
 */
export type OweEmailWhere = (
  message: OutboxMessage,
  from: { readonly table: SQLiteTable; readonly where: SQL },
) => BatchItem<"sqlite">;

/**
 * The key the edge purges of removal requests are counted under
 * (`purgePublicPagesFor`), site-wide: a requester may have no account, so
 * there is no runner to count them against. Past its share a held page
 * waits out its 60-second lifetime, which is the guarantee.
 */
export const REMOVAL_REQUESTS_PURGE_KEY = "removal-requests";

export type TakedownRequestResult =
  | { readonly status: "received" }
  | { readonly status: "limited"; readonly until: number }
  | { readonly status: "refused" };

/**
 * What a request needs beyond its form: the Turnstile answer, checked by
 * `verify` (`ops`', handed in, since `ops` imports this module), the
 * visitor's address the limit counts, and whether this deployment limits
 * at all (a real https one does, as Au5's request does).
 */
export interface TakedownRequestInput<Attempt> extends TakedownRequestValues {
  readonly attempt: Attempt;
  readonly remoteIp: string | undefined;
  readonly isLimited: boolean;
}

export interface TakedownRequestDeps<Attempt> {
  readonly verify: (attempt: Attempt) => Promise<{ readonly ok: boolean }>;
  readonly oweWhere: OweEmailWhere;
  /**
  `TAKEDOWN_SECRET`, which keys the visitor's IP (design 137); absent, the
  limits match requesters by email alone.
  */
  readonly secret?: string | undefined;
  /**
  `ops`' edge purge, handed in for the reason `verify` is (design 163).
  */
  readonly purge: PurgeTags;
}

/**
 * File a request: Turnstile, then the limit, then one batch of the row,
 * one alert per operator and the requester's receipt — so a request is
 * never recorded without the emails that make its 48 hours someone's job
 * (law 8c).
 *
 * **A repeat is the first request** (law 8b): the form's key, scoped to
 * the address, finds it, and nothing is written or sent again.
 *
 * **The row decides what the request does** (design 137): its insert
 * writes `hold_state` from the limits as they stand when it runs, then
 * `held_at` only where that state may hide and the link names something
 * a hold moves or already out of public view, and `hid_at` where it is
 * this request that hides it. Every other statement in the
 * batch — the hide, the author's notice, the alerts and the receipt's
 * words — is conditional on the row as written, so what requests sent
 * together do is counted one after another.
 *
 * **The visitor's count is its own write**, before the batch: one email
 * address per request would need its condition three times. A count
 * whose batch then fails costs the visitor one of their hourly sends and
 * nothing else.
 */
export async function fileTakedownRequest<Attempt>(
  db: Db,
  input: TakedownRequestInput<Attempt>,
  deps: TakedownRequestDeps<Attempt>,
  now = nowSeconds(),
): Promise<TakedownRequestResult> {
  const verdict = await deps.verify(input.attempt);
  if (!verdict.ok) return { status: "refused" };
  const email = input.email.toLowerCase();
  const earlier = await firstRowWhere(
    db,
    takedownRequests,
    and(
      eq(takedownRequests.requesterEmail, email),
      eq(takedownRequests.idempotencyKey, input.idempotencyKey),
    ),
  );
  if (earlier !== undefined) return { status: "received" };
  const keys = {
    requesterKey: requesterKey(email),
    ipKey: await ipKey(input.remoteIp, deps.secret),
  };
  const until = await limitedUntil(db, input, keys.requesterKey, now);
  if (until !== undefined) return { status: "limited", until };
  const id = newUlid();
  const dueAt = now + REMOVAL_DUE_SECONDS;
  const subject = await filedSubjectOf(db, input.location);
  const row = rowOf(id);
  const hid = holds(row.newlyHid(now));
  const held = holds(row.hid(now));
  const told = subject === undefined ? [] : await holdNotice(db, subject, hid);
  await db.batch([
    db
      .insert(takedownRequests)
      .values({
        id,
        requesterEmail: email,
        signature: input.signature,
        location: input.location,
        subjectType: subject?.subjectType,
        subjectId: subject?.subjectId,
        description: input.description === "" ? undefined : input.description,
        dueAt,
        createdAt: now,
        idempotencyKey: input.idempotencyKey,
        requesterKey: keys.requesterKey,
        ipKey: keys.ipKey,
        holdState: sql`${holdStateSql(keys, now, subject)}`,
        posterUsername: input.posterUsername,
      })
      .onConflictDoNothing(),
    ...decisionWrites(db, row.written, subject, now),
    ...holdWrites(db, subject, held),
    ...told,
    ...operatorAlerts(deps.oweWhere, { id, dueAt, subject }, row.alerts(now)),
    ...valveAlerts(deps.oweWhere, now, row.owesSummary(now)),
    ...receipts(deps.oweWhere, { id, email, dueAt }, row, now),
  ]);
  await purgeIfHeld(db, { id, subject }, now, deps.purge);
  return { status: "received" };
}

/**
 * What a request does, written on its own row (`row`) right after the
 * insert or the confirm's claim has recorded the limits' state, in the
 * same batch (design 137):
 *
 * 0. the state `held` for one the valve quieted whose subject is already
 *    out of public view: it hides nothing new, so it holds that subject
 *    whatever the valve says, and its alert follows 2 and 3;
 * 1. `held_at`, where that state may hide and the subject is one a hold
 *    moves or one already out of public view; and `hid_at` beside it
 *    where the subject is still public, so this request is the one that
 *    hides it (the hold runs after these, in the same batch);
 * 2. `alerted_at`, where it may act but newly hid nothing (it held a
 *    subject already out of public view, or nothing) and the hour's
 *    one-by-one alerts have room;
 * 3. the state `valve` for one that held nothing past that room. One that
 *    holds its subject keeps `held` and `held_at`; both owe the valve's
 *    hourly alert (`row.owesSummary`);
 * 4. no state for a link that is not ours, which holds nothing;
 * 5. `declined`, with the block's reason and no operator, for a blocked
 *    requester's: it is recorded, and waits for nobody.
 *
 * One statement each, so each counts what the one before it wrote.
 */
function decisionWrites(
  db: Db,
  row: SQL,
  subject: TakedownSubject | undefined,
  now: number,
): BatchItem<"sqlite">[] {
  const mayAct = and(row, eq(takedownRequests.holdState, "held"));
  const heldNothing = and(mayAct, isNull(takedownRequests.heldAt));
  return [
    ...(subject === undefined
      ? []
      : [
          db
            .update(takedownRequests)
            .set({ holdState: "held" })
            .where(
              and(
                row,
                eq(takedownRequests.holdState, "valve"),
                subjectOutOfView(subject),
              ),
            ),
          db
            .update(takedownRequests)
            .set({ heldAt: now })
            .where(and(mayAct, subjectHoldable(subject))),
          db
            .update(takedownRequests)
            .set({ hidAt: now })
            .where(and(mayAct, subjectPublic(subject))),
        ]),
    db
      .update(takedownRequests)
      .set({ alertedAt: now })
      .where(and(mayAct, isNull(takedownRequests.hidAt), alertRoomSql(now))),
    db
      .update(takedownRequests)
      .set({ holdState: "valve" })
      .where(and(heldNothing, isNull(takedownRequests.alertedAt))),
    ...(subject === undefined
      ? [
          db
            .update(takedownRequests)
            .set({ holdState: sql`null` })
            .where(mayAct),
        ]
      : []),
    db
      .update(takedownRequests)
      .set({
        status: "declined",
        declineReason: BLOCKED_REASON,
        resolvedAt: now,
      })
      .where(and(row, eq(takedownRequests.holdState, "blocked"))),
  ];
}

/**
 * What a batch asks of the request it wrote, as predicates on that one
 * row (its id), so every statement after the insert or the confirm's
 * claim acts on the row as that statement left it. `also` narrows each
 * to the batch's own write (the confirm's moment); filing needs none,
 * since its row is new.
 */
function rowOf(id: string, also: SQL = sql`1`) {
  const row = (condition: SQL) =>
    sql`(${takedownRequests.id} = ${id} and ${also} and ${condition})`;
  return {
    /**
    The batch wrote it: an insert a repeat's key refused wrote nothing.
    */
    written: row(sql`1`),
    /**
    It hid its subject at `now`.
    */
    hid: (now: number) => row(sql`${takedownRequests.heldAt} = ${now}`),
    /**
    It is the request that took its subject out of public view at `now`.
    */
    newlyHid: (now: number) => row(sql`${takedownRequests.hidAt} = ${now}`),
    /**
    It hid nothing at `now` (`is not`, so an unset `held_at` answers true).
    */
    hidNothing: (now: number) =>
      row(sql`${takedownRequests.heldAt} is not ${now}`),
    /**
    It alerts every operator one by one: it newly hid its subject, or the hour's allowance had room.
    */
    alerts: (now: number) =>
      row(
        sql`(${takedownRequests.hidAt} = ${now} or ${takedownRequests.alertedAt} = ${now})`,
      ),
    /**
     * It owes the valve's hourly alert instead: quieted by the valve, or
     * holding a subject already out of view past the hour's allowance.
     */
    owesSummary: (now: number) =>
      row(
        sql`(${takedownRequests.holdState} = 'valve' or (${takedownRequests.heldAt} = ${now} and ${takedownRequests.hidAt} is null and ${takedownRequests.alertedAt} is null))`,
      ),
    /**
    Its recorded state is `state`; `isNot` answers true of an unset one.
    */
    is: (state: HoldState) =>
      row(sql`${takedownRequests.holdState} = ${state}`),
    isNot: (state: HoldState) =>
      row(sql`${takedownRequests.holdState} is not ${state}`),
  };
}

/**
A row condition as one for any statement: true while that row exists so.
*/
function holds(condition: SQL): SQL {
  return sql`exists (select 1 from ${takedownRequests} where ${condition})`;
}

/**
An email owed where the request's own row meets `condition`.
*/
function owedWhere(
  oweWhere: OweEmailWhere,
  message: OutboxMessage,
  condition: SQL,
): BatchItem<"sqlite"> {
  return oweWhere(message, { table: takedownRequests, where: condition });
}

/**
 * Whether the request's subject is one a hold moves, or one a report
 * already hid, so a request about a kit already in review still pins it
 * there (`review.ts`'s `notHeldByRequest`). A link that is not ours, a
 * subject that does not exist and a removal all answer false.
 */
function subjectHoldable(subject: TakedownSubject): SQL {
  const { table, where } = holdable(subject, HOLD_OR_REVIEW);
  return sql`exists (select 1 from ${table} where ${where})`;
}

/**
Whether the subject is one a request still pins, but no longer public.
*/
function subjectOutOfView(subject: TakedownSubject): SQL {
  return sql`(${subjectHoldable(subject)} and not ${subjectPublic(subject)})`;
}

/**
 * Whether the subject is in a state a hold moves from and on view: still
 * public, and a photo only while its kit is too. A photo still passed on
 * a kit out of view is out of view, so a request holds it without
 * hiding anything new (`holdWrites` then hides the photo's own row).
 */
function subjectPublic(subject: TakedownSubject): SQL {
  const { table, where } = holdable(subject);
  const onView =
    subject.subjectType === "photo"
      ? sql` and exists (select 1 from ${outfitEntries} where ${qualified(outfitEntries, outfitEntries.id)} = ${qualified(entryPhotos, entryPhotos.entryId)} and ${qualified(outfitEntries, outfitEntries.moderationStatus)} = ${HOLD_FROM_STATUS.entry})`
      : sql``;
  return sql`exists (select 1 from ${table} where ${where}${onView})`;
}

/**
 * The edge purge, for a request whose row says it newly hid its subject
 * at `now` (`hid_at`): read back once the batch has landed, since only
 * the row knows (design 163).
 */
async function purgeIfHeld(
  db: Db,
  request: {
    readonly id: string;
    readonly subject: TakedownSubject | undefined;
  },
  now: number,
  purge: PurgeTags,
): Promise<void> {
  if (request.subject === undefined) return;
  const written = await firstRowWhere(
    db,
    takedownRequests,
    eq(takedownRequests.id, request.id),
  );
  if (written?.hidAt === now) await purgeHeld(db, request.subject, purge);
}

/**
 * The requester's receipt, in the words the row as written earns: hidden
 * where it hid, the confirm link where it waits on one, and otherwise
 * received. One dedupe key, and exactly one of the three conditions holds;
 * the plain receipt is owed first, so a second debt on the key (which
 * takes over the row's id and keeps its words) could never carry it.
 */
function receipts(
  oweWhere: OweEmailWhere,
  request: {
    readonly id: string;
    readonly email: string;
    readonly dueAt: number;
  },
  row: ReturnType<typeof rowOf>,
  now: number,
): BatchItem<"sqlite">[] {
  const receipt = (
    words: { readonly isHidden: boolean; readonly waits: boolean },
    condition: SQL,
  ) =>
    owedWhere(
      oweWhere,
      emailDebt(
        {
          to: { address: request.email },
          template: {
            kind: "removal_request_received",
            dueAt: request.dueAt,
            isHidden: words.isHidden,
            // SA-L18: the request, not a token; the token is minted when
            // the receipt is sent (`mintReceiptConfirmToken`).
            confirmRequestId: words.waits ? request.id : undefined,
          },
        },
        { dedupeKey: `removal_request_received:${request.id}` },
      ),
      condition,
    );
  return [
    receipt(
      { isHidden: false, waits: false },
      sql`${row.hidNothing(now)} and ${row.isNot("confirm")}`,
    ),
    receipt({ isHidden: true, waits: false }, row.hid(now)),
    receipt({ isHidden: false, waits: true }, row.is("confirm")),
  ];
}

/**
 * SA-L18: the confirm token a receipt's link carries, minted when the
 * receipt is sent rather than when the request is filed, so the outbox row
 * that owes it never holds a live token. Only its hash is written, and
 * only while the request still waits on a confirm: `undefined` once it was
 * confirmed or decided, and the receipt then goes without the link. A
 * second send mints again, and the last token sent is the one that works.
 */
export async function mintReceiptConfirmToken(
  // Any dialed-core handle: the outbox's drain asks with its own.
  db: DrizzleD1Database<Record<string, unknown>>,
  requestId: string,
): Promise<string | undefined> {
  const { token, hash } = await newConfirmToken();
  const minted = await db
    .update(takedownRequests)
    .set({ confirmTokenHash: hash })
    .where(
      and(
        eq(takedownRequests.id, requestId),
        eq(takedownRequests.status, "pending"),
        isNull(takedownRequests.confirmedAt),
      ),
    )
    .returning({ id: takedownRequests.id });
  return minted.length === 0 ? undefined : token;
}

/**
 * Design 163: a kit a request hid leaves the edge now, not within the
 * TTL — the open web's `/kit/<id>` is a link `/takedown` takes. So does a
 * held photo's kit, whose page shows it, and the purge deletes the
 * photo's public copy (D-153, design 163 step 8).
 */
async function purgeHeld(
  db: Db,
  subject: TakedownSubject,
  purge: PurgeTags,
): Promise<void> {
  purge(await subjectCacheTagsOf(db, subject.subjectType, subject.subjectId));
}

/**
 * When the visitor's hourly sends run out, or the requester's receipts
 * do, the moment they return; nothing when this deployment does not limit
 * or the request may go. The receipts are counted by `requesterKey`, so
 * every address that reaches one inbox shares one allowance. Counting is
 * the write that spends a send; a visitor already over is not counted
 * against the requester.
 */
async function limitedUntil(
  db: Db,
  input: { readonly isLimited: boolean; readonly remoteIp: string | undefined },
  requester: string,
  now: number,
): Promise<number | undefined> {
  if (!input.isLimited) return undefined;
  const counted = await countSend(
    db,
    "takedown",
    input.remoteIp ?? "unknown",
    now,
  );
  const claim = sendClaimOf(counted);
  if (!claim.isAllowed) return claim.until;
  const receipt = await claimLimit(db, "takedown-to", requester, now);
  return receipt.isAllowed ? undefined : receipt.until;
}

/**
 * One "Removal request, due by …" per operator, where the request alerts
 * one by one (`onlyIf`): at filing, or at its confirm (design 137).
 */
function operatorAlerts(
  oweWhere: OweEmailWhere,
  request: {
    readonly id: string;
    readonly dueAt: number;
    readonly subject: TakedownSubject | undefined;
  },
  onlyIf: SQL,
): BatchItem<"sqlite">[] {
  // An operator's mail, drained ahead of every other email (design 232).
  return adminUserIds().map((userId) =>
    owedWhere(
      oweWhere,
      operatorEmailMessage(
        {
          to: { userId },
          template: {
            kind: "removal_requested",
            dueAt: request.dueAt,
            isOurs: request.subject !== undefined,
          },
        },
        `removal_requested:${request.id}:${userId}`,
      ),
      onlyIf,
    ),
  );
}

/**
 * The valve's one alert per operator per hour (design 137), where the
 * request was quieted (`onlyIf`): the dedupe key is the hour, so every
 * request the valve quiets owes the same row and only the first is sent.
 */
function valveAlerts(
  oweWhere: OweEmailWhere,
  now: number,
  onlyIf: SQL,
): BatchItem<"sqlite">[] {
  const hour = String(valveHour(now));
  return adminUserIds().map((userId) =>
    owedWhere(
      oweWhere,
      operatorEmailMessage(
        {
          to: { userId },
          template: {
            kind: "takedown_valve",
            perHour: TAKEDOWN_VALVE_PER_HOUR,
          },
        },
        `takedown_valve:${hour}:${userId}`,
      ),
      onlyIf,
    ),
  );
}

/**
 * Hide what a request's link names, in the request's own batch, into the
 * state a report's hide uses: `hidden_pending_review`, "not public, a
 * person will look". Only from a public state — never over a removal,
 * and never over a photo the classifier flagged — so a request can take
 * a subject out of sight and never bring one back; and only where the
 * row as written says it held (`onlyIf`). Where it held a subject already
 * out of view this matches nothing, but for a photo still passed on a kit
 * out of view, which it hides, so the photo stays hidden when the kit
 * comes back, until the request is decided.
 */
function holdWrites(
  db: Db,
  subject: TakedownSubject | undefined,
  onlyIf: SQL,
): BatchItem<"sqlite">[] {
  return subject === undefined
    ? []
    : [
        visibilityWrites[subject.subjectType](db, subject.subjectId, {
          hold: true,
          when: onlyIf,
        }),
      ];
}

/**
 * The author's notice that a request hid their kit or photo (R-163; owner,
 * 2026-10-24): the hide notice a report's hide sends (D-145), unchanged,
 * raised where the row says it hid (`onlyIf`). The author is read before
 * the batch, which cannot branch. `hid_at` is stamped only where the
 * subject was still public in the same batch, so a subject a report
 * already hid, or a removal already took, is not told it was hidden
 * again. Suspected CSAM is not known yet when a request lands; the
 * quarantine that may follow tells nobody anything more (D-70).
 */
function holdNotice(
  db: Db,
  subject: TakedownSubject,
  onlyIf: SQL,
): Promise<BatchItem<"sqlite">[]> {
  return hiddenNotice(db, subject.subjectType, subject.subjectId, onlyIf);
}

/**
 * A subject in one of `states`, and the row it names: by default those a
 * hold moves from (the hold's own `where`, `visibilityWrites`, so the
 * notice and the hide cannot disagree about what "public" is), or
 * `HOLD_OR_REVIEW`, which adds a subject a report already hid.
 */
function holdable(
  subject: TakedownSubject,
  states: Readonly<Record<TakedownSubject["subjectType"], SQL>> = HOLD_FROM,
) {
  const { table, id } = SUBJECT_ROWS[subject.subjectType];
  return {
    table,
    where: and(eq(id, subject.subjectId), states[subject.subjectType]),
  };
}

/**
Each subject type's table, and its id.
*/
const SUBJECT_ROWS = {
  entry: { table: outfitEntries, id: outfitEntries.id },
  photo: { table: entryPhotos, id: entryPhotos.id },
} as const;

/**
 * A Decline's give-back, for the decision's batch: the subject the
 * request hid goes back to what an approval leaves (`ok`, and a photo to
 * `pending`, never `pass`, as `resolveReview` does) — but only when
 *
 * - this request is the one just declined (`declinedAt` is the
 *   decision's moment, so a batch whose claim did not land restores
 *   nothing);
 * - no review row is still open on the subject (reports hid it too, and
 *   that is a person's call still to make); and
 * - no other request for it still holds it (`requestHolds`).
 */
export function releaseHoldWrites(
  db: Db,
  request: { readonly id: string; readonly declinedAt: number },
  subject: TakedownSubject,
): BatchItem<"sqlite">[] {
  const thisDeclined = and(
    eq(takedownRequests.id, request.id),
    eq(takedownRequests.status, "declined"),
    eq(takedownRequests.resolvedAt, request.declinedAt),
  );
  const reviewOpen = and(
    eq(reviewQueue.subjectType, subject.subjectType),
    eq(reviewQueue.subjectId, subject.subjectId),
    inArray(reviewQueue.status, ["pending", "reviewing"]),
  );
  const otherHolds = requestHolds(
    sql`${and(
      eq(takedownRequests.subjectType, subject.subjectType),
      eq(takedownRequests.subjectId, subject.subjectId),
      ne(takedownRequests.id, request.id),
    )}`,
  );
  const when = and(
    exists(rowsWhere(db, takedownRequests, thisDeclined)),
    notExists(rowsWhere(db, reviewQueue, reviewOpen)),
    sql`not ${otherHolds}`,
  );
  return [
    visibilityWrites[subject.subjectType](db, subject.subjectId, {
      hold: false,
      when,
    }),
  ];
}

function rowsWhere(
  db: Db,
  table: typeof takedownRequests | typeof reviewQueue,
  where: SQL | undefined,
) {
  return db
    .select({ one: sql`1` })
    .from(table)
    .where(where);
}

/**
 * The states a hold may start from: public, never a removal, and never a
 * photo the classifier flagged.
 */
const HOLD_FROM_STATUS = { entry: "ok" } as const;

const HOLD_FROM = {
  entry: eq(outfitEntries.moderationStatus, HOLD_FROM_STATUS.entry),
  photo: inArray(entryPhotos.screenStatus, ["pending", "pass"]),
} as const;

/**
 * The states a request still pins: those a hold moves from, the one a
 * report's hide or a request's hold leaves (not public, a person will
 * look), and `removed`, where a copyright hold keeps it until a
 * counter-notice may give it back.
 */
const HOLD_OR_REVIEW = {
  entry: inArray(outfitEntries.moderationStatus, [
    "ok",
    "hidden_pending_review",
    "removed",
  ]),
  photo: inArray(entryPhotos.screenStatus, [
    "pending",
    "pass",
    "hidden_pending_review",
    "removed",
  ]),
} as const;

/**
 * One subject's visibility, held or given back, per subject type: the
 * column, the state a hold leaves, the states it may start from, and
 * what a give-back restores. `when` is the give-back's extra condition.
 */
const visibilityWrites: Record<
  TakedownSubject["subjectType"],
  (
    db: Db,
    subjectId: string,
    change: { readonly hold: boolean; readonly when: SQL | undefined },
  ) => BatchItem<"sqlite">
> = {
  entry: (db, subjectId, { hold, when }) => {
    // The hold's start is `HOLD_FROM.entry`'s one state, so a ternary
    // inside the comparison says both directions.
    const from = eq(
      outfitEntries.moderationStatus,
      hold ? HOLD_FROM_STATUS.entry : "hidden_pending_review",
    );
    return db
      .update(outfitEntries)
      .set({ moderationStatus: hold ? "hidden_pending_review" : "ok" })
      .where(and(eq(outfitEntries.id, subjectId), from, when));
  },
  photo: (db, subjectId, { hold, when }) => {
    const from = hold
      ? HOLD_FROM.photo
      : eq(entryPhotos.screenStatus, "hidden_pending_review");
    return db
      .update(entryPhotos)
      .set({ screenStatus: hold ? "hidden_pending_review" : "pending" })
      .where(and(eq(entryPhotos.id, subjectId), from, when));
  },
};

export type TakedownConfirmResult = "confirmed" | "decided" | "not_found";

/**
 * A requester's confirm (design 137): a request past the cap waited for
 * it, and now does what it would have done at filing — hides a link of
 * ours and alerts the operators — unless the valve has shut since, when it
 * owes the valve's alert instead. A repeat is the first confirm; a
 * request already decided stays decided.
 *
 * The claim (`confirmed_at` still NULL, the request still pending)
 * writes what the confirm does, from the valve as it stands when the
 * claim runs, and every other statement in the batch acts only where
 * this claim landed — so a confirm that races itself sends each alert
 * once, and one that races a decision does nothing.
 */
export async function confirmTakedownRequest(
  db: Db,
  token: string,
  effects: { readonly oweWhere: OweEmailWhere; readonly purge: PurgeTags },
  now = nowSeconds(),
): Promise<TakedownConfirmResult> {
  const request = await firstRowWhere(
    db,
    takedownRequests,
    eq(takedownRequests.confirmTokenHash, await confirmTokenHash(token)),
  );
  if (request === undefined) return "not_found";
  if (request.status !== "pending") return "decided";
  if (request.confirmedAt !== null) return "confirmed";
  // SA-L18: a confirm link lasts as long as the request's 48 hours, and
  // past them answers as an unknown link (owner, 2026-11-16).
  if (now > request.dueAt) return "not_found";
  const subject = await requestSubjectOf(db, request);
  const keys = {
    requesterKey: request.requesterKey ?? requesterKey(request.requesterEmail),
    ipKey: request.ipKey ?? undefined,
  };
  const state = sql<HoldState>`(case when ${blockedSql(keys)} then 'blocked' when ${valveShutSql(now, subject)} then 'valve' else 'held' end)`;
  // This claim's moment, on a request still pending: a second press in
  // the same second whose batch lands after a decision acts on nothing.
  const row = rowOf(
    request.id,
    sql`(${eq(takedownRequests.confirmedAt, now)} and ${eq(takedownRequests.status, "pending")})`,
  );
  const hid = holds(row.newlyHid(now));
  const held = holds(row.hid(now));
  const told = subject === undefined ? [] : await holdNotice(db, subject, hid);
  const claim = and(
    eq(takedownRequests.id, request.id),
    isNull(takedownRequests.confirmedAt),
    eq(takedownRequests.status, "pending"),
  );
  await db.batch([
    db
      .update(takedownRequests)
      .set({ confirmedAt: now, holdState: state })
      .where(claim),
    ...decisionWrites(db, row.written, subject, now),
    ...holdWrites(db, subject, held),
    ...told,
    ...operatorAlerts(
      effects.oweWhere,
      { id: request.id, dueAt: request.dueAt, subject },
      row.alerts(now),
    ),
    ...valveAlerts(effects.oweWhere, now, row.owesSummary(now)),
  ]);
  await purgeIfHeld(db, { id: request.id, subject }, now, effects.purge);
  return "confirmed";
}

/**
 * One pending request as Review shows it: what was asked, by whom, and
 * how long is left. `subject` is what the link points at when it is ours,
 * read again from `location` so Review can link the photo by its key (or
 * the photo filing recorded, for a public copy's URL: `./request-subject`).
 */
export interface PendingTakedownRequest {
  readonly id: string;
  readonly requesterEmail: string;
  readonly signature: string;
  readonly location: string;
  readonly description: string | undefined;
  /**
  Who posted it, as the requester gave it (round 37 #59g): their word, never checked.
  */
  readonly posterUsername: string | undefined;
  /**
   * Whose it is: the handle of the runner whose kit the link names, read
   * from that kit, as every other Desk row's owner is; `undefined` for a
   * link that is not ours, a kit gone since, or an owner with no handle.
   */
  readonly owner: string | undefined;
  readonly subject: TakedownSubject | undefined;
  readonly createdAt: number;
  readonly dueAt: number;
  readonly due: string;
  /**
  What filing decided (design 137); `undefined` for a link that is not ours, which hides nothing.
  */
  readonly holdState: HoldState | undefined;
  /**
  The requester's other open requests among those listed, by either key.
  */
  readonly relatedIds: readonly string[];
  /**
   * The posting runner's other photos (D-117, R-145 c), when the link is
   * ours; `undefined` when it is not, since then nobody is known.
   */
  readonly otherPhotos: OtherPhotos | undefined;
  /**
   * Photos from any runner, private included, that match the linked one by
   * fingerprint (D-142, design 146); `undefined` when the link is not ours.
   */
  readonly photoMatches?: PhotoMatches | undefined;
  /**
   * The stored key of the photo the request names, for its tile on the
   * row (SA-M24); `undefined` for a kit, a link not ours, or a photo gone.
   */
  readonly subjectPhotoKey: string | undefined;
}

/**
 * What Review reads of a pending request: what it shows, and the two keys
 * that link a requester's others. Not the confirm token's hash.
 */
const LISTED_COLUMNS = {
  id: takedownRequests.id,
  requesterEmail: takedownRequests.requesterEmail,
  signature: takedownRequests.signature,
  location: takedownRequests.location,
  description: takedownRequests.description,
  posterUsername: takedownRequests.posterUsername,
  createdAt: takedownRequests.createdAt,
  dueAt: takedownRequests.dueAt,
  holdState: takedownRequests.holdState,
  requesterKey: takedownRequests.requesterKey,
  ipKey: takedownRequests.ipKey,
};

/**
 * The open requests, those that may act first and then those waiting on a
 * confirm, each soonest due first — the order an operator must work them
 * in. Read on `takedown_requests_status_due`; `pendingTakedownCount` says
 * how many there are past `limit`.
 */
export async function pendingTakedownRequests(
  db: Db,
  now = nowSeconds(),
  limit = 50,
): Promise<PendingTakedownRequest[]> {
  const rows = await db
    .select(LISTED_COLUMNS)
    .from(takedownRequests)
    .where(eq(takedownRequests.status, "pending"))
    .orderBy(
      sql`${takedownRequests.holdState} is 'confirm'`,
      asc(takedownRequests.dueAt),
    )
    .limit(limit);
  // Counted among the rows already read rather than by a query per row:
  // the list is at most `limit` long, and a requester past it is still
  // one whose other requests show once these are decided.
  const keyOf = (row: (typeof rows)[number]) =>
    row.requesterKey ?? requesterKey(row.requesterEmail);
  const subjects = await requestSubjectsOf(db, rows);
  const photoKeys = await subjectPhotoKeysOf(db, subjects);
  const listed = rows.map((row, index) => ({ row, subject: subjects[index] }));
  const owners = await ownersOf(db, subjects);
  const others = await otherPhotosOf(
    db,
    listed.flatMap(({ subject }) => subject ?? []),
  );
  const matches = await photoMatchesOf(
    db,
    listed.flatMap(({ subject }) => subject ?? []),
  );
  return listed.map(({ row, subject }) => ({
    id: row.id,
    requesterEmail: row.requesterEmail,
    signature: row.signature,
    location: row.location,
    description: row.description ?? undefined,
    posterUsername: row.posterUsername ?? undefined,
    owner: subject && owners.get(subject.entryId),
    subject,
    otherPhotos:
      subject && others.get(`${subject.subjectType}:${subject.subjectId}`),
    photoMatches:
      subject && matches.get(`${subject.subjectType}:${subject.subjectId}`),
    subjectPhotoKey: subject && photoKeys.get(subject.subjectId),
    createdAt: row.createdAt,
    dueAt: row.dueAt,
    due: removalDueLabel(row.dueAt, now),
    holdState: row.holdState ?? undefined,
    relatedIds: rows
      .filter(
        (other) =>
          other.id !== row.id &&
          (keyOf(other) === keyOf(row) ||
            (row.ipKey !== null && other.ipKey === row.ipKey)),
      )
      .map((other) => other.id),
  }));
}

/**
How many requests are pending in all, listed or not.
*/
export async function pendingTakedownCount(db: Db): Promise<number> {
  return counted(
    await db
      .select({ n: sql<number>`count(*)` })
      .from(takedownRequests)
      .where(eq(takedownRequests.status, "pending")),
  );
}

/**
 * A request still waiting on its confirm once its 48 hours are past is
 * declined, with no operator and no email: its link has lapsed, and it
 * hid nothing, so it gives nothing back. Re-runnable (law 1).
 */
export async function declineLapsedRequests(
  db: Db,
  now = nowSeconds(),
): Promise<void> {
  await db
    .update(takedownRequests)
    .set({ status: "declined", declineReason: LAPSED_REASON, resolvedAt: now })
    .where(
      and(
        eq(takedownRequests.status, "pending"),
        eq(takedownRequests.holdState, "confirm"),
        lt(takedownRequests.dueAt, now),
      ),
    );
}

/**
 * The handle of each named kit's author, by kit id, an `IN` list at a
 * time; a kit gone, or an author with no handle yet, is not in it.
 */
async function ownersOf(
  db: Db,
  subjects: readonly (TakedownSubject | undefined)[],
): Promise<Map<string, string>> {
  const entryIds = namedIds(subjects, (subject) => subject.entryId);
  // The author's handle as a column of the kit's own row, by
  // `user_profiles`' primary key.
  const handle = sql<
    string | null
  >`(select ${userProfiles.username} from ${userProfiles} where ${qualified(userProfiles, userProfiles.userId)} = ${qualified(outfitEntries, outfitEntries.userId)})`;
  const kits = await readInChunks(entryIds, (chunk) =>
    db
      .select({ entryId: outfitEntries.id, handle })
      .from(outfitEntries)
      .where(inArray(outfitEntries.id, chunk)),
  );
  return new Map(
    kits.flatMap((kit) =>
      kit.handle === null ? [] : [[kit.entryId, kit.handle]],
    ),
  );
}

export type BlockResult =
  | {
      readonly status: "blocked";
      readonly declined: number;
      readonly declinedIds: readonly string[];
    }
  | { readonly status: "not_found" };

/**
 * Block and decline all (design 137): every pending request from this
 * request's requester, by either key, is declined with no outcome email,
 * what each hid is given back, and both keys go into `takedown_blocks`,
 * so what they file next is recorded and does nothing. One batch: the
 * declines first, so each give-back sees no other pending request of the
 * requester's on its subject.
 */
export async function blockAndDeclineAll(
  db: Db,
  actorId: string,
  requestId: string,
  now = nowSeconds(),
): Promise<BlockResult> {
  const request = await firstRowWhere(
    db,
    takedownRequests,
    eq(takedownRequests.id, requestId),
  );
  if (request === undefined) return { status: "not_found" };
  const keys = {
    requesterKey: request.requesterKey ?? requesterKey(request.requesterEmail),
    ipKey: request.ipKey ?? undefined,
  };
  // The request itself by its id, and the requester's others by their
  // email key only: an address many people share may have filed some of
  // them, and those wait for a person. Both keys are still blocked, so
  // what that address files next hides nothing.
  const theirs = or(
    eq(takedownRequests.id, request.id),
    eq(takedownRequests.requesterKey, keys.requesterKey),
  );
  const pending = await db
    .select()
    .from(takedownRequests)
    .where(and(theirs, eq(takedownRequests.status, "pending")));
  const declines = pending.map((row) =>
    db
      .update(takedownRequests)
      .set({
        status: "declined",
        declineReason: BLOCKED_REASON,
        resolvedAt: now,
        resolvedBy: actorId,
      })
      .where(
        and(
          eq(takedownRequests.id, row.id),
          eq(takedownRequests.status, "pending"),
        ),
      ),
  );
  const subjects = await requestSubjectsOf(db, pending);
  const giveBacks = pending.flatMap((row, index) => {
    const subject = subjects[index];
    return subject === undefined
      ? []
      : releaseHoldWrites(db, { id: row.id, declinedAt: now }, subject);
  });
  const block = (key: string, kind: "email" | "ip") =>
    db
      .insert(takedownBlocks)
      .values({ key, kind, createdAt: now, createdBy: actorId })
      .onConflictDoNothing();
  await db.batch([
    block(keys.requesterKey, "email"),
    ...(keys.ipKey === undefined ? [] : [block(keys.ipKey, "ip")]),
    ...declines,
    ...giveBacks,
  ]);
  return {
    status: "blocked",
    declined: pending.length,
    declinedIds: pending.map((row) => row.id),
  };
}

/**
The reason a block-and-decline records; no email carries it.
*/
const BLOCKED_REASON = "Blocked as abuse";

/**
The reason a request recorded when its confirm link lapsed unpressed; no email carries it.
*/
const LAPSED_REASON = "Not confirmed";
